'use strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import cmdsMap from './commandsMap.js'
import { startLatencyProxy, mbpsToBytesPerSec } from './latencyProxy.js'
import {
  installPnpr,
  pnprVersion,
  startPnpr,
  mintToken,
  populateCache,
  verifyResolverIsUsed,
  reservePort,
} from './pnprServer.js'

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))

// The emulated link, matching the pnpm monorepo's own pnpr benchmark. The
// client-to-server latency is deliberately the same as the client-to-registry
// latency: a faster link to pnpr would flatter it for free, so whatever it
// wins has to come from making fewer round trips rather than cheaper ones.
export const ROUND_TRIP_MS = 50
export const BANDWIDTH_MBPS = 200

// Results measured here are recorded under their own name. A registry of our
// own across an emulated link is a different measurement than the public
// registry over whatever link the machine has, so these runs must never be
// pooled with the ones recorded before this became the benchmark's setup.
// The same rule holds within the suffix: when the setup changed shape again
// (the pnpr server resolving on loopback instead of across the emulated link,
// the registry warmed with the updated-dependencies graph), the runs recorded
// before the change were deleted rather than left for `min()` to pool with
// the new ones.
export const RESULTS_SUFFIX = '-pnpr'

/**
 * A pnpr storage directory `populatePnprCache.js` filled, named by
 * `BENCHMARK_PNPR_CACHE`. Absent — or pointing at nothing — means this run
 * warms the registry itself.
 */
function seededStorageDir () {
  const seed = process.env.BENCHMARK_PNPR_CACHE
  if (!seed) return null
  const storage = fs.existsSync(path.join(seed, 'storage')) ? path.join(seed, 'storage') : seed
  if (!fs.existsSync(storage)) {
    console.log(`# BENCHMARK_PNPR_CACHE names ${seed}, which does not exist; warming the registry instead`)
    return null
  }
  return storage
}

/**
 * Brings up the registry every package manager is benchmarked against: a pnpr
 * proxying npmjs and bit, reached across an emulated network link.
 *
 * Everything that has to happen before the first measured install happens here
 * — the registry's cache is warmed or seeded, and server-side resolution is
 * proven to work — so that no scenario pays for the setup of the ones after it.
 */
export async function startBenchmarkRegistry ({ managersDirs, fixtureNames }) {
  const seededStorage = seededStorageDir()
  installPnpr(managersDirs.pnpr)
  const version = pnprVersion(managersDirs.pnpr)

  const dir = path.join(managersDirs.pnpr, 'server')
  const proxies = []
  let server
  // Every process gets its own attempt, and a failed one is reported rather
  // than thrown: this runs in a `finally`, where a throw would replace whatever
  // the benchmark failed with, and stopping at the first failure would leave
  // the rest of the processes holding their ports for the next run.
  const stop = () => {
    for (const close of [...proxies.map((proxy) => () => proxy.close()), () => server?.stop()]) {
      try {
        close()
      } catch (err) {
        console.error(`Couldn't stop a benchmark registry process: ${err.stack ?? err}`)
      }
    }
  }
  try {
    // The links come up first: pnpr has to be told the address clients will
    // really use, so the tarball URLs it serves point across the emulated link
    // instead of around it.
    fs.mkdirSync(dir, { recursive: true })
    // Whatever a populate run left behind, put in place before the server
    // starts — pnpr reads its storage at startup. An empty or missing
    // directory simply means the warm-up below runs as it always did, so a
    // cache that failed to arrive costs time rather than correctness.
    if (seededStorage) {
      fs.cpSync(seededStorage, path.join(dir, 'storage'), { recursive: true })
    }
    // A port the system says is free, rather than a fixed one: a fixed port is
    // still held by the pnpr of an earlier run in the same job, and that older
    // server answers for it.
    const pnprPort = await reservePort()
    const registryLink = await startLatencyProxy({
      upstreamPort: pnprPort,
      roundTripMs: ROUND_TRIP_MS,
      rateLimit: mbpsToBytesPerSec(BANDWIDTH_MBPS),
      logPath: path.join(dir, 'registry-link.log'),
    })
    proxies.push(registryLink)
    const url = `http://127.0.0.1:${registryLink.port}`

    // Resolution requests cross a link of their own, at the same round trip.
    // Only latency is emulated here: the resolve exchange is small, so what it
    // costs is round trips rather than throughput.
    const resolverLink = await startLatencyProxy({
      upstreamPort: pnprPort,
      roundTripMs: ROUND_TRIP_MS,
      logPath: path.join(dir, 'resolver-link.log'),
    })
    proxies.push(resolverLink)
    const resolverUrl = `http://127.0.0.1:${resolverLink.port}`

    server = await startPnpr({
      managersDir: managersDirs.pnpr,
      dir,
      port: pnprPort,
      publicUrl: url,
      // Logging every request is what lets the check below see whether pnpm
      // really resolved on the server. It goes to a file, and every manager
      // faces the same server, so it costs all of them the same.
      logLevel: 'info',
    })
    const authToken = await mintToken(server.url)

    const assertAlive = () => {
      for (const proxy of proxies) proxy.assertAlive()
      server.assertAlive()
    }

    // Warm pnpr's cache before anything is timed. Otherwise whichever manager
    // ran first would pay to pull every package from npmjs into pnpr, and the
    // rest would be measured against a registry it had warmed for them.
    //
    // A run handed a storage directory that `populatePnprCache.js` filled
    // skips the pull: it was copied into place before the server started, so
    // there is nothing left to fetch. Parallel sample jobs share one such directory, which is what
    // makes them samples of the same thing — three jobs each warming their
    // own registry resolve the graph three times, and anything published in
    // between lands in one sample and not the others.
    if (seededStorage) {
      console.log(`# pnpr storage seeded from ${seededStorage} (cache warm-up skipped)`)
    } else {
      for (const fixtureName of fixtureNames) {
        populateCache({
          pm: withRegistry(cmdsMap.pnpm12, url),
          managersDir: managersDirs.pnpm12,
          dir,
          registry: url,
          fixtureDir: path.join(DIRNAME, 'fixtures', fixtureName),
        })
        // Warming the cache is the first thing to put real load on the link,
        // and a link that dies here would otherwise be discovered much later,
        // after a package manager had spent minutes retrying against a closed
        // port.
        assertAlive()
      }
    }

    // Verified with the same client the accelerated scenario measures —
    // pnpm 12 — so a release that stopped using the resolver is caught here,
    // not discovered as a suspiciously plain-looking column later.
    verifyResolverIsUsed({
      pm: withRegistry(cmdsMap.pnpm_pnpr, url),
      managersDir: managersDirs.pnpm12,
      dir,
      registry: url,
      authToken,
      pnprServer: resolverUrl,
      pnprServerRegistry: server.url,
      fixtureDir: path.join(DIRNAME, 'fixtures', fixtureNames[0]),
      serverLog: server.log,
    })

    return {
      url,
      resolverUrl,
      // The server's own un-proxied address. The accelerated scenario hands
      // this to the client as the registry to resolve against server-side,
      // so the resolver's metadata fetches stay next to the registry — the
      // production shape, and the one the pnpm monorepo's
      // `integrated-benchmark` measures — instead of crossing the emulated
      // link back into the server's public endpoint.
      serverDirectUrl: server.url,
      authToken,
      version,
      assertAlive,
      stop,
      /** Points a package manager's command at this registry. */
      withRegistry: (pm) => withRegistry(pm, url),
    }
  } catch (err) {
    stop()
    throw err
  }
}

/**
 * Sends a package manager to a different registry than the one it defaults to.
 * The flag is what counts: npm, pnpm, and Bun each carry a `--registry` of
 * their own that would otherwise win over the `.npmrc` written next to the
 * fixture. Yarn takes no such flag and refuses to run when given one, so it is
 * left alone and configured through `.yarnrc.yml` instead.
 */
function withRegistry (pm, registry) {
  if (pm.name === 'yarn') return pm
  return {
    ...pm,
    args: [...pm.args.filter((arg) => !arg.startsWith('--registry=')), `--registry=${registry}`],
  }
}
