'use strict'
import fs from 'fs'
import net from 'net'
import path from 'path'
import spawn from 'cross-spawn'
import { createEnv } from './benchmarkFixture.js'

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
    '    max_users: 1',
    'registries:',
    '  npmjs:',
    '    type: upstream',
    '    url: https://registry.npmjs.org/',
    '    public: true',
    'defaultRegistry: npmjs',
    'resolver:',
    '  enabled: true',
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
    '--packument-ttl-secs', '31536000',
  ], {
    cwd: managersDir,
    env: createEnv(managersDir),
    stdio: ['ignore', logFd, logFd],
  })
  fs.closeSync(logFd)
  proc.on('error', (err) => { throw err })

  const readLog = () => {
    try {
      return fs.readFileSync(logPath, 'utf8')
    } catch {
      return ''
    }
  }

  let exit = null
  proc.on('exit', (code, signal) => { exit = { code, signal } })

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
      setTimeout(() => { if (!exit) proc.kill('SIGKILL') }, 2_000).unref()
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
      const res = await fetch(`${url}/-/ping`)
      if (res.ok) {
        // Something answering is not the same as our server answering. A server
        // left behind by an earlier run replies at once, well before the process
        // started here has had time to discover it cannot have the port and
        // exit, so the reply alone proves nothing — give it long enough to fail
        // and then insist it is still running.
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
 * Fills pnpr's cache by installing the fixture once, untimed and without the
 * emulated link in the way. Without this the first manager measured would pay
 * for pulling every package from npmjs into pnpr and the rest would not.
 */
export function populateCache ({ pm, managersDir, dir, registry, fixtureDir }) {
  const cwd = path.join(dir, 'populate')
  fs.rmSync(cwd, { recursive: true, force: true })
  fs.mkdirSync(cwd, { recursive: true })
  fs.copyFileSync(path.join(fixtureDir, 'package.json'), path.join(cwd, 'package.json'))
  fs.writeFileSync(path.join(cwd, '.npmrc'), `registry=${registry}\n`)
  // Declaring a workspace root stops pnpm walking up into the manager
  // directory above, whose own lockfile is for pnpr's dependencies and has
  // nothing to do with the fixture.
  fs.writeFileSync(path.join(cwd, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n")

  const result = spawn.sync(pm.name, [...pm.args, '--no-frozen-lockfile'], {
    cwd,
    env: createEnv(managersDir),
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Populating the pnpr cache failed with status code ${result.status}`)
  }
}

/**
 * pnpm resolves on its own whenever it can't use the server, and says so only
 * in its output — an unusable server leaves no trace in pnpr's storage, which
 * the registry traffic fills either way. That failure would silently turn the
 * accelerated row into a copy of the plain pnpm row, so it is checked here
 * with one untimed install rather than during a measured one.
 */
export function verifyResolverIsUsed ({ pm, managersDir, dir, registry, authToken, pnprServer, fixtureDir, serverLog }) {
  const cwd = path.join(dir, 'verify')
  fs.rmSync(cwd, { recursive: true, force: true })
  fs.mkdirSync(cwd, { recursive: true })
  fs.copyFileSync(path.join(fixtureDir, 'package.json'), path.join(cwd, 'package.json'))
  // The resolver answers on a link of its own, so it is a different host than
  // the registry and needs the credential declared against its own address.
  const hosts = new Set([registry, pnprServer].map((url) => new URL(url).host))
  const auth = [...hosts].map((host) => `//${host}/:_authToken=${authToken}\n`).join('')
  fs.writeFileSync(path.join(cwd, '.npmrc'), `registry=${registry}\n${auth}`)
  fs.writeFileSync(path.join(cwd, 'pnpm-workspace.yaml'), `packages:\n  - '.'\npnprServer: ${pnprServer}\n`)

  const resolveCalls = () => (serverLog().match(/uri=\/-\/pnpr\/v0\/resolve/g) ?? []).length
  const before = resolveCalls()
  const env = createEnv(managersDir)
  if (pm.rustEngine) {
    // Same store redirection the measured scenarios get: pnpm 12 keeps its
    // store at $PNPM_HOME/store, and this one-off install should not write
    // into the machine's real store.
    env.PNPM_HOME = path.join(cwd, 'cache')
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
