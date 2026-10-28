'use strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'

import spawn from 'cross-spawn'
import { loadYamlFileSync } from 'load-yaml-file'

import { applyPnprServerRegistry, createEnv, pnpmWorkspaceYaml, UPDATED_DEPENDENCIES } from './benchmarkFixture.js'

/**
 * Takes a port the operating system says is free.
 *
 * Starting pnpr on a fixed port meant colliding with one left behind by an
 * earlier run of the benchmark in the same job, and the collision did not look
 * like one: the new server failed to bind and exited, the old one answered the
 * health check, and the run carried on against a registry whose tarball URLs
 * pointed at a proxy that had been shut down with the run that created it.
 */
export function reservePort () {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

const USERNAME = 'pnpm-io-benchmark'
const PASSWORD = 'benchmark'

/**
 * pnpr is a pnpm-compatible registry server. The benchmark runs every package
 * manager against it so they all face the same registry, and additionally lets
 * pnpm offload dependency resolution to it.
 */
/** Where bit publishes; reached through pnpr's `bit` route. */
export const BIT_REGISTRY = 'https://node-registry.bit.cloud/'

/**
 * The scopes bit publishes under. Declared as the `bit` registry's
 * namespace, which is what routes them there — `@bitdev` included: the
 * fixture's graph reaches it through `@teambit/bit`, and it is not on
 * npmjs.
 */
export const BIT_SCOPES = ['@teambit', '@bitdev']

/**
 * The npm registry every package manager installs from, on a pnpr at `base`.
 * pnpr serves each ecosystem under a prefix of its own, npm included, and
 * the bare `/npm/` is the config's `defaultRegistry`.
 */
export function npmRegistryUrl (base) {
  return `${base}/npm/`
}

/** The registry name of the tar registry below. */
const TAR_REGISTRY = 'zstd'

/**
 * The tar registry on a pnpr at `base`: the same packages as
 * `npmRegistryUrl`, each served as the uncompressed tar of its `.tgz` with
 * whatever content coding the client accepts — zstd, for pnpm. Only the
 * `pnpm + pnpr` scenario installs from it; it is a pnpm-and-pnpr feature, and
 * every other column keeps the `.tgz` registry the rest of the world serves.
 */
export function tarRegistryUrl (base) {
  return `${base}/npm/~${TAR_REGISTRY}/`
}

export function installPnpr (managersDir) {
  // Like pnpm 12 and Bun, the binary arrives through an install script.
  const result = spawn.sync('pnpm', ['add', '@pnpm/pnpr@next', '--allow-build=@pnpm/pnpr'], {
    cwd: managersDir,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Installing pnpr failed with status code ${result.status}`)
  }
}

export function pnprVersion (managersDir) {
  const { status, stdout, stderr } = spawn.sync('pnpr', ['--version'], {
    cwd: managersDir,
    env: createEnv(managersDir),
  })
  if (status !== 0) {
    throw new Error(`Couldn't detect the version of pnpr. ${stderr?.toString() ?? ''}`)
  }
  return stdout.toString().trim().replace(/^\D+/, '')
}

/**
 * Starts a pnpr that proxies the public registry. Its cache is kept for the
 * whole run so that every manager is measured against the same warm
 * registry rather than against however much of npmjs happened to be cached
 * when its turn came.
 */
export async function startPnpr ({ managersDir, dir, port, publicUrl, logLevel = 'error' }) {
  fs.mkdirSync(dir, { recursive: true })
  const configPath = path.join(dir, 'pnpr.yaml')
  fs.writeFileSync(configPath, [
    `storage: ${path.join(dir, 'storage')}`,
    'auth:',
    '  htpasswd:',
    `    file: ${path.join(dir, 'htpasswd')}`,
    // The benchmark registers its own resolver user on startup.
    '    maxUsers: 1',
    'registries:',
    // The public npm registry. No `packages:` map, so it claims every
    // name — the catch-all, and therefore last in the router's sources.
    '  npmjs:',
    '    type: upstream',
    '    url: https://registry.npmjs.org/',
    '    public: true',
    // Bit publishes to a registry of its own, and `alotta-packages`
    // depends on it. Declaring the scopes it serves is all the routing
    // that is needed: every manager keeps installing from the one
    // registry URL the benchmark hands it, and the names below are the
    // only ones fetched from bit. Tarball URLs come back rewritten to
    // pnpr's own address, so bit's packages cross the emulated link
    // like every other package.
    '  bit:',
    '    type: upstream',
    `    url: ${BIT_REGISTRY}`,
    '    public: true',
    '    packages:',
    ...BIT_SCOPES.map((scope) => `      '${scope}/*':`),
    // One URL in front of both: a router resolves a name to the first
    // source whose declared packages claim it. `defaultRegistry` has to
    // name *this* rather than a concrete registry — a concrete one
    // resolves only its own namespace and answers `Unclaimed` for
    // everything else, with no fall-through to a sibling.
    '  main:',
    '    type: router',
    '    sources: [bit, npmjs]',
    // The same sources again, served as tars rather than `.tgz` files (see
    // `tarRegistryUrl`). One storage behind both: a package pulled through
    // either is cached once.
    `  ${TAR_REGISTRY}:`,
    '    type: router',
    '    sources: [bit, npmjs]',
    '    tarballs: tar',
    'defaultRegistry: main',
    'resolver:',
    '  enabled: true',
    // The accelerated scenario asks the server to resolve against this
    // address — its own un-proxied tar registry — so the resolver's metadata fetches
    // stay on loopback instead of crossing the emulated link and coming back
    // in through the front door (see `applyPnprServerRegistry`). The server
    // resolves against whatever registry the client sends but only if that
    // registry is declared, so the address has to be listed as a route here.
    'routes:',
    '  public:',
    `    - registry: ${tarRegistryUrl(`http://127.0.0.1:${port}`)}`,
    'log:',
    '  type: stdout',
    '  format: pretty',
    `  level: ${logLevel}`,
    '',
  ].join('\n'))

  // pnpr's output goes to a file rather than a pipe. Installs are measured with
  // a synchronous spawn, so nothing in this process drains a pipe while one is
  // running: the buffer would fill, pnpr would block writing to it, and the
  // registry would stop answering midway through a scenario.
  const logPath = path.join(dir, 'pnpr.log')
  const logFd = fs.openSync(logPath, 'a')
  const proc = spawn('pnpr', [
    '-c', configPath,
    '--listen', `127.0.0.1:${port}`,
    // pnpr rewrites the tarball URLs it serves to this address. It has to be
    // the address clients actually use, or every tarball would be fetched on a
    // link the benchmark isn't emulating — and npm refuses outright to fetch a
    // tarball from a host other than the registry it was told about.
    ...(publicUrl ? ['--public-url', publicUrl] : []),
    // Packuments are fetched from npmjs once and then treated as authoritative,
    // so no scenario pays for a revalidation another scenario already paid for.
    '--packument-ttl', '365d',
  ], {
    cwd: managersDir,
    env: createEnv(managersDir),
    stdio: ['ignore', logFd, logFd],
  })
  fs.closeSync(logFd)
  proc.on('error', (err) => {
    throw err
  })

  const readLog = () => {
    try {
      return fs.readFileSync(logPath, 'utf8')
    } catch {
      return ''
    }
  }

  let exit = null
  proc.on('exit', (code, signal) => {
    exit = { code, signal }
  })

  const url = `http://127.0.0.1:${port}`
  await waitForPnpr(url, proc, readLog)
  return {
    url,
    log: readLog,
    /** A registry that died mid-run makes everything measured after it worthless. */
    assertAlive: () => {
      if (!exit) return
      throw new Error(
        `pnpr exited (code ${exit.code}, signal ${exit.signal}). Its log:\n${readLog().slice(-4000)}`
      )
    },
    // A registry that outlives its run is what made the second benchmark of a
    // job fail: it held the port, answered the next run's health check, and
    // served tarball URLs pointing at a proxy that no longer existed. Make sure
    // it is gone rather than merely asked to leave.
    stop: () => {
      if (exit) return
      proc.kill()
      setTimeout(() => {
        if (!exit) proc.kill('SIGKILL')
      }, 2_000).unref()
    },
  }
}

async function waitForPnpr (url, proc, getStderr) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`pnpr exited with code ${proc.exitCode}. ${getStderr()}`)
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- polling: each check waits for the previous delay
      const res = await fetch(`${url}/-/ping`)
      if (res.ok) {
        // Something answering is not the same as our server answering. A server
        // left behind by an earlier run replies at once, well before the process
        // started here has had time to discover it cannot have the port and
        // exit, so the reply alone proves nothing — give it long enough to fail
        // and then insist it is still running.
        // eslint-disable-next-line no-await-in-loop -- gives a stale server time to be told apart from ours
        await new Promise((resolve) => setTimeout(resolve, 500))
        if (proc.exitCode !== null) {
          throw new Error(
            `pnpr exited with code ${proc.exitCode} yet ${url} still answers, so another ` +
            `server holds that port and the benchmark would run against it. ${getStderr()}`
          )
        }
        return
      }
    } catch (err) {
      if (err.message?.startsWith('pnpr exited')) throw err
      // Not listening yet.
    }
    // eslint-disable-next-line no-await-in-loop -- polling: each check waits for the previous delay
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`pnpr did not start listening on ${url}. ${getStderr()}`)
}

/**
 * pnpr serves packages anonymously but requires authentication to resolve, so
 * the accelerated scenario needs a token.
 */
export async function mintToken (url) {
  const res = await fetch(`${url}/-/user/org.couchdb.user:${USERNAME}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: USERNAME, password: PASSWORD }),
  })
  if (!res.ok) {
    throw new Error(`Couldn't register a pnpr user: ${res.status} ${res.statusText}`)
  }
  const { token } = await res.json()
  if (!token) throw new Error('pnpr returned no token')
  return token
}

/**
 * Fills pnpr's cache by installing the fixture, untimed and without the
 * emulated link in the way. Without this the first manager measured would pay
 * for pulling every package from npmjs into pnpr and the rest would not.
 *
 * It installs twice from each registry: once with the fixture as it is, and
 * once with the dependencies the `updatedDependencies` scenario adds. That
 * scenario installs a different graph than the fixture's, and a registry
 * warmed only for the fixture would make the first manager's measured update
 * run the one that pulls the whole updated graph out of npmjs.
 *
 * The tar registry needs warming of its own, on top of the `.tgz` one, even
 * though both serve from the same cache. pnpr learns the hash of a proxied
 * package's tar only the first time it serves that tar, and until then the
 * package's metadata carries no integrity — so a resolver meeting such a
 * package downloads the tarball in the middle of resolving to hash it. Then
 * the level-19 zstd encodings are made: see `warmZstdEncodings`.
 */
export async function populateCache ({ pm, managersDir, dir, registry, tarRegistry, fixtureDir }) {
  const cwd = path.join(dir, 'populate')
  // The packages the `.tgz` installs resolved, with the `.tgz` integrity
  // pnpr names their level-19 encodings by.
  const packages = new Map()
  for (const [label, reg, tarRegistries] of [
    ['.tgz', registry, undefined],
    ['tar', tarRegistry, [tarRegistry]],
  ]) {
    fs.rmSync(cwd, { recursive: true, force: true })
    fs.mkdirSync(cwd, { recursive: true })
    fs.copyFileSync(path.join(fixtureDir, 'package.json'), path.join(cwd, 'package.json'))
    fs.writeFileSync(path.join(cwd, '.npmrc'), `registry=${reg}\n`)
    // The same workspace manifest the measured pnpm scenarios install under,
    // so the populate pass resolves the same universe of versions they will.
    // Declaring a workspace root also stops pnpm walking up into the manager
    // directory above, whose own lockfile is for pnpr's dependencies and has
    // nothing to do with the fixture.
    fs.writeFileSync(path.join(cwd, 'pnpm-workspace.yaml'), pnpmWorkspaceYaml({ tarRegistries }))

    // The populate client's own store and cache live under the throwaway
    // project, not wherever the machine keeps them: pnpm 12 puts its store
    // at `$PNPM_HOME/store`, so an inherited `PNPM_HOME` would fill the
    // developer's — or the runner's — real store with this graph, and a
    // second populate would then be measuring a machine that had already
    // seen it.
    const env = Object.create(createEnv(managersDir))
    env.PNPM_HOME = path.join(cwd, 'home')
    env.PNPM_CONFIG_CACHE_DIR = path.join(cwd, 'home', 'cache')

    const install = (graph) => {
      const args = [...pm.args.filter((arg) => !arg.startsWith('--registry=')), `--registry=${reg}`, '--no-frozen-lockfile']
      const result = spawn.sync(pm.name, args, { cwd, env, stdio: 'inherit' })
      if (result.error) throw result.error
      if (result.status !== 0) {
        throw new Error(`Populating the pnpr cache (${label} registry, ${graph}) failed with status code ${result.status}`)
      }
      if (label === '.tgz') collectLockedPackages(path.join(cwd, 'pnpm-lock.yaml'), registry, packages)
    }
    install('fixture')

    const packageJsonPath = path.join(cwd, 'package.json')
    const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    manifest.dependencies = { ...manifest.dependencies, ...UPDATED_DEPENDENCIES }
    fs.writeFileSync(packageJsonPath, JSON.stringify(manifest))
    install('updated dependencies')
  }
  await warmZstdEncodings({ storageDir: path.join(dir, 'storage'), tarRegistry, packages })
}

/** Adds every registry package a lockfile pins to `packages`, keyed by `name@version`. */
export function collectLockedPackages (lockfilePath, registry, packages) {
  const lockfile = loadYamlFileSync(lockfilePath)
  let added = 0
  for (const [key, entry] of Object.entries(lockfile?.packages ?? {})) {
    const integrity = entry?.resolution?.integrity
    const tarball = entry?.resolution?.tarball
    // A tarball, git or directory dependency is not the registry's to encode.
    // pnpr rewrites a registry package's dist.tarball to `<registry><name>@<version>`,
    // which pnpm records in `resolution.tarball` when `serverType: pnpr` is not set.
    if (!integrity || entry.resolution.type || (tarball && !tarball.startsWith(registry))) continue
    const at = key.indexOf('@', 1)
    packages.set(key, { name: key.slice(0, at), version: key.slice(at + 1), integrity })
    added++
  }
  if (added === 0) {
    throw new Error(`No registry packages found in ${lockfilePath}`)
  }
}

/** How many copies may wait for pnpr's worker before another tar is asked for: below its queue of 32, which drops what it has no room for. */
const ZSTD_IN_FLIGHT = 16
/**
 * How long the worker may go without finishing a copy before it is taken to
 * be stuck. One tar near the 256 MiB limit takes minutes at level 19 on a CI
 * runner, so this is generous.
 */
const ZSTD_STALL_MS = 300_000
/** How many passes over the tars still missing an encoding, for copies pnpr dropped anyway (its 1 GiB quota of copies, say). */
const ZSTD_ROUNDS = 3

/**
 * Has pnpr make the level-19 zstd encoding of every tar the fixtures install.
 *
 * pnpr answers a zstd request for a tar with a level-19 encoding once it has
 * stored one. Until then it compresses at level 3 while it streams, and hands
 * a copy to a single background worker that makes the level-19 encoding — or
 * drops the copy, when the worker's queue is full. A registry in service
 * reaches the level-19 state for everything it is asked for often; a
 * benchmark that installs five thousand packages in one burst never would,
 * and would be measuring a registry compressing on the fly with no encoding
 * on disk, which is the state no real registry stays in. Worse, the copies
 * queued during the measured installs would keep the worker compressing
 * through the rows after them, on the cores the timed install is using.
 *
 * So the tars are asked for here, untimed, each only once the worker's queue
 * has room for it. Every copy waiting for the worker, or being encoded, is a
 * `<hash>.copy.tmp.*` file beside where its encoding will go, removed when
 * the worker is done with it or drops it, so counting those files is counting
 * the queue. The install that ran just before leaves it full, with large tars
 * among the copies, so the first wait can be long.
 *
 * This reads where pnpr keeps the encodings (the `~tar-zstd19` namespace of
 * its cache, in the storage's layout). If none appear there, the warm-up
 * fails rather than leaving the measured runs to benchmark level 3.
 */
export async function warmZstdEncodings ({ storageDir, tarRegistry, packages }) {
  const variantsDir = path.join(storageDir, '.pnpr-cache', '~tar-zstd19', 'packages')
  const encoded = (pkg) => fs.existsSync(variantPath(variantsDir, pkg))
  await waitForWorker(variantsDir, 0)
  let missing = [...packages.values()].filter((pkg) => !encoded(pkg))
  console.log(`# making level-19 zstd encodings for ${missing.length} of ${packages.size} tars`)
  const started = Date.now()
  // Tars over 256 MiB are never encoded at level 19, so they are asked for
  // on every pass and are what the last one leaves missing.
  for (let round = 0; round < ZSTD_ROUNDS && missing.length > 0; round++) {
    let room = 0
    for (const pkg of missing) {
      // eslint-disable-next-line no-await-in-loop -- throttles to the copies the zstd worker can take
      if (room === 0) room = ZSTD_IN_FLIGHT - await waitForWorker(variantsDir, ZSTD_IN_FLIGHT - 1)
      // eslint-disable-next-line no-await-in-loop -- throttles to the copies the zstd worker can take
      await drain(`${tarRegistry}${pkg.name}@${pkg.version}`)
      room--
    }
    // eslint-disable-next-line no-await-in-loop -- waits for the worker to drain before the next round
    await waitForWorker(variantsDir, 0)
    missing = missing.filter((pkg) => !encoded(pkg))
  }
  if (packages.size === 0 || missing.length === packages.size) {
    throw new Error(`No level-19 zstd encoding appeared at the expected path under ${variantsDir}`)
  }
  console.log(`# level-19 zstd encodings made in ${Math.round((Date.now() - started) / 1000)}s` +
    (missing.length ? `; ${missing.length} tars stay at level 3` : ''))
}

/** Where pnpr stores the level-19 zstd encoding of `pkg` under `variantsDir`. */
export function variantPath (variantsDir, { name, integrity }) {
  return path.join(
    variantsDir,
    ...packageSegments(name),
    'blobs',
    `${crypto.createHash('sha256').update(integrity).digest('hex')}.tar.zst`
  )
}

/**
 * pnpr's directory segments for an npm package name below `packages/`:
 * `@<scope>/<name>` for a scoped package, `@/<name>` otherwise.
 */
export function packageSegments (name) {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/')
    if (slash > 1 && slash < name.length - 1) {
      return [`@${encodeSegment(name.slice(1, slash))}`, encodeSegment(name.slice(slash + 1))]
    }
  }
  return ['@', encodeSegment(name)]
}

/**
 * Waits until at most `max` copies wait for pnpr's worker, and returns how
 * many do. Throws when the worker finishes none of them for `ZSTD_STALL_MS`:
 * carrying on would leave it compressing through the measured rows.
 */
async function waitForWorker (variantsDir, max) {
  let queued = countCopies(variantsDir)
  let lastProgress = Date.now()
  while (queued > max) {
    if (Date.now() - lastProgress > ZSTD_STALL_MS) {
      throw new Error(`pnpr's zstd worker finished nothing in ${ZSTD_STALL_MS / 1000}s with ${queued} copies queued under ${variantsDir}`)
    }
    // eslint-disable-next-line no-await-in-loop -- polling: each check waits for the previous delay
    await new Promise((resolve) => setTimeout(resolve, 250))
    const now = countCopies(variantsDir)
    if (now < queued) lastProgress = Date.now()
    queued = now
  }
  return queued
}

function countCopies (variantsDir) {
  if (!fs.existsSync(variantsDir)) return 0
  return fs.readdirSync(variantsDir, { recursive: true }).filter((file) => file.includes('.copy.tmp.')).length
}

/** pnpr's path segment for a name: `[a-z0-9._-]` as is, any other byte as `!` and two hex digits. */
function encodeSegment (text) {
  let encoded = ''
  for (const byte of Buffer.from(text)) {
    encoded += /[a-z0-9._-]/.test(String.fromCharCode(byte))
      ? String.fromCharCode(byte)
      : `!${byte.toString(16).padStart(2, '0')}`
  }
  return encoded
}

/** Fetches `url` as pnpm would, asking for zstd, and throws the body away. */
function drain (url) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { 'accept-encoding': 'zstd' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`pnpr answered ${res.statusCode} for ${url}`))
        return
      }
      res.on('end', resolve)
      res.on('error', reject)
      res.resume()
    }).on('error', reject)
  })
}

/**
 * pnpm resolves on its own whenever it can't use the server, and says so only
 * in its output — an unusable server leaves no trace in pnpr's storage, which
 * the registry traffic fills either way. That failure would silently turn the
 * accelerated row into a copy of the plain pnpm row, so it is checked here
 * with one untimed install rather than during a measured one.
 */
export function verifyResolverIsUsed ({ pm, managersDir, dir, registry, authToken, pnprServer, pnprServerRegistry, fixtureDir, serverLog }) {
  const cwd = path.join(dir, 'verify')
  fs.rmSync(cwd, { recursive: true, force: true })
  fs.mkdirSync(cwd, { recursive: true })
  fs.copyFileSync(path.join(fixtureDir, 'package.json'), path.join(cwd, 'package.json'))
  // The resolver answers on a link of its own, so it is a different host than
  // the registry and needs the credential declared against its own address.
  const hosts = new Set([registry, pnprServer].map((url) => new URL(url).host))
  const auth = [...hosts].map((host) => `//${host}/:_authToken=${authToken}\n`).join('')
  fs.writeFileSync(path.join(cwd, '.npmrc'), `registry=${registry}\n${auth}`)
  // `registry` and `pnprServerRegistry` are the same tar registry, reached
  // across the link and next to the server, and each has to be declared one.
  fs.writeFileSync(
    path.join(cwd, 'pnpm-workspace.yaml'),
    pnpmWorkspaceYaml({ pnprServer, tarRegistries: [registry, pnprServerRegistry].filter(Boolean) })
  )

  const resolveCalls = () => (serverLog().match(/uri=\/-\/pnpr\/v0\/resolve/g) ?? []).length
  const before = resolveCalls()
  const env = createEnv(managersDir)
  if (pnprServerRegistry) {
    // Verified under the same override the measured scenario runs with, so
    // what this proves is the configuration that is actually measured.
    applyPnprServerRegistry(env, pnprServerRegistry)
  }
  if (pm.rustEngine) {
    // Same store and cache redirection the measured scenarios get: pnpm 12
    // keeps its store at $PNPM_HOME/store and its packument mirror at the
    // machine-global cacheDir, and this one-off install should write into
    // neither the machine's real store nor its real cache.
    env.PNPM_HOME = path.join(cwd, 'cache')
    env.PNPM_CONFIG_CACHE_DIR = path.join(cwd, 'cache', 'cache')
  }
  const result = spawn.sync(pm.name, [...pm.args, '--no-frozen-lockfile'], {
    cwd,
    env,
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== 0) {
    throw new Error(`Verifying pnpr resolution failed with status code ${result.status}. ${output}`)
  }
  // The server's own request log is the evidence, rather than anything pnpm
  // prints: what a package manager writes to its terminal is not a contract,
  // and a reworded line should not be able to abort a benchmark that is working.
  if (resolveCalls() === before) {
    throw new Error(
      'pnpr recorded no resolution request, so pnpm resolved on its own and ' +
      `the accelerated scenario would measure a plain install. Its output was:\n${output}`
    )
  }
}
