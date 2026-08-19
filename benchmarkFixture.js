'use strict'
import path from 'path'
import pathKey from 'path-key'
import spawn from "cross-spawn"
import { promises as fs, cpSync } from 'fs'
import getFolderSize from 'get-folder-size'
import rimraf from 'rimraf'
import { fileURLToPath } from 'url'
import tempy from 'tempy'

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))

const FIXTURES_DIR = path.join(DIRNAME, 'fixtures')
const TMP = tempy.directory()

const lockfileNameByPM = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
  bun: 'bun.lock'
}

export function createEnv (managersDir) {
  const pathEnv = pathKey()
  const env = Object.create(process.env)
  env[pathEnv] = [
    // Where pnpm 12 links the executables of the package managers it
    // provisions: the directory is the manager's own pnpm home, and `bin` is
    // its global bin directory.
    path.join(managersDir, 'bin'),
    // Where tools installed as packages keep theirs — pnpr today.
    path.join(managersDir, 'node_modules/.bin'),
    path.dirname(process.execPath),
    process.env[pathEnv]
  ].join(path.delimiter)
  return env
}

/**
 * Makes the pnpr server resolve next to the registry instead of across the
 * emulated link.
 *
 * pnpr resolves against the registry URL the client sends, and the client's
 * configured registry sits behind the latency proxy — so without this, the
 * server would fetch every packument by going out through the emulated link
 * and back into its own front door, paying the very round trips per graph
 * level that server-side resolution exists to remove. These are the
 * benchmark-only hooks pnpm's client reads (`PnprBenchmarkRegistryOverride`
 * in the pnpm monorepo, put there for its `integrated-benchmark` task, which
 * models the same co-located server): the resolve request carries this
 * registry — the un-proxied one — and any URL in the answer that names it is
 * rewritten back to the client's own registry, so tarballs still cross the
 * emulated link like every other scenario's do.
 */
export function applyPnprServerRegistry (env, registry) {
  env.PACQUET_BENCHMARK_PNPR_SERVER_REGISTRY = registry
  env.PACQUET_BENCHMARK_PNPR_TARBALL_REWRITE_FROM = registry
}

function cleanLockfile (pm, cwd, env) {
  const lockfileName = lockfileNameByPM[pm.name]
  rimraf.sync(path.join(cwd, lockfileName))
  if (pm.name === 'yarn') {
    // This ensures yarn berry to install under a nested folder
    spawnSyncOrThrow({ name: 'nodetouch', args: [lockfileName] }, { env, cwd, stdio: "inherit" })
  }
}

/**
 * The dependencies the `updatedDependencies` scenario adds on top of the
 * fixture's own. Exported so the registry warm-up can install this graph
 * untimed: it is a different set of packages than the fixture's, and a
 * registry that has never served it would make whoever asks first pay to
 * pull it from npmjs inside a measured run.
 */
export const UPDATED_DEPENDENCIES = {
  "babel-core": "^6.4.0",
  "babel-eslint": "^6.1.2",
  "babel-loader": "^6.2.1",
  "babel-plugin-lodash": "^3.2.11",
  "babel-plugin-module-resolver": "^2.2.0",
  "babel-plugin-transform-decorators-legacy": "^1.3.4",
  "babel-plugin-transform-runtime": "^6.4.3",
  "babel-polyfill": "^6.23.0",
  "babel-preset-es2015": "^6.3.13",
  "babel-preset-react": "^6.3.13",
  "babel-preset-react-hmre": "^1.0.1",
  "babel-preset-stage-1": "^6.3.13",
  "babel-runtime": "^6.3.19",
  "clean-webpack-plugin": "^0.1.16",
  "core-decorators": "^0.12.3",
  "css-loader": "^0.23.1",
  "css-mqpacker": "^4.0.0",
  "react": "^15.4.1",
  "react-addons-css-transition-group": "^15.3.0",
  "react-addons-shallow-compare": "^15.3.0",
  "react-dnd": "^2.1.4",
  "react-dnd-html5-backend": "^2.1.2",
  "react-dom": "^15.4.1",
  "react-draft-wysiwyg": "^1.6.5",
  "react-dropzone": "^3.5.3",
  "react-grid-layout": "^0.12.6",
  "react-highcharts": "^11.5.0",
  "react-hot-loader": "v3.0.0-beta.6",
  "react-input-calendar": "^0.3.14",
  "react-lazyload": "^2.2.5",
  "react-measure": "^1.4.6",
  "react-mixin": "^3.0.3",
  "react-responsive": "^1.2.5",
  "react-responsive-tabs": "^0.5.3",
  "react-router": "^4.0.0",
  "react-router-dom": "^4.0.0",
  "react-select-plus": "^1.0.0-rc",
  "react-skylight": "^0.3.0",
  "react-sortablejs": "^1.2.1",
  "react-tappable": "^0.8.4",
  "react-tooltip": "3.11.2",
  "react-virtualized": "^7.19.4",
  "react-waypoint": "^5.2.0",
}

async function updateDependenciesInPackageJson (cwd) {
  const packageJsonPath = path.join(cwd, 'package.json')
  const buf = await fs.readFile(packageJsonPath)
  const originalAsString = buf.toString()
  const parsed = JSON.parse(originalAsString)

  parsed.dependencies = {
    ...parsed.dependencies,
    ...UPDATED_DEPENDENCIES,
  }

  const modifiedAsString = JSON.stringify(parsed)
  await fs.writeFile(packageJsonPath, modifiedAsString)

  // return the original file so that we can replace it when done
  return originalAsString
}

/**
 * Points a package manager at a registry other than the public one: every
 * install is measured against the benchmark's own pnpr.
 *
 * Reads are anonymous, so no token is needed to fetch packages. The token is
 * only for pnpr's resolver, which does require authentication, and it is
 * written as `_authToken` rather than `_auth` because Basic credentials would
 * cost a password hash on every request inside the measured loop.
 */
async function writeRegistryConfig (pm, cwd, opts) {
  let npmrc = `registry=${opts.registry}\n`
  if (opts.authToken) {
    // The resolver is reached on a link of its own, so it is a different host
    // and port than the registry. pnpm sends whichever credential is
    // configured for the URL it is talking to, and the resolver is the one
    // that demands one, so both are declared.
    const hosts = new Set([opts.registry, opts.pnprServer].filter(Boolean).map((url) => new URL(url).host))
    for (const host of hosts) {
      npmrc += `//${host}/:_authToken=${opts.authToken}\n`
    }
  }
  await fs.writeFile(path.join(cwd, '.npmrc'), npmrc)

  if (pm.name === 'pnpm') {
    await fs.writeFile(path.join(cwd, 'pnpm-workspace.yaml'), pnpmWorkspaceYaml(opts))
  }
}

/**
 * The workspace manifest every pnpm scenario installs under. `packages`
 * declares the fixture its own workspace root, so pnpm never walks up into a
 * directory the benchmark doesn't control. When the scenario offloads
 * resolution, `pnprServer` names the server it happens on.
 *
 * `minimumReleaseAge` is deliberately left at pnpm's default, unlike the
 * directories the managers are installed into. The hold is pnpm's default
 * behavior and it shapes what resolution costs, which is the thing the rows
 * without a lockfile measure; the client sends the setting along with its
 * resolve request, so the server applies the same cutoff and both pnpm
 * columns still install the same graph.
 *
 * `trustLockfile` turns off the other half of that policy: the supply-chain
 * pass that re-checks every entry of a lockfile it is about to install. That
 * pass is not free and it is not comparable — it fetches a packument per
 * package, measured at 1158 requests on top of the 1346 tarball fetches this
 * fixture needs, and none of npm, Yarn or Bun does anything of the sort, so
 * the rows with an up-to-date lockfile were timing pnpm doing work no other
 * column was asked to do. The rows say `trusted lockfile` for that reason.
 * pnpm 11 honors the setting too, so all three pnpm columns skip the same
 * pass and the version comparison stays a comparison.
 *
 * It costs the accelerated column its lockfile rows, which is the trade
 * being made knowingly: pnpr answers that pass in one request where the
 * client spends a round trip per package, and with nothing to verify the two
 * pnpm 12 columns now really do measure the same install there — which is
 * what the page has always claimed of them.
 */
export function pnpmWorkspaceYaml (opts = {}) {
  let yaml = "packages:\n  - '.'\ntrustLockfile: true\n"
  if (opts.pnprServer) {
    yaml += `pnprServer: ${opts.pnprServer}\n`
  }
  return yaml
}

/**
 * Undoes an install. Yarn PnP writes no `node_modules` at all, so removing only
 * that would leave its whole installation in place and hand the scenario that
 * follows a project that is already installed.
 */
function removeInstallOutput (cwd, modules) {
  if (modules) {
    rimraf.sync(modules)
  }
  for (const name of ['.pnp.cjs', '.pnp.loader.mjs', '.yarn']) {
    rimraf.sync(path.join(cwd, name))
  }
}

export default async function benchmark (pm, fixture, opts) {
  const cwd = path.join(TMP, pm.scenario, fixture)
  const env = createEnv(opts.managersDir)
  if (pm.rustEngine) {
    // pnpm 12's Rust engine uses the store layout at $PNPM_HOME/store, which lines
    // up with the cache/ directory the rest of the flow cleans between scenarios.
    env.PNPM_HOME = path.join(cwd, 'cache')
    // $PNPM_HOME moves only the store: the engine's cacheDir — the packument
    // mirror and the lockfile-verification verdict file — defaults to the
    // machine's own ~/.cache/pnpm, where it would survive every wipe. Left
    // there, no measured install ever resolves or verifies cold: the untimed
    // warm-up fills the mirror and the "no cache" rows silently read it,
    // an advantage no other column gets (their caches all live under the
    // cache/ directory the scenarios delete). Pin it inside cache/ like
    // pnpm 11's --cache-dir, so wiping cache/ means what it says.
    env.PNPM_CONFIG_CACHE_DIR = path.join(cwd, 'cache', 'cache')
  }
  if (opts.pnprServerRegistry) {
    applyPnprServerRegistry(env, opts.pnprServerRegistry)
  }
  cpSync(path.join(FIXTURES_DIR, fixture), cwd, { recursive: true })
  const modules = opts.hasNodeModules ? path.join(cwd, 'node_modules') : null

  cleanLockfile(pm, cwd, env)

  if (opts.registry) {
    await writeRegistryConfig(pm, cwd, opts)
  }

  if (pm.name === 'yarn') {
    // Every store Yarn keeps has to sit under `cache/`, the directory the
    // scenarios below delete to go back to a cold cache. `enableMirror` alone
    // stopped being enough once Yarn started caching globally by default:
    // without `enableGlobalCache`, packages land in `globalFolder` instead and
    // survive every scenario, so no run ever measures a cold cache.
    let yarnRc =
      'enableImmutableInstalls: false\n'
    + 'enableGlobalCache: false\n'
    + 'enableMirror: false\n'
    + `cacheFolder: ${path.join(cwd, 'cache')}\n`
    + `globalFolder: ${path.join(cwd, 'cache', 'global')}\n`
    + 'enableScripts: false\n'
    // Yarn reads none of `.npmrc`, so its registry has to be set here.
    + (opts.registry ? `npmRegistryServer: ${opts.registry}\nunsafeHttpWhitelist:\n  - 127.0.0.1\n` : '')
    /**
     * @see https://yarnpkg.com/configuration/yarnrc#nodeLinker
     */
    switch (pm.scenario) {
      case 'yarn':
        yarnRc += 'nodeLinker: pnpm\n'
                + 'nmMode: hardlinks-local\n'
                + 'compressionLevel: 0\n'
        break
      case 'yarn_pnp':
        yarnRc += 'nodeLinker: pnp\n'
        break
    }
    await fs.writeFile(path.join(cwd, '.yarnrc.yml'), yarnRc)
  }

  // Installs that nothing is measured from, to keep whatever only the very
  // first install of a run pays for out of the numbers: a registry answering a
  // question it has never been asked, a package manager's own start-up, a
  // filesystem that has not seen these paths yet.
  //
  // It runs three times because an install without a lockfile, an install with
  // one, and an install whose manifest the lockfile no longer matches are
  // different questions, and a server that caches answers has to have been
  // asked all three. The first warm-up produces the lockfile the second one
  // sends, and `node_modules` goes away in between: a package manager that
  // already has the right tree installed skips resolving altogether, so leaving
  // it in place means the second warm-up asks nothing and the question it
  // exists to ask stays cold until a scenario that is being measured asks it.
  // The third asks the `updatedDependencies` question — without it, that
  // scenario would be the only measured install whose resolution the server
  // (and, for the accelerated column, pnpr's resolver) had never seen, and it
  // would pay first-ever costs inside the one run that is timed.
  console.log('# warm-up (not measured)')
  measureInstall(pm, cwd, env)
  removeInstallOutput(cwd, modules)
  measureInstall(pm, cwd, env)
  removeInstallOutput(cwd, modules)
  const warmUpPackageJson = await updateDependenciesInPackageJson(cwd)
  measureInstall(withUpdateArgs(pm), cwd, env)
  await fs.writeFile(path.join(cwd, 'package.json'), warmUpPackageJson)
  removeInstallOutput(cwd, modules)
  rimraf.sync(path.join(cwd, 'cache'))
  cleanLockfile(pm, cwd, env)

  console.log(`# first install`)

  const firstInstall = measureInstall(pm, cwd, env)

  let repeatInstall
  if (modules) {
    console.log(`# repeat install`)

    repeatInstall = measureInstall(pm, cwd, env)

    rimraf.sync(modules)
  } else {
    repeatInstall = 0
  }

  console.log(`# with warm cache and lockfile`)

  const withWarmCacheAndLockfile = measureInstall(pm, cwd, env)

  if (modules) {
    rimraf.sync(modules)
  }

  cleanLockfile(pm, cwd)

  console.log('# with warm cache')

  const withWarmCache = measureInstall(pm, cwd, env)

  if (modules) {
    rimraf.sync(modules)
  }
  rimraf.sync(path.join(cwd, 'cache'))

  console.log('# with lockfile')

  const withLockfile = measureInstall(pm, cwd, env)

  cleanLockfile(pm, cwd)

  let withWarmCacheAndModules
  let withWarmModulesAndLockfile
  let withWarmModules
  let size
  if (modules) {
    console.log('# with warm cache and modules')

    withWarmCacheAndModules = measureInstall(pm, cwd, env)

    rimraf.sync(path.join(cwd, 'cache'))

    console.log('# with warm modules and lockfile')

    withWarmModulesAndLockfile = measureInstall(pm, cwd, env)

    rimraf.sync(path.join(cwd, 'cache'))
    cleanLockfile(pm, cwd)

    console.log('# with warm modules')

    withWarmModules = measureInstall(pm, cwd, env)

    size = await getFolderSize.loose(modules)
  } else {
    withWarmCacheAndModules =
      withWarmModulesAndLockfile =
      withWarmModules = 0
    size = await getFolderSize.loose(path.join(cwd, 'cache'))
  }

  console.log('# with updated dependencies')

  // update all dependency versions to '*' and install again
  const originalPackageJson = await updateDependenciesInPackageJson(cwd)
  const updatedDependencies = measureInstall(withUpdateArgs(pm), cwd, env)

  // revert `package.json` back to its original state, just in case
  await fs.writeFile(path.join(cwd, 'package.json'), originalPackageJson)

  rimraf.sync(cwd)
  return {
    firstInstall,
    repeatInstall,
    withWarmCacheAndLockfile,
    withWarmCache,
    withLockfile,
    withWarmCacheAndModules,
    withWarmModulesAndLockfile,
    withWarmModules,
    updatedDependencies,
    size
  }
}

/**
 * The command for an install whose `package.json` changed under an existing
 * lockfile. pnpm turns on `--frozen-lockfile` when CI is set, which refuses
 * exactly that state, so the flag has to be lifted for it.
 */
function withUpdateArgs (pm) {
  if (pm.name !== 'pnpm') return pm
  return {
    ...pm,
    args: [...pm.args, '--no-frozen-lockfile'],
  }
}

function measureInstall (cmd, cwd, env) {
  const startTime = Date.now()

  console.log(`> ${cmd.name} ${cmd.args.join(' ')}`)
  spawnSyncOrThrow(cmd, { env, cwd, stdio: "inherit" });

  const endTime = Date.now()

  return endTime - startTime
}

function spawnSyncOrThrow (cmd, opts) {
  const result = spawn.sync(cmd.name, cmd.args, opts);
  if (result.status !== 0) {
    throw new Error(`${cmd.name} failed with status code ${result.status}`)
  }
  return result;
}

