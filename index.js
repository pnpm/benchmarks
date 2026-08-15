'use strict'
import crypto from 'crypto'
import fs from 'fs'
import rimraf from 'rimraf'
import commonTags from 'common-tags'
import prettyMs from 'pretty-ms'
import tempy from 'tempy'
import cmdsMap from './commandsMap.js'
import benchmark from './recordBenchmark.js'
import nodeVersionsSection from './nodeVersionsSection.js'
import { startBenchmarkRegistry, ROUND_TRIP_MS, BANDWIDTH_MBPS, RESULTS_SUFFIX } from './benchmarkRegistry.js'
import { cloneNvm } from './benchmarkNodeVersions.js'
import { installYarn } from './installYarn.js'
import generateSvg from './generateSvg.js'
import generateStackedSvg from './generateStackedSvg.js'
import spawn from "cross-spawn"
import path from 'path'
import { fileURLToPath } from 'url'

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
const TMP = path.join(DIRNAME, '.tmp')
// What a run publishes: the page as markdown and the charts it refers to. The
// charts live under the path the markdown points at (`/img/benchmarks/...`), so
// a consumer of these files — pnpm.io today — can take both across as they are.
const BENCH_IMGS = path.join(DIRNAME, 'img/benchmarks')
const BENCH_MD = path.join(DIRNAME, 'benchmarks.md')

const { stripIndents } = commonTags
const LIMIT_RUNS = 30
const NODE_VERSIONS_SVG = 'node-versions'

const fixtures = [
  /*{
    name: 'react-app',
    mdDesc: '## React App\n\nThe app\'s `package.json` [here](./fixtures/react-app/package.json)'
  },
  {
    name: 'ember-quickstart',
    mdDesc: '## Ember App\n\nThe app\'s `package.json` [here](./fixtures/ember-quickstart/package.json)'
  },
  {
    name: 'angular-quickstart',
    mdDesc: '## Angular App\n\nThe app\'s `package.json` [here](./fixtures/angular-quickstart/package.json)'
  },
  {
    name: 'medium-size-app',
    mdDesc: '## Medium Size App\n\nThe app\'s `package.json` [here](./fixtures/medium-size-app/package.json)'
  },*/
  {
    name: 'alotta-files',
    mdDesc: '## Lots of Files\n\nThe app\'s `package.json` [here](https://github.com/pnpm/benchmarks/blob/main/fixtures/alotta-files/package.json)'
  }
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

const testDescriptions = {
  firstInstall:               ['clean'],
  withWarmModules:            ['node_modules'],
  withLockfile:               ['lockfile'],
  withWarmCacheAndModules:    ['cache', 'node_modules'],
  withWarmCache:              ['cache'],
  withWarmCacheAndLockfile:   ['cache', 'lockfile'],
  withWarmModulesAndLockfile: ['lockfile', 'node_modules'],
  repeatInstall:              ['cache', 'lockfile', 'node_modules'],
  updatedDependencies:        ['update'],
}

const tableRows = [
  { test: 'firstInstall',               action: 'install', cache: ' ',   lockfile: ' ',   nodeModules: ' '   },
  { test: 'withWarmModules',            action: 'install', cache: ' ',   lockfile: ' ',   nodeModules: '✔',   needsNodeModules: true },
  { test: 'withLockfile',               action: 'install', cache: ' ',   lockfile: '✔',   nodeModules: ' '   },
  { test: 'withWarmCacheAndModules',    action: 'install', cache: '✔',   lockfile: ' ',   nodeModules: '✔',   needsNodeModules: true },
  { test: 'withWarmCache',              action: 'install', cache: '✔',   lockfile: ' ',   nodeModules: ' '   },
  { test: 'withWarmCacheAndLockfile',   action: 'install', cache: '✔',   lockfile: '✔',   nodeModules: ' '   },
  { test: 'withWarmModulesAndLockfile', action: 'install', cache: ' ',   lockfile: '✔',   nodeModules: '✔',   needsNodeModules: true },
  { test: 'repeatInstall',              action: 'install', cache: '✔',   lockfile: '✔',   nodeModules: '✔',   needsNodeModules: true },
  { test: 'updatedDependencies',        action: 'update',  cache: 'n/a', lockfile: 'n/a', nodeModules: 'n/a' },
]

const explanationByTest = {
  firstInstall:               '`clean`: a brand-new clone — nothing cached, no lockfile, no `node_modules`.',
  withWarmModules:            '`node_modules`: the cache and lockfile are deleted and install is run again.',
  withLockfile:               '`lockfile`: a CI server doing its first install.',
  withWarmCacheAndModules:    '`cache+node_modules`: the lockfile is deleted and install is run again.',
  withWarmCache:              '`cache`: a developer reinstalling without a lockfile.',
  withWarmCacheAndLockfile:   '`cache+lockfile`: a developer reinstalling a known project.',
  withWarmModulesAndLockfile: '`lockfile+node_modules`: the cache is deleted and install is run again.',
  repeatInstall:              '`cache+lockfile+node_modules`: re-running install when nothing has changed.',
  updatedDependencies:        '`update`: dependency versions are bumped in `package.json` and install is run again.',
}

// Sort tests by descending time on the first PM (npm) — slowest first.
// `updatedDependencies` is a different kind of action, so it gets pinned at the end.
const sortTestsBySlowest = (testKeys, resultsObj, pmKeys) => {
  const update = testKeys.filter(t => t === 'updatedDependencies')
  const installs = testKeys.filter(t => t !== 'updatedDependencies')
  const primary = pmKeys[0]
  const timeFor = (t) => resultsObj[primary][t] || 0
  installs.sort((a, b) => timeFor(b) - timeFor(a))
  return [...installs, ...update]
}

const toArray = (testList, pms, resultsObj) => testList
  .map((test) => pms
    .map((pm) => resultsObj[pm][test])
    .map((time) => Math.round(time / 100) / 10) // round to `x.x` seconds
  )

run()
  .then(() => console.log('done'))
  .catch(err => {
    console.error(err)
    // Without this the benchmark reports success to CI no matter what failed.
    process.exitCode = 1
  })

/**
 * A package manager that fails to install is worse than a failed benchmark: the
 * scenarios still find the machine's own `npm`/`pnpm`/`bun` further down PATH
 * and quietly measure that version instead of the one being benchmarked.
 */
function addPackageManager (args, cwd) {
  const result = spawn.sync('pnpm', ['add', ...args], { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`\`pnpm add ${args.join(' ')}\` failed with status code ${result.status}`)
  }
}

async function run () {
  const tmpDir = tempy.directory()
  const managersDirs = {}
  for (const pm of ['npm', 'pnpm11', 'pnpm12', 'yarn', 'bun', 'fnm', 'nvm', 'pnpr']) {
    managersDirs[pm] = path.join(tmpDir, pm)
  }
  await Promise.allSettled([
    rimraf(TMP),
    ...Object.values(managersDirs).map(dir => fs.promises.mkdir(dir, { recursive: true })),
    fs.promises.mkdir(BENCH_IMGS, { recursive: true }),
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
  addPackageManager(['npm@latest'], managersDirs.npm)
  addPackageManager(['pnpm@latest'], managersDirs.pnpm11)
  // pnpm 12 ships its Rust binary via an install script, so the build must be
  // allowed; otherwise the `pnpm` bin is left as a placeholder that errors out.
  addPackageManager(['pnpm@next-12', '--allow-build=pnpm'], managersDirs.pnpm12)
  await installYarn(managersDirs.yarn)
  // Like pnpm 12, the bun package downloads its binary from a postinstall script.
  addPackageManager(['bun@latest', '--allow-build=bun'], managersDirs.bun)
  cloneNvm(managersDirs.nvm)
  const formattedNow = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  // Every package manager installs through the same registry of our own,
  // reached across an emulated network link. A registry on the benchmark
  // machine itself would hide what resolving a dependency graph costs, which is
  // round trips, and that is the very thing the pnpm + pnpr column measures.
  const registry = await startBenchmarkRegistry({
    managersDirs,
    fixtureNames: fixtures.map(({ name }) => name),
  })
  // The command every manager is measured with, pointed at that registry. The
  // charts read the versions back off these objects, which the benchmark runs
  // fill in, so the same object has to be used for measuring and for drawing.
  const pmCommands = Object.fromEntries(
    Object.entries(cmdsMap).map(([key, pm]) => [key, registry.withRegistry(pm)])
  )
  const pmConfigs = [
    { key: 'npm', managersDir: managersDirs.npm },
    { key: 'pnpm11', managersDir: managersDirs.pnpm11 },
    { key: 'pnpm12', managersDir: managersDirs.pnpm12 },
    // The same pnpm 12 as the row above, resolving the dependency graph on
    // the registry instead of walking it itself, so pnpr is the only
    // difference between the two. The server does that resolving against its
    // own un-proxied address: it models a resolver co-located with the
    // registry, not one reaching its own metadata across the client's link.
    {
      key: 'pnpm_pnpr',
      managersDir: managersDirs.pnpm12,
      pnprServer: registry.resolverUrl,
      pnprServerRegistry: registry.serverDirectUrl,
      authToken: registry.authToken,
    },
    { key: 'yarn', managersDir: managersDirs.yarn },
    { key: 'yarn_pnp', managersDir: managersDirs.yarn, hasNodeModules: false },
    { key: 'bun', managersDir: managersDirs.bun },
  ]
  const pms = pmConfigs.map(({ key }) => key)
  let fixtureResults
  try {
    fixtureResults = await benchmarkFixtures({ pmConfigs, pmCommands, pms, registry, formattedNow })
  } finally {
    // The registry and the links in front of it are processes of their own.
    // One left running holds its port and would answer the next run in the
    // same job, which is how a benchmark ends up measuring a server whose
    // tarball URLs point at a link that no longer exists.
    registry.stop()
  }
  const { sections, svgs, sortedTests } = fixtureResults

  const nodeVersions = await nodeVersionsSection({
    managersDirs: { pnpm12: managersDirs.pnpm12, fnm: managersDirs.fnm, nvm: managersDirs.nvm },
    formattedNow,
    limitRuns: LIMIT_RUNS,
    svgName: NODE_VERSIONS_SVG,
  })
  sections.push(nodeVersions.section)
  svgs.push({
    path: path.join(BENCH_IMGS, `${NODE_VERSIONS_SVG}.svg`),
    file: nodeVersions.svg
  })

  const introduction = stripIndents`
  # Benchmarks of JavaScript Package Managers

  **Last benchmarked at**: _${formattedNow}_ (_daily_ updated).

  This benchmark compares the performance of npm, pnpm, Yarn, Yarn PnP, and Bun (check [Yarn's benchmarks](https://yarnpkg.com/benchmarks) for any other Yarn modes that are not included here). Every package manager installs through the same [pnpr](https://pnpm.io/pnpr) registry (v${registry.version}) across an emulated ${ROUND_TRIP_MS}ms round trip at ${BANDWIDTH_MBPS} Mbit/s, so they all face one registry over one reproducible network instead of whatever link the benchmark machine happens to have. pnpm 12 is measured twice: once on its own, and once resolving its dependency graph [on the server](https://pnpm.io/pnpr/install-acceleration) instead of walking it itself. The page also compares how fast pnpm, fnm, and nvm install and switch Node.js versions.

  About the setup:

  - **Every manager crosses the same link.** The round trip is applied to all of them, and to pnpm's resolution requests as well, so no client gets a cheaper connection than another.
  - **pnpr's cache is warmed before anything is timed** — with the fixture's dependency graph and with the one the update row installs — so no manager pays to pull either into the registry on behalf of the ones measured after it.
  - **Server-side resolution pays off when there is a graph to resolve.** Resolving one means walking it level by level, and each level costs a round trip, so the cost is roughly the depth of the graph times the latency. pnpr does that walk next to the registry — its own metadata access stays on loopback, the co-located shape the [pnpm monorepo's integrated benchmark](https://github.com/pnpm/pnpm) measures — and answers with the whole resolved lockfile at once, which is why the rows without a lockfile, and the row that changes dependencies, are the ones where it pulls ahead of plain pnpm.
  - **With an up-to-date lockfile there is nothing to resolve.** pnpm doesn't ask the server then, so those rows measure the same install in both pnpm 12 columns.
  - Tarballs are still fetched by the client, in parallel and directly, on every row.
  `

  const explanationItems = sortedTests.map(t => `- ${explanationByTest[t]}`).join('\n  ')
  const explanation = stripIndents`
  Each row's label lists which of \`cache\`, \`lockfile\`, and \`node_modules\` are warm/present before install runs. Quick mapping to the real world (ordered from slowest to fastest scenario):

  ${explanationItems}
`

  await Promise.all(
    [
      ...svgs.map((file) => fs.promises.writeFile(file.path, file.file, 'utf-8')),
      fs.promises.writeFile(BENCH_MD, stripIndents`
        ${introduction}

        ${explanation}

        ${sections.join('\n\n')}`, 'utf8')
    ]
  )
}

/**
 * Measures every package manager on every fixture and builds the markdown and
 * charts for them.
 */
async function benchmarkFixtures ({ pmConfigs, pmCommands, pms, registry, formattedNow }) {
  const sections = []
  const svgs = []
  let sortedTests = tests
  for (const fixture of fixtures) {
    const results = {}
    for (const { key, managersDir, hasNodeModules, ...rest } of pmConfigs) {
      results[key] = min(await benchmark(pmCommands[key], fixture.name, {
        limitRuns: LIMIT_RUNS,
        // Filed under a name of their own: these runs are measured against our
        // own registry over an emulated link, so pooling them with the runs
        // recorded before that would average two unrelated things.
        resultsName: `${fixture.name}${RESULTS_SUFFIX}`,
        hasNodeModules: hasNodeModules ?? true,
        managersDir,
        registry: registry.url,
        ...rest,
      }))
      // Checked after every manager rather than only at the end, so a link or a
      // registry that died is reported against the run that lost it instead of
      // silently devaluing everything measured afterwards.
      registry.assertAlive()
    }
    sortedTests = sortTestsBySlowest(tests, results, pms)
    const sortedDescriptions = sortedTests.map(t => testDescriptions[t])
    const sortedTableRows = sortedTests.map(t => tableRows.find(r => r.test === t))

    const headerLegends = pms.map(pm => pmCommands[pm].mdLegend ?? pmCommands[pm].legend).join(' | ')
    const headerSep = pms.map(() => '---').join(' | ')
    const rows = sortedTableRows.map(({ test, action, cache, lockfile, nodeModules, needsNodeModules }) => {
      const values = pmConfigs.map(({ key, hasNodeModules: pmHasNodeModules }) => {
        if (needsNodeModules && pmHasNodeModules === false) return 'n/a'
        return prettyMs(results[key][test])
      }).join(' | ')
      return `| ${action} | ${cache} | ${lockfile} | ${nodeModules} | ${values} |`
    }).join('\n')

    // Main chart: pnpm 11 and pnpm 12 are merged into a single stacked bar so
    // pnpm 12's speedup over pnpm 11 is visible at a glance. `pnpm_pnpr` is
    // left out of the chart — it is the same pnpm as one of those bars, so it
    // reads as another package manager here rather than as a setting; the table
    // keeps it.
    const mainBars = [
      { ...pmCommands.npm, key: 'npm' },
      {
        stacked: true,
        color: pmCommands.pnpm12.color,
        legend: pmCommands.pnpm12.legend,
        displayVersion: pmCommands.pnpm12.displayVersion,
        extraColor: '#cccccc',
        extraLegend: 'pnpm 11 extra',
        primaryKey: 'pnpm12',
        secondaryKey: 'pnpm11',
      },
      { ...pmCommands.yarn, key: 'yarn' },
      { ...pmCommands.yarn_pnp, key: 'yarn_pnp' },
      { ...pmCommands.bun, key: 'bun' },
    ]
    const resArray = sortedTests.map(test => mainBars.map(bar => bar.stacked
      ? {
          primary: Math.round(results[bar.primaryKey][test] / 100) / 10,
          secondary: Math.round(results[bar.secondaryKey][test] / 100) / 10,
        }
      : Math.round(results[bar.key][test] / 100) / 10
    ))
    const mainSvg = generateSvg(resArray, mainBars, sortedDescriptions, formattedNow)
    const mainSvgHash = hashContent(mainSvg)
    sections.push(stripIndents`
      ${fixture.mdDesc}

      | action  | cache | lockfile | node_modules| ${headerLegends} |
      | ---     | ---   | ---      | ---         | ${headerSep} |
      ${rows}

      <img alt="Graph of the ${fixture.name} results" src="/img/benchmarks/${fixture.name}.svg?v=${mainSvgHash}" />
    `)

    svgs.push({
      path: path.join(BENCH_IMGS, `${fixture.name}.svg`),
      file: mainSvg
    })

    // pnpm version comparison: include only scenarios that every selected pnpm version supports.
    // Sorted independently of the main chart, keyed by pnpm 11 (the first pnpm config).
    // Only the two pnpm versions belong here: `pnpm_pnpr` is the same pnpm as
    // one of them and would compare a registry feature against a release.
    const pnpmConfigs = pmConfigs.filter(({ key }) => key === 'pnpm11' || key === 'pnpm12')
    const pnpmKeys = pnpmConfigs.map(({ key }) => key)
    const pnpmSortedTests = sortTestsBySlowest(tests, results, pnpmKeys)
      .filter((test) => {
        const row = tableRows.find((r) => r.test === test)
        if (!row?.needsNodeModules) return true
        return pnpmConfigs.every(({ hasNodeModules }) => hasNodeModules !== false)
      })
    const pnpmTestDescriptions = pnpmSortedTests.map(t => testDescriptions[t])
    const pnpmHeaderLegends = pnpmKeys.map((key) => pmCommands[key].mdLegend ?? pmCommands[key].legend).join(' | ')
    const pnpmHeaderSep = pnpmKeys.map(() => '---').join(' | ')
    const pnpmRows = pnpmSortedTests.map((test) => {
      const row = tableRows.find((r) => r.test === test)
      const values = pnpmKeys.map((key) => prettyMs(results[key][test])).join(' | ')
      return `| ${row.action} | ${row.cache} | ${row.lockfile} | ${row.nodeModules} | ${values} |`
    }).join('\n')

    const pnpmTitle = pnpmConfigs.map(({ key }) => pmCommands[key].legend).join(' vs ')
    const stackedResults = pnpmSortedTests.map((test, i) => ({
      label: pnpmTestDescriptions[i],
      v11: Math.round(results.pnpm11[test] / 100) / 10,
      v12: Math.round(results.pnpm12[test] / 100) / 10,
    }))
    const pnpmSvg = generateStackedSvg(stackedResults, formattedNow)
    const pnpmSvgHash = hashContent(pnpmSvg)
    sections.push(stripIndents`
      ### ${pnpmTitle}

      pnpm v12 will use a new installation engine for fetching and linking written in Rust. See [pacquet](https://github.com/pnpm/pacquet).

      | action  | cache | lockfile | node_modules| ${pnpmHeaderLegends} |
      | ---     | ---   | ---      | ---         | ${pnpmHeaderSep} |
      ${pnpmRows}

      <img alt="Graph comparing pnpm versions on the ${fixture.name} fixture" src="/img/benchmarks/${fixture.name}-pnpm.svg?v=${pnpmSvgHash}" />
    `)

    svgs.push({
      path: path.join(BENCH_IMGS, `${fixture.name}-pnpm.svg`),
      file: pnpmSvg
    })
  }

  return { sections, svgs, sortedTests }
}

function average (benchmarkResults) {
  const results = {}
  tests.forEach(test => {
    results[test] = benchmarkResults.map(res => res[test]).reduce(sum, 0) / benchmarkResults.length
  })
  return results
}

function min (benchmarkResults) {
  const results = {}
  tests.forEach(test => {
    results[test] = Math.min.apply(Math, benchmarkResults.map(res => res[test]))
  })
  return results
}

function sum (a, b) {
  return a + b
}

function hashContent (content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8)
}
