'use strict'
import fs from 'fs'
import rimraf from 'rimraf'
import tempy from 'tempy'
import cmdsMap from './commandsMap.js'
import nodeManagersMap from './nodeManagersMap.js'
import benchmark, { LIMIT_RUNS, readRecordedResults } from './recordBenchmark.js'
import benchmarkNodeVersions, {
  cloneNvm,
  readManagerVersion,
  PRIMARY_NODE_VERSION,
  SECONDARY_NODE_VERSION,
} from './benchmarkNodeVersions.js'
import { startBenchmarkRegistry, ROUND_TRIP_MS, BANDWIDTH_MBPS, RESULTS_SUFFIX } from './benchmarkRegistry.js'
import { bootstrapInstaller, provisionPackageManagers } from './setupPackageManagers.js'
import path from 'path'
import { fileURLToPath } from 'url'

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
const TMP = path.join(DIRNAME, '.tmp')
// What a run publishes: the numbers, the versions they were measured with, and
// the conditions they were measured under. Nothing here decides what a reader
// is shown — which columns a page carries, what the rows are called, what the
// charts look like — because nothing here can: the numbers outlive any one
// presentation of them. https://github.com/pnpm/pnpm.io reads this file and
// draws the page at https://pnpm.io/benchmarks from it.
const MANIFEST = path.join(DIRNAME, 'benchmarks.json')
// What a measuring run records about the tools it measured, so that a
// reporting run can locate the results without provisioning anything. It
// belongs to a run rather than to the repository, which is why it is written
// next to the code and never committed.
const VERSIONS_FILE = path.join(DIRNAME, 'versions.json')

const fixtures = [
  /* 'react-app', 'ember-quickstart', 'angular-quickstart', 'medium-size-app' */
  'alotta-files',
]

// The package managers measured on every fixture. A key is the name the
// results are filed under and the name the manifest reports them by; what the
// key means to a reader — and whether a reader is shown it at all — is the
// reading side's business. pnpm.io publishes npm and the pnpm columns; the
// rest are measured for comparisons of our own and reported just the same.
const pmConfigs = [
  { key: 'npm' },
  { key: 'pnpm11' },
  { key: 'pnpm12' },
  // The same pnpm 12 again, linking differently: a virtual store shared
  // between projects, and a flat `node_modules` with no virtual store at all.
  { key: 'pnpm12_global_virtual_store' },
  { key: 'pnpm12_hoisted' },
  // The same pnpm 12 as the row above, resolving the dependency graph on the
  // registry instead of walking it itself, so pnpr is the only difference
  // between the two.
  { key: 'pnpm_pnpr' },
  { key: 'yarn' },
  { key: 'bun' },
]

const tests = [
  'firstInstall',
  'withWarmModules',
  'withLockfile',
  'withWarmCacheAndModules',
  'withWarmCache',
  'withWarmCacheAndLockfile',
  'withWarmModulesAndLockfile',
  'repeatInstall',
  'updatedDependencies'
]

// The scenarios the Node.js version managers are measured on. They live in
// `benchmarkNodeVersions.js`; these are the keys it reports.
const nodeVersionTests = [
  'cleanInstall',
  'warmStoreInstall',
  'runInProject',
]

run()
  .then(() => console.log('done'))
  .catch(err => {
    console.error(err)
    // Without this the benchmark reports success to CI no matter what failed.
    process.exitCode = 1
  })

/**
 * `--report-only` rebuilds the manifest from results already recorded, without
 * provisioning a package manager or starting a registry.
 *
 * That is what lets the measuring runs happen in parallel jobs: each of them
 * records its samples and reports the versions it measured, and one job
 * afterwards merges those samples and writes the manifest from them. A
 * reporting run measures nothing, so it can't invent a number a measuring run
 * failed to record — it fails instead.
 */
async function run () {
  if (process.argv.includes('--report-only')) {
    await report()
    return
  }
  await measure()
}

async function report () {
  const versionsFile = process.env.BENCHMARK_VERSIONS ?? VERSIONS_FILE
  let versions
  try {
    versions = JSON.parse(fs.readFileSync(versionsFile, 'utf8'))
  } catch (err) {
    throw new Error(
      `Couldn't read the versions a measuring run recorded at ${versionsFile}. ` +
      `A reporting run needs it to label the manifest and to find the results. ${err.message}`
    )
  }
  // The manifest crosses a job boundary, so it is worth insisting on rather
  // than reading hopefully. A missing package manager would at least be caught
  // downstream by the results not being where its version says they are, but a
  // missing pnpr version is caught nowhere: the numbers would go out saying the
  // registry they were measured against was `vundefined`.
  for (const field of ['node', 'pnpr', 'packageManagers', 'nodeManagers']) {
    if (versions?.[field] == null) {
      throw new Error(`The versions recorded at ${versionsFile} carry no \`${field}\`.`)
    }
  }
  for (const { key } of pmConfigs) {
    if (!versions.packageManagers[key]) {
      throw new Error(`The versions recorded at ${versionsFile} carry no version for ${key}.`)
    }
  }
  // The same check for the Node.js section, over the tools the manifest is
  // written from, so what is demanded here is exactly what a measuring run
  // records.
  for (const key of Object.keys(nodeManagersMap)) {
    if (!versions.nodeManagers[key]) {
      throw new Error(`The versions recorded at ${versionsFile} carry no version for ${key} in the Node.js section.`)
    }
  }
  // The same command objects the measuring run drew from, carrying the
  // versions it measured rather than versions detected here — nothing is
  // installed in a reporting run to detect them from.
  const pmCommands = Object.fromEntries(
    Object.entries(cmdsMap).map(([key, pm]) => [key, { ...pm, version: versions.packageManagers[key] }])
  )
  const measuredFixtures = await collectFixtures({
    pmCommands,
    runFixture: ({ key }, fixtureName) => readRecordedResults(pmCommands[key], fixtureName, {
      resultsName: `${fixtureName}${RESULTS_SUFFIX}`,
    }),
  })
  const nodeManagers = await collectNodeVersionManagers({
    versionOf: (key) => versions.nodeManagers[key],
    runManager: (pm) => readRecordedResults(pm, 'node-versions', {
      version: versions.nodeManagers[pm.scenario],
    }),
  })
  writeManifest({
    node: versions.node,
    registryVersion: versions.pnpr,
    fixtures: measuredFixtures,
    nodeManagers,
  })
}

/**
 * Records what a reporting run needs and cannot work out for itself: which
 * version of each tool these results were measured with, and on which Node.js.
 */
function writeVersionsManifest ({ pmCommands, registryVersion }) {
  const versionsOf = (map) => Object.fromEntries(
    Object.entries(map).map(([key, pm]) => [key, pm.version])
  )
  fs.writeFileSync(VERSIONS_FILE, `${JSON.stringify({
    node: process.version,
    pnpr: registryVersion,
    packageManagers: versionsOf(pmCommands),
    nodeManagers: versionsOf(nodeManagersMap),
  }, null, 2)}\n`, 'utf8')
}

async function measure () {
  const tmpDir = tempy.directory()
  const managersDirs = {}
  for (const pm of ['npm', 'pnpm11', 'pnpm12', 'yarn', 'bun', 'fnm', 'nvm', 'pnpr']) {
    managersDirs[pm] = path.join(tmpDir, pm)
  }
  await Promise.allSettled([
    rimraf(TMP),
    ...Object.values(managersDirs).map(dir => fs.promises.mkdir(dir, { recursive: true })),
  ])
  for (const dir of Object.values(managersDirs)) {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8')
    // pnpm holds versions younger than `minimumReleaseAge` back, so a
    // freshly published `pnpm@next-12` (or any other manager released within
    // the window) would silently benchmark the previous release for days.
    // The benchmark exists to measure the latest of everything, so the hold
    // is turned off where the managers are installed. The yaml is what the
    // Rust engine reads reliably — its `.npmrc`/`--config` parsing differs.
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - '.'\nminimumReleaseAge: 0\n", 'utf8')
  }
  // pnpm 12 installs the other package managers natively, so one bootstrapped
  // installer provisions everything the benchmark measures.
  const installerPnpm = bootstrapInstaller(path.join(tmpDir, 'setup'))
  provisionPackageManagers(installerPnpm, managersDirs)
  cloneNvm(managersDirs.nvm)
  // Every package manager installs through the same registry of our own,
  // reached across an emulated network link. A registry on the benchmark
  // machine itself would hide what resolving a dependency graph costs, which is
  // round trips, and that is the very thing the pnpm + pnpr column measures.
  const registry = await startBenchmarkRegistry({
    managersDirs,
    fixtureNames: fixtures,
  })
  // The command every manager is measured with, pointed at that registry.
  const pmCommands = Object.fromEntries(
    Object.entries(cmdsMap).map(([key, pm]) => [key, registry.withRegistry(pm)])
  )
  // Where each manager is installed, and — for the accelerated column — the
  // server it offloads resolution to. That server resolves against its own
  // un-proxied address: it models a resolver co-located with the registry, not
  // one reaching its own metadata across the client's link.
  const measuredConfig = {
    npm: { managersDir: managersDirs.npm },
    pnpm11: { managersDir: managersDirs.pnpm11 },
    pnpm12: { managersDir: managersDirs.pnpm12 },
    pnpm12_global_virtual_store: { managersDir: managersDirs.pnpm12 },
    pnpm12_hoisted: { managersDir: managersDirs.pnpm12 },
    pnpm_pnpr: {
      managersDir: managersDirs.pnpm12,
      pnprServer: registry.resolverUrl,
      pnprServerRegistry: registry.serverDirectUrl,
      authToken: registry.authToken,
    },
    yarn: { managersDir: managersDirs.yarn },
    bun: { managersDir: managersDirs.bun },
  }
  // A manager with nowhere to install from would otherwise fail eight minutes
  // into the run, on the one it was mistyped for.
  for (const { key } of pmConfigs) {
    if (!measuredConfig[key]) {
      throw new Error(`No install directory configured for ${key}.`)
    }
  }
  const runFixture = async ({ key, hasNodeModules }, fixtureName) => {
    const results = await benchmark(pmCommands[key], fixtureName, {
      limitRuns: LIMIT_RUNS,
      // Filed under a name of their own: these runs are measured against our
      // own registry over an emulated link, so pooling them with the runs
      // recorded before that would average two unrelated things.
      resultsName: `${fixtureName}${RESULTS_SUFFIX}`,
      hasNodeModules: hasNodeModules ?? true,
      registry: registry.url,
      ...measuredConfig[key],
    })
    // Checked after every manager rather than only at the end, so a link or a
    // registry that died is reported against the run that lost it instead of
    // silently devaluing everything measured afterwards.
    registry.assertAlive()
    return results
  }
  let measuredFixtures
  try {
    measuredFixtures = await collectFixtures({ pmCommands, runFixture })
  } finally {
    // The registry and the links in front of it are processes of their own.
    // One left running holds its port and would answer the next run in the
    // same job, which is how a benchmark ends up measuring a server whose
    // tarball URLs point at a link that no longer exists.
    registry.stop()
  }

  const nodeManagers = await collectNodeVersionManagers({
    runManager: (pm) => benchmark(pm, 'node-versions', {
      limitRuns: LIMIT_RUNS,
      managersDir: managersDirs[pm.scenario],
      getVersion: readManagerVersion,
      benchmarkFn: (manager, _fixture, opts) => benchmarkNodeVersions(manager, opts),
    }),
  })

  writeVersionsManifest({ pmCommands, registryVersion: registry.version })
  writeManifest({
    node: process.version,
    registryVersion: registry.version,
    fixtures: measuredFixtures,
    nodeManagers,
  })
}

/**
 * Measures — or reads back — every package manager on every fixture.
 *
 * `runFixture` supplies one manager's samples on one fixture: a measuring run
 * measures them, a reporting run reads back what a measuring run recorded. The
 * reduction to one number per scenario is the same either way.
 */
async function collectFixtures ({ pmCommands, runFixture }) {
  const measured = []
  for (const name of fixtures) {
    const packageManagers = {}
    for (const config of pmConfigs) {
      packageManagers[config.key] = {
        version: pmCommands[config.key].version,
        results: min(await runFixture(config, name), tests),
      }
    }
    measured.push({ name, packageManagers })
  }
  return measured
}

/** The same, for the tools compared on installing and switching Node.js. */
async function collectNodeVersionManagers ({ runManager, versionOf }) {
  const managers = {}
  for (const [key, pm] of Object.entries(nodeManagersMap)) {
    const samples = await runManager(pm)
    managers[key] = {
      version: versionOf?.(key) ?? pm.version,
      results: min(samples, nodeVersionTests),
    }
  }
  return managers
}

/**
 * Writes the file this repository exists to produce.
 *
 * The numbers are the minimum of the samples recorded for that tool at that
 * version — the statistic belongs with the measurement, since only the code
 * that took the samples knows what they are samples of. Everything a reader
 * needs to describe the conditions travels with them, so that describing them
 * doesn't mean hard-coding them somewhere else and hoping the two stay in step.
 */
function writeManifest ({ node, registryVersion, fixtures: measuredFixtures, nodeManagers }) {
  const manifest = {
    measuredAt: new Date().toISOString(),
    node,
    pnpr: registryVersion,
    network: {
      roundTripMs: ROUND_TRIP_MS,
      bandwidthMbps: BANDWIDTH_MBPS,
    },
    fixtures: measuredFixtures,
    nodeVersions: {
      primary: PRIMARY_NODE_VERSION,
      secondary: SECONDARY_NODE_VERSION,
      managers: nodeManagers,
    },
  }
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${path.relative(DIRNAME, MANIFEST)}`)
}

function min (benchmarkResults, testKeys) {
  const results = {}
  for (const test of testKeys) {
    results[test] = Math.min(...benchmarkResults.map(res => res[test]))
  }
  return results
}
