'use strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import spawn from 'cross-spawn'

import { lockfileConflictScenarios } from './lockfileConflictScenarios.js'

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_FILE = path.join(DIRNAME, 'lockfile-conflicts.json')

export const CONFLICT_MANAGERS = [
  'pnpm_v13',
  'pnpm_v9',
  'npm',
  'yarn',
  'yarn_classic',
  'bun',
  'vlt',
]

function rootManifest (state) {
  return {
    name: 'root',
    version: '1.0.0',
    private: true,
    ...(state.workspaces ? { workspaces: ['packages/*'] } : {}),
    ...(state.dependencies ? { dependencies: state.dependencies } : {}),
    ...(state.devDependencies ? { devDependencies: state.devDependencies } : {}),
  }
}

function stateManifestFiles (state) {
  const files = {
    'package.json': `${JSON.stringify(rootManifest(state), null, 2)}\n`,
  }
  for (const [wsName, wsPkg] of Object.entries(state.workspaces ?? {})) {
    const manifest = { name: `@ws/${wsName}`, version: '1.0.0', ...wsPkg }
    files[`packages/${wsName}/package.json`] = `${JSON.stringify(manifest, null, 2)}\n`
  }
  return files
}

export function countPackageJsonConflicts (scenario) {
  const baseFiles = stateManifestFiles(scenario.base)
  const aFiles = stateManifestFiles(scenario.branchA)
  const bFiles = stateManifestFiles(scenario.branchB)
  const allPaths = new Set([
    ...Object.keys(baseFiles),
    ...Object.keys(aFiles),
    ...Object.keys(bFiles),
  ])
  let conflicts = 0
  for (const filePath of allPaths) {
    const merged = gitMergeLockfiles(
      baseFiles[filePath] ?? '',
      aFiles[filePath] ?? '',
      bFiles[filePath] ?? ''
    )
    conflicts += merged.conflicts
  }
  return conflicts
}

export function writeProjectState (dir, state, { clean = true } = {}) {
  if (clean) {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(rootManifest(state), null, 2)}\n`)
  if (!state.workspaces) return
  for (const [wsName, wsPkg] of Object.entries(state.workspaces)) {
    const wsDir = path.join(dir, 'packages', wsName)
    fs.mkdirSync(wsDir, { recursive: true })
    const manifest = { name: `@ws/${wsName}`, version: '1.0.0', ...wsPkg }
    fs.writeFileSync(path.join(wsDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  }
}

function writePnpmWorkspaceYaml (dir, state, isV13) {
  const lines = state.workspaces ? ['packages:', '  - packages/*'] : []
  if (isV13) lines.push('lockfile:', '  format: v13')
  if (lines.length > 0) {
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), `${lines.join('\n')}\n`)
  }
}

function runCommand (command, args, opts) {
  const result = spawn.sync(command, args, { stdio: 'pipe', ...opts })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? ''
    throw new Error(`\`${command} ${args.join(' ')}\` exited with ${result.status}: ${stderr}`)
  }
}

function invokeManager (manager, dir, binaries) {
  if (manager === 'pnpm_v13' || manager === 'pnpm_v9') {
    runCommand(binaries.pnpm ?? 'pnpm', ['install', '--lockfile-only', '--ignore-scripts'], { cwd: dir })
    return fs.readFileSync(path.join(dir, 'pnpm-lock.yaml'), 'utf8')
  }
  if (manager === 'npm') {
    runCommand(binaries.npm ?? 'npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir })
    return fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8')
  }
  if (manager === 'bun') {
    runCommand(binaries.bun ?? 'bun', ['install', '--lockfile-only', '--ignore-scripts'], { cwd: dir })
    return fs.readFileSync(path.join(dir, 'bun.lock'), 'utf8')
  }
  if (manager === 'vlt') {
    const args = ['install', '--lockfile-only', '--registry=https://registry.npmjs.org/', '--registries=npm=https://registry.npmjs.org/']
    runCommand(binaries.vlt ?? 'vlt', args, { cwd: dir })
    return fs.readFileSync(path.join(dir, 'vlt-lock.json'), 'utf8')
  }
  if (manager === 'yarn') {
    const env = { ...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false', YARN_ENABLE_TELEMETRY: '0' }
    runCommand(binaries.yarn ?? 'yarn', ['install', '--mode', 'update-lockfile'], { cwd: dir, env })
    return fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf8')
  }
  if (manager === 'yarn_classic') {
    const nmDir = path.join(dir, '.y1_nm')
    const args = ['install', '--ignore-scripts', '--no-node-version-check', '--non-interactive', '--modules-folder', nmDir]
    runCommand(binaries.yarnClassic ?? 'yarn', args, { cwd: dir })
    return fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf8')
  }
  throw new Error(`Unknown package manager: ${manager}`)
}

export function generateLockfileForState (manager, state, workDir, binaries = {}) {
  if (state.seed) {
    generateLockfileForState(manager, state.seed, workDir, binaries)
    writeProjectState(workDir, state, { clean: false })
  } else {
    writeProjectState(workDir, state, { clean: true })
  }
  if (manager === 'pnpm_v13' || manager === 'pnpm_v9') {
    writePnpmWorkspaceYaml(workDir, state, manager === 'pnpm_v13')
  }
  return invokeManager(manager, workDir, binaries)
}

export function gitMergeLockfiles (baseText, branchAText, branchBText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-merge-'))
  try {
    const baseFile = path.join(dir, 'base')
    const aFile = path.join(dir, 'a')
    const bFile = path.join(dir, 'b')
    fs.writeFileSync(baseFile, baseText)
    fs.writeFileSync(aFile, branchAText)
    fs.writeFileSync(bFile, branchBText)
    const result = spawn.sync('git', ['merge-file', '-p', aFile, baseFile, bFile], { encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status == null || result.status < 0 || result.status > 127) {
      throw new Error(`git merge-file failed with status ${result.status}: ${result.stderr ?? ''}`)
    }
    const merged = result.stdout ?? ''
    const conflicts = countConflictHunks(merged)
    return { conflicts, merged }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export function countConflictHunks (text) {
  let count = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('<<<<<<<')) count += 1
  }
  return count
}

export function evaluateScenarioOutcome ({ base, branchA, branchB, expectedMerged }) {
  const { conflicts, merged } = gitMergeLockfiles(base, branchA, branchB)
  const exactMatch = conflicts === 0 && merged === expectedMerged
  const semanticDrift = conflicts === 0 && !exactMatch
  return { conflicts, exactMatch, semanticDrift }
}

function summarizeManagerOutcomes (scenarios, manager) {
  let clean = 0
  let conflicted = 0
  let conflictHunks = 0
  let semanticDrift = 0
  for (const scenario of Object.values(scenarios)) {
    const outcome = scenario.managers[manager]
    if (!outcome) continue
    if (outcome.conflicts > 0) {
      conflicted += 1
      conflictHunks += outcome.conflicts
    } else if (outcome.exactMatch) {
      clean += 1
    } else {
      semanticDrift += 1
    }
  }
  return { clean, conflicted, conflictHunks, semanticDrift }
}

export function summarizeConflictResults (scenarios, managers = CONFLICT_MANAGERS) {
  const summary = {}
  for (const manager of managers) {
    summary[manager] = summarizeManagerOutcomes(scenarios, manager)
  }
  return summary
}

export function summarizeCleanPackageJsonResults (scenarios, managers = CONFLICT_MANAGERS) {
  const cleanScenarios = Object.fromEntries(
    Object.entries(scenarios).filter(([, scenario]) => (scenario.packageJsonConflicts ?? 0) === 0)
  )
  return summarizeConflictResults(cleanScenarios, managers)
}

export function runLockfileConflictsBenchmark ({
  managers = CONFLICT_MANAGERS,
  binaries = {},
  outputPath = OUTPUT_FILE,
} = {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-bench-work-'))
  const scenarios = {}
  try {
    for (const scenario of lockfileConflictScenarios) {
      scenarios[scenario.id] = {
        description: scenario.description,
        packageJsonConflicts: countPackageJsonConflicts(scenario),
        managers: {},
      }
      for (const manager of managers) {
        const base = generateLockfileForState(manager, scenario.base, workDir, binaries)
        const branchA = generateLockfileForState(manager, scenario.branchA, workDir, binaries)
        const branchB = generateLockfileForState(manager, scenario.branchB, workDir, binaries)
        const expectedMerged = generateLockfileForState(manager, scenario.merged, workDir, binaries)
        scenarios[scenario.id].managers[manager] = evaluateScenarioOutcome({
          base,
          branchA,
          branchB,
          expectedMerged,
        })
      }
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
  const cleanPackageJsonScenarios = Object.values(scenarios).filter(
    (scenario) => scenario.packageJsonConflicts === 0
  ).length
  const report = {
    measuredAt: new Date().toISOString(),
    totalScenarios: lockfileConflictScenarios.length,
    cleanPackageJsonScenarios,
    summary: summarizeConflictResults(scenarios, managers),
    cleanPackageJsonSummary: summarizeCleanPackageJsonResults(scenarios, managers),
    scenarios,
  }
  if (outputPath) {
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  return report
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const report = runLockfileConflictsBenchmark()
  console.log(JSON.stringify(report.summary, null, 2))
}
