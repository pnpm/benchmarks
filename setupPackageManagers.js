'use strict'
import fs from 'fs'
import path from 'path'
import pathKey from 'path-key'
import spawn from 'cross-spawn'

/**
 * pnpm 12 installs the other package managers natively: `pnpm add --global`
 * resolves npm, Yarn, and Bun through their trusted release channels and
 * verifies each npm-published one against npm's signature, and
 * `pnpm self-update` does the same for pnpm itself. The benchmark uses that
 * instead of installing whatever npm package shares a manager's name — which
 * for Yarn 6 (a Rust binary published on GitHub, not npm) used to take a
 * downloader of its own.
 *
 * Every manager is provisioned into a `PNPM_HOME` of its own, so its
 * executable, its packages, and the store they came from all live under the
 * one directory the scenarios put on `PATH` — `<managersDir>/bin` is where
 * the executables land.
 */

// The pnpm every other manager is installed with. It is itself installed the
// only way that works before any pnpm 12 exists on the machine: as a package,
// by whatever pnpm the machine has.
const INSTALLER_SPEC = 'pnpm@next-12'

/**
 * Installs the pnpm 12 that provisions every package manager, and returns the
 * path to its executable. It lives in a directory of its own that no scenario
 * ever puts on `PATH`, so the installer can never be what a benchmark measures.
 */
export function bootstrapInstaller (setupDir) {
  fs.mkdirSync(setupDir, { recursive: true })
  fs.writeFileSync(path.join(setupDir, 'package.json'), '{}', 'utf8')
  // pnpm holds versions younger than `minimumReleaseAge` back, and the
  // benchmark exists to measure the newest release, not the newest mature one.
  fs.writeFileSync(
    path.join(setupDir, 'pnpm-workspace.yaml'),
    'packages:\n  - "."\nminimumReleaseAge: 0\n',
    'utf8'
  )
  // pnpm 12 ships its Rust binary via an install script, so the build must be
  // allowed; otherwise the `pnpm` bin is left as a placeholder that errors out.
  run('pnpm', ['add', INSTALLER_SPEC, '--allow-build=pnpm'], { cwd: setupDir, stdio: 'inherit' })
  return path.join(setupDir, 'node_modules/.bin/pnpm')
}

/**
 * Provisions every benchmarked package manager into its directory.
 *
 * A package manager that fails to install is worse than a failed benchmark:
 * the scenarios still find the machine's own `npm`/`pnpm`/`bun` further down
 * PATH and quietly measure that version instead of the one being benchmarked.
 * That is why every install here throws on failure.
 */
export function provisionPackageManagers (installerPnpm, managersDirs) {
  provision(installerPnpm, managersDirs.npm, ['add', '--global', 'npm@latest'])
  // pnpm refuses `pnpm add --global pnpm`: switching pnpm is `self-update`'s
  // job, so that is what installs both pnpm lines.
  provision(installerPnpm, managersDirs.pnpm11, ['self-update', 'latest'])
  provision(installerPnpm, managersDirs.pnpm12, ['self-update', 'next-12'])
  // `yarn@6` rather than `yarn@latest`: a specifier that doesn't commit to a
  // major resolves to Yarn Berry from npm, while the benchmark measures the
  // current Yarn line — the Rust rewrite released on GitHub.
  provision(installerPnpm, managersDirs.yarn, ['add', '--global', 'yarn@6'])
  provision(installerPnpm, managersDirs.bun, ['add', '--global', 'bun@latest'])
}

function provision (installerPnpm, managersDir, args) {
  const pathEnv = pathKey()
  const env = Object.create(process.env)
  // The manager's own pnpm home: executables in `<managersDir>/bin`, packages
  // and store next to them, nothing shared with the machine or the other
  // managers.
  env.PNPM_HOME = managersDir
  // pnpm refuses to install globally when the global bin directory is not in
  // PATH.
  env[pathEnv] = [path.join(managersDir, 'bin'), process.env[pathEnv]].join(path.delimiter)
  // Left to itself, pnpm links a globally installed package manager as a shim
  // that re-resolves the version on every invocation, so a project's pin wins
  // over the global install. The benchmark measures the package manager, not
  // the shim, so the executables have to be linked directly.
  env.PNPM_CONFIG_GLOBAL_SHIMS = 'false'
  // `self-update` deliberately ignores what a project's `pnpm-workspace.yaml`
  // says about release maturity — a repository must not decide whether the
  // binary gets replaced — so the benchmark's `minimumReleaseAge: 0` has to
  // arrive through the trusted env-var layer instead.
  env.PNPM_CONFIG_MINIMUM_RELEASE_AGE = '0'
  run(installerPnpm, args, { cwd: managersDir, env, stdio: 'inherit' })
}

function run (command, args, opts) {
  const result = spawn.sync(command, args, opts)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`\`${path.basename(command)} ${args.join(' ')}\` failed with status code ${result.status}`)
  }
}
