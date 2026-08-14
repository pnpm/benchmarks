'use strict'
import fs from 'fs'
import path from 'path'
import rimraf from 'rimraf'
import spawn from 'cross-spawn'

const YARN_REPOSITORY = 'https://repo.yarnpkg.com'

// Every target Yarn publishes. Notably there is no x86_64-apple-darwin build,
// so the benchmark cannot run on an Intel Mac.
const TARGETS = {
  'darwin arm64': 'aarch64-apple-darwin',
  'linux arm64': 'aarch64-unknown-linux-musl',
  'linux ia32': 'i686-unknown-linux-musl',
  'linux x64': 'x86_64-unknown-linux-musl',
}

/**
 * Yarn 6 is a Rust rewrite distributed as a platform binary instead of an npm
 * package, so it can't be installed the way the other package managers are.
 */
export async function installYarn (managersDir) {
  const target = TARGETS[`${process.platform} ${process.arch}`]
  if (!target) {
    throw new Error(`Yarn publishes no ${process.platform} ${process.arch} release, so it cannot be benchmarked on this machine`)
  }
  const version = await latestYarnVersion()
  const downloadDir = path.join(managersDir, '.download')
  const binDir = path.join(managersDir, 'node_modules/.bin')
  rimraf.sync(downloadDir)
  fs.mkdirSync(downloadDir, { recursive: true })
  fs.mkdirSync(binDir, { recursive: true })

  const archive = path.join(downloadDir, 'yarn.zip')
  await download(`${YARN_REPOSITORY}/releases/${version}/${target}`, archive)
  const result = spawn.sync('unzip', ['-q', '-o', archive, '-d', downloadDir], { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`Failed to extract Yarn ${version}`)
  }

  // The archive ships two binaries: `yarn` is Yarn Switch, a shim that resolves
  // and downloads the version a project pins, and `yarn-bin` is the package
  // manager itself. The benchmark installs one known version, so it runs
  // `yarn-bin` and never lets the shim fetch anything mid-measurement.
  const yarnBin = path.join(binDir, 'yarn')
  fs.copyFileSync(path.join(downloadDir, 'yarn-bin'), yarnBin)
  fs.chmodSync(yarnBin, 0o755)
  rimraf.sync(downloadDir)
}

/**
 * Every Yarn 6 release so far is a prerelease, which GitHub's "latest release"
 * endpoint hides, so the version comes from the release channel that Yarn
 * Switch itself reads.
 */
async function latestYarnVersion () {
  const res = await fetch(`${YARN_REPOSITORY}/channels/default/stable`)
  if (!res.ok) {
    throw new Error(`Couldn't detect the latest release of Yarn. ${res.status} ${res.statusText}`)
  }
  return (await res.text()).trim()
}

async function download (url, dest) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download Yarn from ${url}. ${res.status} ${res.statusText}`)
  }
  await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()))
}
