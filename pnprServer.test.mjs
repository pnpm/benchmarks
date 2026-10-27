import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import tempy from 'tempy'
import writeYamlFile from 'write-yaml-file'
import {
  collectLockedPackages,
  packageSegments,
  variantPath,
  warmZstdEncodings,
} from './pnprServer.js'

const REGISTRY = 'http://127.0.0.1:41647/npm/'

test('collectLockedPackages keeps pnpr-rewritten registry tarballs and skips non-registry entries', async () => {
  const dir = tempy.directory()
  const lockfilePath = path.join(dir, 'pnpm-lock.yaml')
  await writeYamlFile(lockfilePath, {
    lockfileVersion: '9.0',
    packages: {
      'left-pad@1.3.0': {
        resolution: {
          integrity: 'sha512-plain',
        },
      },
      '@scope/pkg@2.0.0': {
        resolution: {
          integrity: 'sha512-rewritten',
          tarball: `${REGISTRY}@scope/pkg@2.0.0`,
        },
      },
      'ext-tarball@https://example.com/ext.tgz': {
        resolution: {
          integrity: 'sha512-external',
          tarball: 'https://example.com/ext.tgz',
        },
      },
      'git-pkg@git+https://example.com/repo.git#deadbeef': {
        resolution: {
          type: 'git',
          repo: 'https://example.com/repo.git',
          commit: 'deadbeef',
        },
      },
    },
  })

  const packages = new Map()
  collectLockedPackages(lockfilePath, REGISTRY, packages)

  assert.deepEqual([...packages.entries()], [
    ['left-pad@1.3.0', { name: 'left-pad', version: '1.3.0', integrity: 'sha512-plain' }],
    ['@scope/pkg@2.0.0', { name: '@scope/pkg', version: '2.0.0', integrity: 'sha512-rewritten' }],
  ])
})

test('collectLockedPackages refuses a lockfile with no registry packages', async () => {
  const dir = tempy.directory()
  const lockfilePath = path.join(dir, 'pnpm-lock.yaml')
  await writeYamlFile(lockfilePath, {
    lockfileVersion: '9.0',
    packages: {
      'ext@https://example.com/ext.tgz': {
        resolution: {
          integrity: 'sha512-external',
          tarball: 'https://example.com/ext.tgz',
        },
      },
    },
  })

  assert.throws(
    () => collectLockedPackages(lockfilePath, REGISTRY, new Map()),
    /No registry packages found/
  )
})

test('packageSegments and variantPath match pnpr storage layout', () => {
  assert.deepEqual(packageSegments('left-pad'), ['@', 'left-pad'])
  assert.deepEqual(packageSegments('@scope/pkg'), ['@scope', 'pkg'])
  assert.deepEqual(packageSegments('@Scope/Pkg'), ['@!53cope', '!50kg'])

  const integrity = 'sha512-abc'
  const hash = crypto.createHash('sha256').update(integrity).digest('hex')
  assert.equal(
    variantPath('/storage/.pnpr-cache/~tar-zstd19/packages', { name: '@scope/pkg', integrity }),
    path.join('/storage/.pnpr-cache/~tar-zstd19/packages', '@scope', 'pkg', 'blobs', `${hash}.tar.zst`)
  )
  assert.equal(
    variantPath('/storage/.pnpr-cache/~tar-zstd19/packages', { name: 'left-pad', integrity }),
    path.join('/storage/.pnpr-cache/~tar-zstd19/packages', '@', 'left-pad', 'blobs', `${hash}.tar.zst`)
  )
})

test('warmZstdEncodings writes variants at the expected layout and fails on layout mismatch', async () => {
  const storageDir = tempy.directory()
  const variantsDir = path.join(storageDir, '.pnpr-cache', '~tar-zstd19', 'packages')
  const pkg = { name: '@scope/pkg', version: '1.0.0', integrity: 'sha512-test' }
  const packages = new Map([['@scope/pkg@1.0.0', pkg]])

  let writeAtExpectedPath = false
  const server = http.createServer((req, res) => {
    if (writeAtExpectedPath && req.url === '/npm/~zstd/@scope/pkg@1.0.0') {
      const target = variantPath(variantsDir, pkg)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, 'zstd-bytes')
    }
    res.writeHead(200)
    res.end('tar-bytes')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const tarRegistry = `http://127.0.0.1:${server.address().port}/npm/~zstd/`

  try {
    await assert.rejects(
      () => warmZstdEncodings({ storageDir, tarRegistry, packages }),
      /No level-19 zstd encoding appeared/
    )

    writeAtExpectedPath = true
    await warmZstdEncodings({ storageDir, tarRegistry, packages })
    assert.ok(fs.existsSync(variantPath(variantsDir, pkg)))
  } finally {
    server.close()
  }
})
