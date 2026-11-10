import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import tempy from 'tempy'

import {
  CONFLICT_MANAGERS,
  countConflictHunks,
  countPackageJsonConflicts,
  evaluateScenarioOutcome,
  gitMergeLockfiles,
  summarizeCleanPackageJsonResults,
  summarizeConflictResults,
  writeProjectState,
} from './benchmarkLockfileConflicts.js'
import { lockfileConflictScenarios } from './lockfileConflictScenarios.js'

test('gitMergeLockfiles merges non-overlapping multi-line dependency maps cleanly', () => {
  const base = [
    '{',
    '\t"projects": {',
    '\t\t".": {',
    '\t\t\t"dependencies": {',
    '\t\t\t\t"fast-copy": {',
    '\t\t\t\t\t"specifier": "~3.0.0",',
    '\t\t\t\t\t"version": "3.0.0",',
    '\t\t\t\t},',
    '\t\t\t\t"fast-redact": {',
    '\t\t\t\t\t"specifier": "~3.4.0",',
    '\t\t\t\t\t"version": "3.4.0",',
    '\t\t\t\t},',
    '\t\t\t},',
    '\t\t},',
    '\t},',
    '}',
    '',
  ].join('\n')
  const branchA = base
    .replace('"~3.0.0"', '"^3.1.0"')
    .replace('"3.0.0"', '"3.1.0"')
  const branchB = base
    .replace('"~3.4.0"', '"^3.5.0"')
    .replace('"3.4.0"', '"3.5.0"')
  const expectedMerged = branchA
    .replace('"~3.4.0"', '"^3.5.0"')
    .replace('"3.4.0"', '"3.5.0"')

  const outcome = evaluateScenarioOutcome({
    base,
    branchA,
    branchB,
    expectedMerged,
  })
  assert.deepEqual(outcome, {
    conflicts: 0,
    exactMatch: true,
    semanticDrift: false,
  })
})

test('gitMergeLockfiles counts conflict hunks and detects semantic drift', () => {
  const base = 'a: 1\nb: 2\n'
  const branchA = 'a: 10\nb: 2\n'
  const branchB = 'a: 1\nb: 20\n'
  const conflictedMerge = gitMergeLockfiles(base, branchA, branchB)
  assert.equal(conflictedMerge.conflicts, 1)
  assert.equal(countConflictHunks(conflictedMerge.merged), 1)

  const driftOutcome = evaluateScenarioOutcome({
    base: 'a: 1\n\nb: 2\n',
    branchA: 'a: 10\n\nb: 2\n',
    branchB: 'a: 1\n\nb: 20\n',
    expectedMerged: 'a: 10\n\nb: 99\n',
  })
  assert.deepEqual(driftOutcome, {
    conflicts: 0,
    exactMatch: false,
    semanticDrift: true,
  })
})

test('summarizeConflictResults aggregates clean, conflicted, and drift scenarios', () => {
  const scenarios = {
    S01: {
      packageJsonConflicts: 0,
      managers: {
        pnpm_v13: { conflicts: 0, exactMatch: true, semanticDrift: false },
        npm: { conflicts: 2, exactMatch: false, semanticDrift: false },
      },
    },
    S02: {
      packageJsonConflicts: 1,
      managers: {
        pnpm_v13: { conflicts: 0, exactMatch: false, semanticDrift: true },
        npm: { conflicts: 0, exactMatch: true, semanticDrift: false },
      },
    },
  }
  const summary = summarizeConflictResults(scenarios, ['pnpm_v13', 'npm'])
  assert.deepEqual(summary, {
    pnpm_v13: { clean: 1, conflicted: 0, conflictHunks: 0, semanticDrift: 1 },
    npm: { clean: 1, conflicted: 1, conflictHunks: 2, semanticDrift: 0 },
  })
  const cleanSummary = summarizeCleanPackageJsonResults(scenarios, ['pnpm_v13', 'npm'])
  assert.deepEqual(cleanSummary, {
    pnpm_v13: { clean: 1, conflicted: 0, conflictHunks: 0, semanticDrift: 0 },
    npm: { clean: 0, conflicted: 1, conflictHunks: 2, semanticDrift: 0 },
  })
})

test('writeProjectState writes root and workspace manifests and scenarios are well-formed', () => {
  const dir = tempy.directory()
  writeProjectState(dir, {
    dependencies: { abbrev: '3.0.1' },
    workspaces: { a: { dependencies: { ini: '5.0.0' } } },
  })
  assert.ok(fs.existsSync(path.join(dir, 'package.json')))
  assert.ok(fs.existsSync(path.join(dir, 'packages/a/package.json')))
  assert.equal(lockfileConflictScenarios.length, 29)
  assert.equal(CONFLICT_MANAGERS.includes('pnpm_v13'), true)
  assert.equal(countPackageJsonConflicts(lockfileConflictScenarios[0]), 0)
  assert.equal(countPackageJsonConflicts(lockfileConflictScenarios[1]), 1)
  assert.equal(countPackageJsonConflicts(lockfileConflictScenarios[25]), 0)
  assert.equal(countPackageJsonConflicts(lockfileConflictScenarios[26]), 0)
  assert.equal(countPackageJsonConflicts(lockfileConflictScenarios[27]), 0)
  assert.equal(countPackageJsonConflicts(lockfileConflictScenarios[28]), 0)
})
