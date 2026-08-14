// Checks that the emulated link behaves like a link.
//
// What this proxy gets wrong is not visible in the benchmark's output: a
// mistake here does not fail a run, it quietly changes every number the pnpr
// section reports. Both faults these tests cover were live at some point —
// a link that carried one chunk at a time turned a 380ms transfer into 1.8s,
// and destroying a socket as soon as its peer closed truncated responses whose
// last bytes were still crossing the link.
//
// Run with: node --test benchmarks/latencyProxy.test.mjs

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import tempy from 'tempy'
import { startLatencyProxy, mbpsToBytesPerSec } from './latencyProxy.js'

const BODY = crypto.randomBytes(4 * 1024 * 1024)
const DIGEST = crypto.createHash('sha256').update(BODY).digest('hex')
const LOGS = tempy.directory()

function startOrigin () {
  const server = http.createServer((req, res) => {
    if (req.url === '/big') {
      res.writeHead(200, { 'content-length': BODY.length })
      res.end(BODY)
    } else {
      res.writeHead(200)
      res.end('ok')
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }))
  })
}

function fetchThrough (port, urlPath, agent) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const chunks = []
    http.get({ host: '127.0.0.1', port, path: urlPath, agent: agent ?? false }, (res) => {
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks)
        resolve({
          ms: Date.now() - startedAt,
          digest: crypto.createHash('sha256').update(body).digest('hex'),
          bytes: body.length,
        })
      })
    }).on('error', reject)
  })
}

const proxyFor = (upstreamPort, options) => startLatencyProxy({
  upstreamPort,
  logPath: path.join(LOGS, `${Math.random().toString(36).slice(2)}.log`),
  ...options,
})

test('a round trip costs what it is configured to cost', async () => {
  const origin = await startOrigin()
  const fast = await proxyFor(origin.port, { roundTripMs: 20 })
  const slow = await proxyFor(origin.port, { roundTripMs: 120 })
  try {
    const quick = await fetchThrough(fast.port, '/small')
    const sluggish = await fetchThrough(slow.port, '/small')
    // A request pays the round trip on the connection and again on the exchange.
    assert.ok(quick.ms >= 20, `expected at least 20ms, got ${quick.ms}ms`)
    assert.ok(sluggish.ms >= 120, `expected at least 120ms, got ${sluggish.ms}ms`)
    assert.ok(sluggish.ms > quick.ms * 2, `${sluggish.ms}ms should be well above ${quick.ms}ms`)
  } finally {
    fast.close(); slow.close(); origin.close()
  }
})

test('throughput follows the configured bandwidth, not the chunk size', async () => {
  const origin = await startOrigin()
  const proxy = await proxyFor(origin.port, { roundTripMs: 40, rateLimit: mbpsToBytesPerSec(100) })
  try {
    const result = await fetchThrough(proxy.port, '/big')
    // 4 MiB at 100 Mbit/s is ~336ms, plus the round trip. The upper bound is
    // what fails when the link stops carrying a round trip's worth at once and
    // degrades into one chunk per delay.
    assert.equal(result.digest, DIGEST)
    assert.ok(result.ms >= 300, `expected the cap to bite, got ${result.ms}ms`)
    assert.ok(result.ms < 900, `expected ~380ms, got ${result.ms}ms — the link is serialising chunks`)
  } finally {
    proxy.close(); origin.close()
  }
})

test('responses survive intact over reused and concurrent connections', async () => {
  const origin = await startOrigin()
  const proxy = await proxyFor(origin.port, { roundTripMs: 20, rateLimit: mbpsToBytesPerSec(200) })
  const agent = new http.Agent({ keepAlive: true })
  try {
    for (let i = 0; i < 10; i++) {
      const result = await fetchThrough(proxy.port, '/big', agent)
      assert.equal(result.digest, DIGEST, `keep-alive request ${i} came back truncated`)
    }
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => fetchThrough(proxy.port, '/big'))
    )
    for (const result of concurrent) assert.equal(result.digest, DIGEST)
  } finally {
    agent.destroy(); proxy.close(); origin.close()
  }
})

test('megabits convert to bytes per second', () => {
  assert.equal(mbpsToBytesPerSec(8), 1_000_000)
  assert.equal(mbpsToBytesPerSec(0), null)
  assert.equal(mbpsToBytesPerSec(Number.NaN), null)
})
