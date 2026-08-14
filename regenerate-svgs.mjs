// Rebuild img/benchmarks/*.svg from cached YAML results, using the current
// testDescriptions in index.js. Skips PM installs and re-benchmarking, so it
// redraws the charts in a second without measuring anything. Idempotent given
// the same YAML data — the SVG timestamp is the YAML mtime, not `new Date()`,
// so re-running doesn't dirty the working tree.

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import cmdsMap from './commandsMap.js'
import generateSvg from './generateSvg.js'
import generateStackedSvg from './generateStackedSvg.js'

let loadYamlFile
try {
  ({ loadYamlFile } = await import('load-yaml-file'))
} catch {
  console.warn('[regenerate-svgs] node_modules not installed; skipping')
  process.exit(0)
}

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
const RESULTS = path.join(DIRNAME, 'results')
const BENCH_IMGS = path.join(DIRNAME, 'img/benchmarks')

const tests = [
  'firstInstall',
  'withWarmModules',
  'withLockfile',
  'withWarmCacheAndModules',
  'withWarmCache',
  'withWarmCacheAndLockfile',
  'withWarmModulesAndLockfile',
  'repeatInstall',
  'updatedDependencies',
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

const sortTestsBySlowest = (testKeys, data, pmKeys) => {
  const update = testKeys.filter(t => t === 'updatedDependencies')
  const installs = testKeys.filter(t => t !== 'updatedDependencies')
  const primary = pmKeys[0]
  const timeFor = (t) => data[primary].results[t] || 0
  installs.sort((a, b) => timeFor(b) - timeFor(a))
  return [...installs, ...update]
}

const pmConfigs = [
  { key: 'npm' },
  { key: 'pnpm11' },
  { key: 'pnpm12' },
  { key: 'yarn' },
  { key: 'yarn_pnp', hasNodeModules: false },
  { key: 'bun' },
]

// The name the benchmark files its runs under. It is not the fixture's own
// name: every install is measured against the benchmark's pnpr registry over
// an emulated link, and the runs recorded before that — against the public
// registry, over whatever link the machine had — stay under `alotta-files`.
// Drawing those here would put pre-pnpr numbers on the chart the benchmark
// publishes.
const RESULTS_NAME = 'alotta-files-pnpr.yaml'

function latestVersionEntry (key) {
  const dir = path.join(RESULTS, key)
  let versions
  try {
    versions = fs.readdirSync(dir)
  } catch {
    return null
  }
  return versions
    .map(v => {
      const file = path.join(dir, v, RESULTS_NAME)
      try {
        return { v, file, mtime: fs.statSync(file).mtimeMs }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)[0] ?? null
}

function minPerTest (entries) {
  const out = {}
  for (const t of tests) out[t] = Math.min(...entries.map(e => e[t]))
  return out
}

function toResArray (testList, keys, data) {
  return testList.map(t => keys.map(k => data[k].results[t]).map(ms => Math.round(ms / 100) / 10))
}

const data = {}
let latestYamlMtime = 0
for (const { key } of pmConfigs) {
  // A package manager that was added to the benchmark but hasn't been run by CI
  // yet has no results to draw, so it is left out of the chart until it does.
  const entry = latestVersionEntry(key)
  if (!entry) continue
  const entries = await loadYamlFile(entry.file)
  data[key] = { version: entry.v, results: minPerTest(entries) }
  if (entry.mtime > latestYamlMtime) latestYamlMtime = entry.mtime
}

if (!data.npm) {
  console.warn('[regenerate-svgs] no benchmark results recorded yet; skipping')
  process.exit(0)
}

const formattedNow = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(latestYamlMtime))

const allKeys = pmConfigs.map(c => c.key).filter(key => data[key])
const sortedTests = sortTestsBySlowest(tests, data, allKeys)
const sortedDescriptions = sortedTests.map(t => testDescriptions[t])

// Main chart: pnpm 11 and pnpm 12 are merged into a single stacked bar.
const mainBars = [
  { ...cmdsMap.npm, key: 'npm' },
  {
    stacked: true,
    color: cmdsMap.pnpm12.color,
    legend: cmdsMap.pnpm12.legend,
    displayVersion: cmdsMap.pnpm12.displayVersion,
    extraColor: '#cccccc',
    extraLegend: 'pnpm 11 extra',
    primaryKey: 'pnpm12',
    secondaryKey: 'pnpm11',
  },
  { ...cmdsMap.yarn, key: 'yarn' },
  { ...cmdsMap.yarn_pnp, key: 'yarn_pnp' },
  { ...cmdsMap.bun, key: 'bun' },
]
  .filter(bar => bar.stacked
    ? data[bar.primaryKey] && data[bar.secondaryKey]
    : data[bar.key])
  .map(bar => bar.stacked ? bar : { ...bar, version: data[bar.key].version })
const mainResArray = sortedTests.map(test => mainBars.map(bar => bar.stacked
  ? {
      primary: Math.round(data[bar.primaryKey].results[test] / 100) / 10,
      secondary: Math.round(data[bar.secondaryKey].results[test] / 100) / 10,
    }
  : Math.round(data[bar.key].results[test] / 100) / 10
))
const mainSvg = generateSvg(mainResArray, mainBars, sortedDescriptions, formattedNow)

const pnpmSortedTests = sortTestsBySlowest(tests, data, ['pnpm11'])
const pnpmSortedDescriptions = pnpmSortedTests.map(t => testDescriptions[t])
const stackedResults = pnpmSortedTests.map((test, i) => ({
  label: pnpmSortedDescriptions[i],
  v11: Math.round(data.pnpm11.results[test] / 100) / 10,
  v12: Math.round(data.pnpm12.results[test] / 100) / 10,
}))
const pnpmSvg = generateStackedSvg(stackedResults, formattedNow)

fs.mkdirSync(BENCH_IMGS, { recursive: true })
const mainPath = path.join(BENCH_IMGS, 'alotta-files.svg')
const pnpmPath = path.join(BENCH_IMGS, 'alotta-files-pnpm.svg')
const writeIfChanged = (file, content) => {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false
  fs.writeFileSync(file, content)
  return true
}
const mainChanged = writeIfChanged(mainPath, mainSvg)
const pnpmChanged = writeIfChanged(pnpmPath, pnpmSvg)
if (mainChanged || pnpmChanged) {
  console.log('[regenerate-svgs] wrote' + (mainChanged ? ' alotta-files.svg' : '') + (pnpmChanged ? ' alotta-files-pnpm.svg' : ''))
}

// Keep the ?v= cache-bust hashes in benchmarks.md aligned with the SVG content
// so a site serving these files doesn't hand out a stale cached copy under the
// old URL.
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8)
const mdPath = path.join(DIRNAME, 'benchmarks.md')
if (fs.existsSync(mdPath)) {
  let md = fs.readFileSync(mdPath, 'utf8')
  const patched = md
    .replace(/(alotta-files\.svg\?v=)[0-9a-f]+/g, `$1${hash(mainSvg)}`)
    .replace(/(alotta-files-pnpm\.svg\?v=)[0-9a-f]+/g, `$1${hash(pnpmSvg)}`)
  if (patched !== md) {
    fs.writeFileSync(mdPath, patched)
    console.log('[regenerate-svgs] updated ?v= hashes in benchmarks.md')
  }
}
