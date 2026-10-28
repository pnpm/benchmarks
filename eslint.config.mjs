import eslintConfig, { sizeAndShapeRules } from '@pnpm/eslint-config'
import * as regexpPlugin from 'eslint-plugin-regexp'

// The shared config is written for the TypeScript sources of the pnpm
// monorepo. This repository is plain JavaScript, so the same rules are applied
// to its .js and .mjs files instead.
const JS_FILES = ['**/*.js', '**/*.mjs']
const TEST_FILES = ['**/*.test.mjs']

// Files whose code still exceeds the size and shape limits. Remove a file
// from this list once it is refactored to pass them.
const PENDING_SIZE_AND_SHAPE_REFACTOR = [
  'benchmarkFixture.js',
  'benchmarkRegistry.js',
  'index.js',
  'latencyProxy.js',
  'mergeResults.js',
  'pnprServer.js',
]

function retarget (config) {
  if (!config.files) return config
  const isTestConfig = config.files.some((pattern) => pattern.includes('test'))
  return { ...config, files: isTestConfig ? TEST_FILES : JS_FILES }
}

export default [
  {
    ignores: ['**/fixtures', '**/node_modules', '.claude/**', '.tmp*/**', 'managers/**', 'results/**', 'samples/**', '.pnpr-cache/**'],
  },
  ...eslintConfig.map(retarget),
  regexpPlugin.configs['flat/recommended'],
  {
    files: JS_FILES,
    rules: {
      // JavaScript has no syntax for the types this rule asks for.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // This repository is a set of scripts, not a published package, and
      // keeps all of its dependencies in one manifest.
      'import-x/no-extraneous-dependencies': 'off',
    },
  },
  {
    files: TEST_FILES,
    rules: {
      // The tests run on node:test, whose test() and describe() return a
      // promise that the runner itself awaits.
      '@typescript-eslint/no-floating-promises': ['error', {
        allowForKnownSafeCalls: [
          { from: 'package', package: 'node:test', name: ['describe', 'it', 'suite', 'test'] },
        ],
      }],
    },
  },
  {
    files: ['eslint.config.mjs'],
    rules: {
      // ESLint loads its config from the default export.
      'import-x/no-default-export': 'off',
    },
  },
  {
    files: PENDING_SIZE_AND_SHAPE_REFACTOR,
    rules: Object.fromEntries(
      Object.keys(sizeAndShapeRules)
        .filter((rule) => rule !== 'perfectionist/overly-complex-condition' && rule !== 'perfectionist/overly-long-method-chain')
        .map((rule) => [rule, 'off'])
    ),
  },
]
