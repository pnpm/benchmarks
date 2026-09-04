'use strict'
import fs from 'fs'
import path from 'path'
import tempy from 'tempy'
import { fileURLToPath } from 'url'
import cmdsMap from './commandsMap.js'
import { fixtureNames } from './fixtures.js'
import { bootstrapInstaller, provisionPnpm12 } from './setupPackageManagers.js'
import { installPnpr, populateCache, reservePort, startPnpr } from './pnprServer.js'

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
/** Where the populated storage lands, unless a path is given. */
const DEFAULT_OUT = path.join(DIRNAME, '.pnpr-cache')

/**
 * Fills a pnpr storage directory with everything the fixtures need, so a
 * measuring run can start from it instead of pulling the graph from the
 * public registries itself.
 *
 * The warm-up is the slowest part of a run and it is the same work every
 * time: with the `alotta-packages` fixture it means fetching some 5.4k
 * packages — about 3 GB of storage — before a single number is measured.
 * Three parallel sample jobs each doing that is three times the load on
 * npmjs and bit for one identical result, and worse, it is three
 * *different* results whenever something publishes between them: each job
 * would resolve its own view of the graph and the samples would no longer
 * be samples of the same thing.
 *
 * Nothing is measured here and no network is emulated, so the server runs
 * on its own port with no latency proxy in front of it. Only the storage
 * directory it leaves behind matters.
 */
async function run () {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT
  const tmpDir = tempy.directory()
  const managersDirs = {
    pnpm: path.join(tmpDir, 'pnpm'),
    pnpr: path.join(tmpDir, 'pnpr'),
  }
  for (const dir of Object.values(managersDirs)) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8')
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - '.'\nminimumReleaseAge: 0\n", 'utf8')
  }
  // Only the client the populate pass installs with, not the whole set the
  // benchmark measures: nothing here is timed, so the other managers would
  // be provisioned for no one.
  const installerPnpm = bootstrapInstaller(path.join(tmpDir, 'setup'))
  provisionPnpm12(installerPnpm, managersDirs.pnpm)
  installPnpr(managersDirs.pnpr)

  const dir = path.join(managersDirs.pnpr, 'server')
  const port = await reservePort()
  const server = await startPnpr({ managersDir: managersDirs.pnpr, dir, port })
  try {
    for (const fixtureName of fixtureNames) {
      populateCache({
        pm: withRegistry(cmdsMap.pnpm12, server.url),
        managersDir: managersDirs.pnpm,
        dir,
        registry: server.url,
        fixtureDir: path.join(DIRNAME, 'fixtures', fixtureName),
      })
      server.assertAlive()
    }
  } finally {
    server.stop()
  }

  // Copied rather than moved: the server's directory holds its config, its
  // log and the throwaway project the populate installs ran in, none of
  // which a measuring run should inherit.
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.cpSync(path.join(dir, 'storage'), path.join(out, 'storage'), { recursive: true })
  console.log(`Wrote the populated pnpr storage to ${out}`)
}

/** The same registry pointing `withRegistry` does in `benchmarkRegistry.js`. */
function withRegistry (pm, registry) {
  if (pm.name === 'yarn') return pm
  return {
    ...pm,
    args: [...pm.args.filter((arg) => !arg.startsWith('--registry=')), `--registry=${registry}`],
  }
}

run()
  .then(() => console.log('done'))
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
