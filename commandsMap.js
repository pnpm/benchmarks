// The package managers the benchmark installs with, and the command each is
// measured running. Nothing here says what a column is called or what colour
// it is drawn in: this repository publishes numbers, and how they are
// presented belongs to whoever presents them.
//
// Nor does anything here say which of them a reader is shown. Every manager
// listed is measured and reported in `benchmarks.json`; pnpm.io draws npm and
// the pnpm columns from it, and the rest are measured for our own comparisons.
export default {
  npm: {
    scenario: 'npm',
    name: 'npm',
    args: [
      'install',
      '--no-fund',
      '--no-audit',
      '--ignore-scripts',
      '--cache=cache',
      '--registry=https://registry.npmjs.org/',
      '--legacy-peer-deps',
      // npm CLI fails on the benchmarks with this option. So, commenting out for now.
      // '--install-strategy=linked',
    ]
  },
  pnpm11: {
    scenario: 'pnpm11',
    name: 'pnpm',
    args: [
      'install',
      '--ignore-scripts',
      '--store-dir=cache/store',
      '--cache-dir=cache/cache',
      '--registry=https://registry.npmjs.org/',
      '--no-strict-peer-dependencies',
      '--config.auto-install-peers=false',
      '--config.resolution-mode=highest',
    ]
  },
  pnpm12: {
    scenario: 'pnpm12',
    // The Rust engine keeps its store at $PNPM_HOME/store; scenarios that
    // carry this flag get PNPM_HOME pointed inside the fixture's cache/ dir
    // so the store is cleaned between scenarios like every other cache.
    rustEngine: true,
    name: 'pnpm',
    args: [
      'install',
      '--ignore-scripts',
    ]
  },
  // The command is pnpm 12's, unchanged: what makes this scenario different
  // from the one above is the `pnprServer` the fixture is configured with,
  // which moves dependency resolution onto the registry.
  pnpm_pnpr: {
    scenario: 'pnpm_pnpr',
    rustEngine: true,
    name: 'pnpm',
    args: [
      'install',
      '--ignore-scripts',
    ]
  },
  yarn: {
    scenario: 'yarn',
    name: 'yarn',
    args: [
      'install'
    ]
  },
  bun: {
    scenario: 'bun',
    name: 'bun',
    args: [
      'install',
      '--ignore-scripts',
      '--cache-dir=cache',
      '--registry=https://registry.npmjs.org/',
      // Bun turns on --frozen-lockfile whenever CI is set, which breaks every
      // scenario that starts without a lockfile. Yarn is opted out of the same
      // behaviour through `enableImmutableInstalls: false`.
      '--no-frozen-lockfile',
    ]
  }
}
