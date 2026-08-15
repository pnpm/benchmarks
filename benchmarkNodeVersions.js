'use strict'
import fs from 'fs'
import path from 'path'
import rimraf from 'rimraf'
import pathKey from 'path-key'
import spawn from 'cross-spawn'
import tempy from 'tempy'
import { createEnv } from './benchmarkFixture.js'

const TMP = tempy.directory()
const NVM_REPOSITORY = 'https://github.com/nvm-sh/nvm.git'
const TIMINGS_ENV = 'BENCHMARK_TIMINGS_FILE'

// The install scenarios measure the primary version. The secondary one is what
// the global default is switched away from and what the project is pinned to.
export const PRIMARY_NODE_VERSION = '24'
export const SECONDARY_NODE_VERSION = '22'

// Running Node.js takes single digit milliseconds, which is the same order of
// magnitude as the noise of starting a process, so that scenario is measured
// repeatedly and the fastest run is kept.
const RUNS_PER_MEASUREMENT = 10

// Every command is a shell command, because nvm is a shell function rather than
// an executable. What a shell has to load before the command can run at all
// (`nvm.sh` for nvm, nothing for the others) is the runner's `prelude`, which is
// evaluated once per measurement and never timed: a shell pays it on startup,
// not on every command.
//
// Each runner isolates its tool in `dir` so that scenarios never see the
// machine's real Node.js installations:
//   env()                     environment that points the tool at `dir`
//   prepare()                 create whatever the tool expects to exist upfront
//   prelude                   shell code the tool's commands need
//   install(version)          install a version and make it the global default
//   setDefault(version)       make an installed version the global default
//   dropInstalled()           remove installed runtimes, keeping the tool's cache
//   defaultVersion            print the version the global default resolves to
//   pinProject(dir, version)  pin a project directory to a version
//   runInProject              run Node.js in a pinned project directory
const runners = {
  pnpm12: (dir) => {
    // pnpm keeps the linked runtime under PNPM_HOME and the fetched files in
    // its content-addressable store, which lives outside of PNPM_HOME here so
    // that dropping the installed runtime leaves the store warm.
    const home = path.join(dir, 'home')
    const store = path.join(dir, 'store')
    const install = (version) => `pnpm runtime set node ${version} --global --store-dir=${quote(store)}`
    // pnpm refuses to install a global runtime when its global bin directory
    // is not in PATH, so the directory is created and exported upfront.
    const prepare = () => fs.mkdirSync(path.join(home, 'bin'), { recursive: true })
    return {
      env: (baseEnv) => {
        const env = Object.create(baseEnv)
        const pathEnv = pathKey()
        env.PNPM_HOME = home
        env[pathEnv] = [path.join(home, 'bin'), baseEnv[pathEnv]].join(path.delimiter)
        // What these scenarios measure is pnpm's per-project runtime
        // switching, and a `globalShims` override in the inherited
        // environment reaches into both halves of it: at link time it makes
        // `pnpm runtime set` write a plain link instead of the switching
        // shim, and at run time it turns an already-written shim's dispatch
        // off. CI is such an environment — pnpm/setup exports
        // `PNPM_CONFIG_GLOBAL_SHIMS={"node":false}` to keep the runtime it
        // installed authoritative for the job. Empty means unset to pnpm,
        // and assignment is the only way to mask a value the base
        // environment holds through the prototype chain.
        env.PNPM_CONFIG_GLOBAL_SHIMS = ''
        env.pnpm_config_global_shims = ''
        return env
      },
      prepare,
      prelude: '',
      install,
      // pnpm has no dedicated command for this: setting an already installed
      // version links it into the global bin directory.
      setDefault: install,
      dropInstalled: () => {
        rimraf.sync(home)
        prepare()
      },
      // The `node` on PATH is a shim that runs the version of the current
      // project, or the global default outside of a project.
      defaultVersion: 'node --version',
      pinProject: (projectDir, version) => {
        fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
          name: 'pinned-project',
          devEngines: { runtime: { name: 'node', version, onFail: 'download' } },
        }))
      },
      runInProject: 'node --version',
    }
  },
  fnm: (dir) => {
    const fnmDir = path.join(dir, 'fnm')
    return {
      env: (baseEnv) => {
        const env = Object.create(baseEnv)
        env.FNM_DIR = fnmDir
        return env
      },
      prepare: () => {},
      prelude: '',
      install: (version) => `fnm install ${version}`,
      setDefault: (version) => `fnm default ${version}`,
      // fnm stores nothing besides the unpacked versions, so this leaves it
      // with a cold cache. That is the point of the scenario: fnm has to
      // download Node.js again, pnpm and nvm can unpack what they kept.
      dropInstalled: () => {
        rimraf.sync(path.join(fnmDir, 'node-versions'))
        rimraf.sync(path.join(fnmDir, 'aliases'))
      },
      defaultVersion: 'fnm exec --using=default -- node --version',
      pinProject: (projectDir, version) => {
        fs.writeFileSync(path.join(projectDir, '.node-version'), `${version}\n`)
      },
      // `fnm exec` resolves the version of the current project and runs the
      // command with it, which is what the `--use-on-cd` shell hook does.
      runInProject: 'fnm exec -- node --version',
    }
  },
  nvm: (dir, opts) => {
    // nvm.sh lives inside NVM_DIR next to the versions it installs, so the
    // clone is copied in rather than pointed at.
    const nvmDir = path.join(dir, 'nvm')
    return {
      env: (baseEnv) => {
        const env = Object.create(baseEnv)
        env.NVM_DIR = nvmDir
        return env
      },
      prepare: () => {
        fs.cpSync(nvmSourceDir(opts.managersDir), nvmDir, { recursive: true })
      },
      prelude: 'source "$NVM_DIR/nvm.sh" --no-use',
      install: (version) => `nvm install ${version}`,
      setDefault: (version) => `nvm alias default ${version}`,
      // nvm keeps the downloaded tarballs in `$NVM_DIR/.cache`, which stays.
      dropInstalled: () => {
        rimraf.sync(path.join(nvmDir, 'versions'))
        rimraf.sync(path.join(nvmDir, 'alias'))
      },
      defaultVersion: 'nvm version default',
      pinProject: (projectDir, version) => {
        fs.writeFileSync(path.join(projectDir, '.nvmrc'), `${version}\n`)
      },
      // nvm switches the shell rather than the command: this is what a cd hook
      // running `nvm use` costs, plus running the Node.js binary it selected.
      runInProject: 'nvm use --silent && node --version',
    }
  },
}

/**
 * Clones nvm into the directory the benchmark runs it from. Unlike the other
 * tools, nvm is not an executable that can be put on PATH.
 */
export function cloneNvm (managersDir) {
  const dir = nvmSourceDir(managersDir)
  rimraf.sync(dir)
  // The benchmark sources the cloned `nvm.sh`, so it checks out the newest
  // release rather than whatever the default branch happens to be, the same
  // way the other tools are installed from their releases.
  const tag = latestNvmTag()
  const result = spawn.sync('git', ['clone', '--depth=1', `--branch=${tag}`, NVM_REPOSITORY, dir], { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`Failed to clone nvm ${tag} from ${NVM_REPOSITORY}`)
  }
}

function latestNvmTag () {
  const result = spawn.sync('git', ['ls-remote', '--tags', '--refs', '--sort=-v:refname', NVM_REPOSITORY, 'v*'])
  const tag = result.stdout?.toString().match(/refs\/tags\/(v[\d.]+)/)?.[1]
  if (result.status !== 0 || !tag) {
    throw new Error(`Couldn't detect the latest release of nvm. ${result.stderr?.toString() ?? ''}`)
  }
  return tag
}

/**
 * nvm has no executable to ask for a version, so its version is read the same
 * way it reports it itself. Returns undefined for tools that `<tool> --version`
 * already works for.
 */
export function readManagerVersion (pm, opts) {
  if (pm.scenario !== 'nvm') return undefined
  const env = Object.create(createEnv(opts.managersDir))
  env.NVM_DIR = nvmSourceDir(opts.managersDir)
  const runner = { prelude: 'source "$NVM_DIR/nvm.sh" --no-use' }
  return captureShell(runner, 'nvm --version', opts.managersDir, env).trim()
}

export default async function benchmarkNodeVersions (pm, opts) {
  const dir = path.join(TMP, pm.scenario)
  rimraf.sync(dir)
  fs.mkdirSync(dir, { recursive: true })

  const runner = runners[pm.scenario](dir, opts)
  const env = runner.env(createEnv(opts.managersDir))
  runner.prepare()

  console.log('# clean install of Node.js')

  const cleanInstall = measure(runner, runner.install(PRIMARY_NODE_VERSION), dir, env)

  runner.dropInstalled()

  console.log('# install of Node.js with a warm store')

  const warmStoreInstall = measure(runner, runner.install(PRIMARY_NODE_VERSION), dir, env)

  console.log(`# installing Node.js ${SECONDARY_NODE_VERSION} for the project to pin`)

  run(runner, runner.install(SECONDARY_NODE_VERSION), dir, env)
  // The tools disagree on what installing selects, so the version the project
  // pins is read while it is the default, and the default is then set back to
  // the other one. The project scenario below is only meaningful when the
  // project asks for a version the global default isn't.
  run(runner, runner.setDefault(SECONDARY_NODE_VERSION), dir, env)
  const pinnedVersion = readDefaultVersion(runner, dir, env)
  assertVersion(pinnedVersion, SECONDARY_NODE_VERSION)
  run(runner, runner.setDefault(PRIMARY_NODE_VERSION), dir, env)
  assertVersion(readDefaultVersion(runner, dir, env), PRIMARY_NODE_VERSION)

  console.log(`# running Node.js in a project pinned to ${pinnedVersion}`)

  const projectDir = path.join(dir, 'project')
  fs.mkdirSync(projectDir, { recursive: true })
  runner.pinProject(projectDir, pinnedVersion)
  // The first run materializes the pinned runtime, the benchmark measures the
  // repeated runs that a project does afterwards.
  assertVersion(captureShell(runner, runner.runInProject, projectDir, env).trim(), SECONDARY_NODE_VERSION)
  const runInProject = measure(runner, runner.runInProject, projectDir, env, RUNS_PER_MEASUREMENT)

  rimraf.sync(dir)
  return {
    cleanInstall,
    warmStoreInstall,
    runInProject,
  }
}

function readDefaultVersion (runner, cwd, env) {
  return captureShell(runner, runner.defaultVersion, cwd, env).trim().replace(/^v/, '')
}

// Guards against measuring some other Node.js that happens to be on PATH, and
// against a scenario silently degrading into a no-op.
function assertVersion (actual, expectedMajor) {
  if (!/^v?\d+\./.test(actual) || actual.replace(/^v/, '').split('.')[0] !== expectedMajor) {
    throw new Error(`Expected Node.js ${expectedMajor} to be used, got "${actual}"`)
  }
}

/**
 * Runs `command` `runs` times and returns the fastest run in milliseconds. The
 * timing is taken inside the shell, so neither the prelude nor the startup of
 * the shell itself is counted.
 */
function measure (runner, command, cwd, env, runs = 1) {
  assertShellCanTime()
  const timingsFile = path.join(TMP, 'timings.txt')
  fs.writeFileSync(timingsFile, '')
  const script = [
    'set -e',
    runner.prelude,
    `for ((_run = 0; _run < ${runs}; _run++)); do`,
    '  _start=$EPOCHREALTIME',
    `  ${command}`,
    '  _end=$EPOCHREALTIME',
    `  printf '%s %s\\n' "$_start" "$_end" >> "$${TIMINGS_ENV}"`,
    'done',
  ].join('\n')
  runShellScript(script, cwd, shellEnv(env, timingsFile), 'inherit')

  const timings = fs.readFileSync(timingsFile, 'utf8').trim().split('\n')
    .map((line) => {
      const [start, end] = line.split(' ').map(Number)
      return (end - start) * 1000
    })
  // Starting a process cannot take zero time, so anything down there means the
  // shell didn't report what it was asked for rather than that it was fast.
  if (timings.length !== runs || timings.some((timing) => !Number.isFinite(timing) || timing <= 0)) {
    throw new Error(`Expected ${runs} positive timings for "${command}", got "${timings.join(', ')}"`)
  }
  return Math.round(Math.min(...timings) * 100) / 100
}

let shellCanTime
// $EPOCHREALTIME arrived in Bash 5. Older shells expand it to an empty string,
// which would silently turn every measurement into zero. macOS still ships
// Bash 3.2 as /bin/bash.
function assertShellCanTime () {
  if (shellCanTime === undefined) {
    const result = spawn.sync('bash', ['-c', 'printf %s "${BASH_VERSINFO[0]}"'])
    shellCanTime = Number(result.stdout?.toString()) >= 5
  }
  if (!shellCanTime) {
    throw new Error('The Node.js version management benchmark needs Bash 5 or newer on PATH to measure with $EPOCHREALTIME.')
  }
}

function run (runner, command, cwd, env) {
  runShellScript(['set -e', runner.prelude, command].join('\n'), cwd, shellEnv(env), 'inherit')
}

function captureShell (runner, command, cwd, env) {
  return runShellScript(['set -e', runner.prelude, command].join('\n'), cwd, shellEnv(env), ['inherit', 'pipe', 'inherit'])
}

function runShellScript (script, cwd, env, stdio) {
  console.log(`> ${script.split('\n').filter((line) => line && line !== 'set -e').join('; ')}`)
  const result = spawn.sync('bash', ['-c', script], { cwd, env, stdio })
  if (result.status !== 0) {
    throw new Error(`Command failed with status code ${result.status}: ${script}`)
  }
  return result.stdout?.toString() ?? ''
}

// `env` inherits from process.env through the prototype chain, so it is
// extended rather than copied.
function shellEnv (env, timingsFile) {
  const shellEnv = Object.create(env)
  // $EPOCHREALTIME is formatted with the decimal separator of the locale.
  shellEnv.LC_ALL = 'C'
  if (timingsFile) shellEnv[TIMINGS_ENV] = timingsFile
  return shellEnv
}

function nvmSourceDir (managersDir) {
  return path.join(managersDir, 'nvm')
}

function quote (value) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
