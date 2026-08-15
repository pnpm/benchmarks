'use strict'
import fs from 'fs'
import net from 'net'
import path from 'path'
import spawn from 'cross-spawn'
import { fileURLToPath } from 'url'

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))

// A TCP proxy that puts an emulated network link in front of a local server.
//
// Every package manager in the benchmark talks to a registry running on the same
// machine, where a round trip is effectively free. That hides the cost the
// benchmark is trying to show: resolving a dependency graph means walking it
// level by level, and each level costs one round trip, so on a real network the
// install time is dominated by graph depth times latency rather than by how
// fast the registry answers.
//
// Ported from the `integrated-benchmark` task in the pnpm monorepo, which
// emulates the same link for the same reason.

const INITIAL_CWND_BYTES = 14_600

/** Megabits per second to bytes per second, or null for an uncapped link. */
export function mbpsToBytesPerSec (mbps) {
  if (!Number.isFinite(mbps) || mbps <= 0) return null
  return Math.max(1, Math.round(mbps * 125_000))
}

/**
 * Models TCP slow start: a connection begins at an initial congestion window
 * and its effective rate (window / RTT) doubles per delivered window until it
 * reaches the cap. Without this a transfer runs at the full cap from its first
 * byte, which overstates throughput for the many small tarballs an install
 * fetches.
 */
function createSlowStart (profile) {
  const rttSecs = (profile.oneWayMs * 2) / 1000
  if (!profile.slowStart || rttSecs <= 0 || profile.rateLimit == null) return null
  return { cwnd: INITIAL_CWND_BYTES, rttSecs, bytesInRound: 0 }
}

function effectiveRate (ramp, cap, length) {
  const rate = Math.min(ramp.cwnd / ramp.rttSecs, cap)
  ramp.bytesInRound += length
  if (ramp.bytesInRound >= ramp.cwnd) {
    ramp.bytesInRound = 0
    ramp.cwnd = Math.min(ramp.cwnd * 2, Math.max(cap * ramp.rttSecs, INITIAL_CWND_BYTES))
  }
  return rate
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Forwards one direction of a connection, holding every chunk for the link's
 * one-way delay and, when the link is capped, for as long as it takes to put
 * the chunk on the wire.
 *
 * `link` is the direction's shared pacing state — one per direction for the
 * whole proxy, not per connection. The cap models one wire: a manager that
 * opens two hundred connections still downloads at the configured rate in
 * total, the way it would on a real link. Paced per connection instead, the
 * cap multiplies by however many connections a client opens, and the
 * benchmark quietly hands the most connection-hungry manager the fattest
 * pipe. (The slow-start ramp stays per connection — that is where TCP keeps
 * its congestion window — only the wire underneath is shared.)
 */
function pump (src, dst, profile, link) {
  const ramp = createSlowStart(profile)
  // How many bytes may be on the link at once before the sender is made to
  // wait. A real link carries a whole round trip's worth of data in flight, so
  // the bound has to be at least that or the emulation collapses into
  // stop-and-wait: one chunk crossing at a time, each paying the delay in turn,
  // which caps throughput at a chunk per delay however fast the link is
  // configured to be. Above that it only serves to bound memory.
  const inFlightLimit = Math.max(
    1024 * 1024,
    (profile.rateLimit ?? 12_500_000) * (profile.oneWayMs * 2 / 1000) * 2
  )
  let queuedBytes = 0
  let queue = Promise.resolve()

  src.on('data', (chunk) => {
    // Make the sender wait once the link is carrying as much as it can hold.
    // Without any bound the whole response is read straight into the queue, and
    // the proxy ends up holding entire tarballs in memory.
    queuedBytes += chunk.length
    if (queuedBytes >= inFlightLimit) {
      src.pause()
    }
    const releaseAt = Date.now() + profile.oneWayMs
    queue = queue.then(async () => {
      if (dst.destroyed) return
      // The wire is claimed before the wait, not after it: the reservation
      // has to be visible to every other connection the moment this chunk is
      // scheduled, or they would all pace against the same free point and the
      // cap would multiply by the number of connections in flight.
      let sendAt = releaseAt
      if (profile.rateLimit != null) {
        const rate = ramp
          ? effectiveRate(ramp, profile.rateLimit, chunk.length)
          : profile.rateLimit
        sendAt = Math.max(releaseAt, link.freeAt)
        link.freeAt = Math.max(sendAt, Date.now()) + (chunk.length / rate) * 1000
      }
      const wait = sendAt - Date.now()
      if (wait > 0) await sleep(wait)
      if (dst.destroyed) return
      // Respect backpressure, otherwise a capped link would buffer whole
      // tarballs in memory instead of pacing them. The wait has to end if the
      // socket dies first, or this direction would stall for good and hold the
      // connection open behind it.
      if (!dst.write(chunk)) {
        await new Promise((resolve) => {
          const done = () => {
            dst.off('drain', done)
            dst.off('close', done)
            dst.off('error', done)
            resolve()
          }
          dst.once('drain', done)
          dst.once('close', done)
          dst.once('error', done)
        })
      }
    }).catch(() => {}).finally(() => {
      queuedBytes -= chunk.length
      if (queuedBytes < inFlightLimit && !src.destroyed) {
        src.resume()
      }
    })
  })

  src.on('end', () => { queue = queue.then(() => { if (!dst.destroyed) dst.end() }).catch(() => {}) })
  src.on('error', () => dst.destroy())

  return { flushed: () => queue }
}

function listen ({ upstreamPort, roundTripMs, rateLimit, slowStart }) {
  // The profile is one-way; a round trip pays it twice.
  const profile = { oneWayMs: roundTripMs / 2, rateLimit, slowStart }
  // One pacing point per direction for the whole proxy: the earliest moment
  // the wire is free to start the next chunk, advanced by each chunk's
  // serialization time so the cap is a sustained throughput limit. Shared
  // across every connection, because they all cross the same emulated link.
  const uplink = { freeAt: 0 }
  const downlink = { freeAt: 0 }
  // Both sockets have to stay half-open. Delaying a chunk means one direction
  // is always behind the other, and with Node's default the first side to
  // finish would close its peer's write side before the chunks still waiting on
  // the link had been handed over.
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    const upstream = net.connect({ host: '127.0.0.1', port: upstreamPort, allowHalfOpen: true })
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
    const toUpstream = pump(client, upstream, profile, uplink)
    const toClient = pump(upstream, client, profile, downlink)
    // A peer that goes away must not take its other half with it while chunks
    // are still on the link. Ending a response is the ordinary case: the source
    // socket closes as soon as it has handed over its last bytes, but those
    // bytes are still waiting out their delay here, and destroying the
    // destination now would truncate every response by whatever the link still
    // held. Waiting for the direction to drain first keeps the destroy doing
    // what it is for — releasing a connection nobody will finish — which
    // matters because an install opens a great many of them.
    upstream.on('close', () => { toClient.flushed().finally(() => client.destroy()) })
    client.on('close', () => { toUpstream.flushed().finally(() => upstream.destroy()) })
  })
  // Accepting a connection can fail without the listener being finished — most
  // of all by running out of file descriptors, which a proxy is twice as prone
  // to as anything else because every connection through it needs two. Throwing
  // from here would end the process, and a proxy that dies takes the run with
  // it: every fetch after it fails, the package managers spend minutes retrying
  // against a closed port, and nothing says why. Staying up and recording it
  // leaves the benchmark able to finish or to fail with a reason.
  server.on('error', (err) => {
    console.error(`latency proxy: server error: ${err.stack ?? err}`)
  })
  return server
}

/**
 * Starts the proxy as a process of its own and resolves with the port to point
 * clients at.
 *
 * It has to be a separate process. Installs are measured with a synchronous
 * spawn, which blocks this process's event loop for as long as the package
 * manager runs — a proxy living here would accept no connection until the very
 * install it is supposed to be serving had already finished.
 */
export async function startLatencyProxy ({ upstreamPort, roundTripMs, rateLimit = null, slowStart = false, logPath }) {
  // Like pnpr, the proxy writes to a file instead of a pipe: nothing here
  // drains a pipe while a measured install holds the event loop, so a full
  // buffer would block the very process the traffic flows through.
  const logFd = fs.openSync(logPath, 'a')
  const proc = spawn(process.execPath, [
    path.join(DIRNAME, 'latencyProxy.js'),
    `--upstream-port=${upstreamPort}`,
    `--round-trip-ms=${roundTripMs}`,
    `--rate-limit=${rateLimit ?? 0}`,
    `--slow-start=${slowStart ? 1 : 0}`,
  ], { stdio: ['ignore', logFd, logFd] })
  fs.closeSync(logFd)

  let exit = null
  proc.on('exit', (code, signal) => { exit = { code, signal } })

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const log = fs.readFileSync(logPath, 'utf8')
    const port = log.match(/^port=(\d+)$/m)?.[1]
    if (port) {
      return {
        port: Number(port),
        /**
         * A proxy that dies mid-run doesn't stop the benchmark, it ruins it:
         * every request after it is refused, package managers retry for minutes
         * against a closed port, and whatever times come out are meaningless.
         * Checking between scenarios turns that into an immediate failure that
         * says what happened.
         */
        assertAlive: () => {
          if (!exit) return
          throw new Error(
            `The latency proxy on port ${port} exited (code ${exit.code}, signal ${exit.signal}). ` +
            `Everything measured after it would be meaningless. Its log:\n${fs.readFileSync(logPath, 'utf8').slice(-4000)}`
          )
        },
        close: () => { proc.kill() },
      }
    }
    if (proc.exitCode !== null) {
      throw new Error(`The latency proxy exited with code ${proc.exitCode}. ${log}`)
    }
    await sleep(100)
  }
  // A proxy that is alive but never reported a port would otherwise outlive the
  // run that gave up on it, and keep the benchmark from exiting.
  proc.kill()
  throw new Error(`The latency proxy did not start. ${fs.readFileSync(logPath, 'utf8')}`)
}

// Running this file directly is what `startLatencyProxy` spawns.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Whatever goes wrong in here has to end up written down. The parent is
  // blocked in a synchronous spawn and cannot be told, so a proxy that exits
  // quietly leaves nothing behind but connection refusals in a package
  // manager's output.
  process.on('uncaughtException', (err) => {
    console.error(`latency proxy: uncaught: ${err.stack ?? err}`)
  })
  process.on('unhandledRejection', (err) => {
    console.error(`latency proxy: unhandled rejection: ${err?.stack ?? err}`)
  })
  const arg = (name) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? 0)
  const rateLimit = arg('rate-limit')
  const server = listen({
    upstreamPort: arg('upstream-port'),
    roundTripMs: arg('round-trip-ms'),
    rateLimit: rateLimit > 0 ? rateLimit : null,
    slowStart: arg('slow-start') === 1,
  })
  server.listen(0, '127.0.0.1', () => {
    console.log(`port=${server.address().port}`)
  })
}
