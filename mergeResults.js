'use strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadYamlFile } from 'load-yaml-file'
import writeYamlFile from 'write-yaml-file'
import { LIMIT_RUNS } from './recordBenchmark.js'

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
const RESULTS = path.join(DIRNAME, 'results')
const VERSIONS_FILE = path.join(DIRNAME, 'versions.json')

// Folds the samples of several measuring runs into one set of results.
//
// The runs happen in parallel jobs, each of which starts from the same commit
// and appends its own samples to the results it checked out. So what a job
// contributes is whatever it added past the length of the baseline — not its
// whole file, which still carries every sample recorded before this run and
// would otherwise be counted once per job.
//
// Usage: node mergeResults.js <dir containing one subdirectory per run>

async function readSamples (file) {
  try {
    return await loadYamlFile(file)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return []
  }
}

function resultFiles (dir) {
  const files = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.yaml')) files.push(path.relative(dir, full))
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return files
}

async function main () {
  const samplesDir = process.argv[2]
  if (!samplesDir) {
    throw new Error('Usage: node mergeResults.js <dir containing one subdirectory per run>')
  }
  const runDirs = fs.readdirSync(samplesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // Sorted so that a merge of the same runs always produces the same file,
    // whatever order the artifacts happened to be downloaded in.
    .map((entry) => path.join(samplesDir, entry.name))
    .sort()
  if (runDirs.length === 0) {
    throw new Error(
      `No runs to merge in ${samplesDir}. Every measuring job must have failed, and there is ` +
      'nothing to publish — the page would otherwise be rebuilt from last week\'s numbers and ' +
      'presented as this week\'s.'
    )
  }

  // Read every baseline first: the merge writes into the very directory it
  // measures the runs against, so a file rewritten early would make the next
  // run's contribution look shorter than it is.
  const baselines = new Map()
  for (const runDir of runDirs) {
    for (const file of resultFiles(path.join(runDir, 'results'))) {
      if (baselines.has(file)) continue
      baselines.set(file, (await readSamples(path.join(RESULTS, file))).length)
    }
  }

  let added = 0
  for (const [file, baseline] of baselines) {
    const merged = await readSamples(path.join(RESULTS, file))
    const before = merged.length
    for (const runDir of runDirs) {
      const samples = await readSamples(path.join(runDir, 'results', file))
      // A run that hit `LIMIT_RUNS` added nothing, and slicing gives nothing.
      // A file no earlier run recorded has no baseline, so all of it is new.
      merged.push(...samples.slice(baseline))
    }
    // Most of these files belong to versions nothing measured this week.
    // Rewriting them would be a thousand no-op writes, and any difference in
    // how this formatter and the one that recorded them lay out YAML would
    // show up as a thousand-file diff on top of the samples actually added.
    if (merged.length === before) continue
    added += merged.length - before
    // A measuring run stops adding at `LIMIT_RUNS`, but three of them start
    // from the same baseline and so can carry it past the cap together — 29
    // samples plus one from each run is 32. The oldest go, because the cap is
    // there to bound how far back a file reaches.
    await writeYamlFile(path.join(RESULTS, file), merged.slice(-LIMIT_RUNS))
  }

  // The versions every run measured. They agree unless a package manager
  // published a release while the runs were in flight, in which case the runs
  // recorded into different directories and only one of them can be the page's
  // — say so rather than picking one silently.
  const manifests = runDirs
    .map((runDir) => path.join(runDir, 'versions.json'))
    .filter((file) => fs.existsSync(file))
  if (manifests.length === 0) {
    throw new Error(`No versions.json among the runs in ${samplesDir}; the page can't be labelled.`)
  }
  const chosen = fs.readFileSync(manifests[0], 'utf8')
  for (const other of manifests.slice(1)) {
    if (fs.readFileSync(other, 'utf8') !== chosen) {
      console.warn(
        `[merge-results] ${other} measured different versions than ${manifests[0]} — a release ` +
        `landed mid-run. The page will report the versions in ${manifests[0]}; the samples ` +
        'recorded under the other stay on disk for whenever it is next measured.'
      )
    }
  }
  fs.writeFileSync(VERSIONS_FILE, chosen, 'utf8')

  console.log(`[merge-results] ${added} new samples from ${runDirs.length} run(s) across ${baselines.size} file(s)`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
