'use strict'
import spawn from 'cross-spawn'
import benchmark, { createEnv } from './benchmarkFixture.js'
import path from 'path'
import writeYamlFile from 'write-yaml-file'
import { loadYamlFile } from 'load-yaml-file'
import { fileURLToPath } from 'url'

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
const RESULTS = path.join(DIRNAME, 'results')

export default async function (pm, fixture, opts) {
  opts = opts || {}
  const limitRuns = opts.limitRuns || Infinity
  // Sections that don't install a fixture (the Node.js version managers, for
  // instance) pass their own benchmark function but record results the same way.
  const runBenchmark = opts.benchmarkFn ?? benchmark

  // Tools without an executable to ask (nvm is a shell function) report their
  // version through `opts.getVersion`.
  pm.version = opts.getVersion?.(pm, opts) ?? getPMVersion(pm.name, opts)
  // Results are normally filed under the fixture's own name. A caller that
  // measures the same fixture under different conditions files them elsewhere,
  // so runs made under one set of conditions are never pooled with another's.
  const resultsFile = path.join(RESULTS, pm.scenario, pm.version, `${opts.resultsName ?? fixture}.yaml`)
  const prevResults = await safeLoadYamlFile(resultsFile) || []

  if (prevResults.length >= limitRuns) return prevResults

  const newResults = await runBenchmark(pm, fixture, {
    hasNodeModules: opts.hasNodeModules,
    managersDir: opts.managersDir,
    registry: opts.registry,
    authToken: opts.authToken,
    pnprServer: opts.pnprServer,
    pnprServerRegistry: opts.pnprServerRegistry,
  })
  const results = [...prevResults, newResults]
  await writeYamlFile(resultsFile, results)
  return results
}

/**
 * Loads results a previous run recorded, without measuring anything.
 *
 * This is what lets the measuring runs happen in parallel jobs: each records
 * its samples, and one job afterwards draws the page from all of them. The
 * version can't be detected here the way a measuring run detects it — nothing
 * is installed — so the caller supplies the one the run that measured these
 * results reported.
 */
export async function readRecordedResults (pm, fixture, opts = {}) {
  const version = opts.version ?? pm.version
  if (!version) {
    throw new Error(`No recorded version for ${pm.scenario}, so its results can't be located.`)
  }
  pm.version = version
  const resultsFile = path.join(RESULTS, pm.scenario, version, `${opts.resultsName ?? fixture}.yaml`)
  const results = await safeLoadYamlFile(resultsFile)
  if (!results?.length) {
    throw new Error(
      `No recorded results at ${resultsFile}. A reporting run draws the page from what a ` +
      `measuring run recorded; it measures nothing itself.`
    )
  }
  return results
}

function getPMVersion (pmName, opts) {
  const { status, stdout, stderr } = spawn.sync(pmName, ['--version'], {
    cwd: opts.managersDir,
    env: createEnv(opts.managersDir),
  })
  if (status !== 0) {
    throw new Error(`Couldn't detect version of ${pmName}. ${stderr?.toString()}`)
  }
  // pnpm 12 currently prints "pnpm v<version>" (a fix is in progress); other PMs
  // print just the version. Strip any leading non-digit prefix to normalize.
  return stdout.toString().trim().replace(/^\D+/, '')
}

async function safeLoadYamlFile (filename) {
  try {
    return await loadYamlFile(filename)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return null
  }
}
