export default {
  npm: {
    scenario: 'npm',
    legend: 'npm',
    color: '#cd3731',
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
    legend: 'pnpm',
    color: '#fbae00',
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
    legend: 'pnpm 🦀',
    mdLegend: '[pnpm 🦀](https://github.com/pnpm/pacquet)',
    color: '#fbae00',
    displayVersion: '12',
    mascot: '🦀',
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
  // The command is pnpm 12's, unchanged: what makes this column different from
  // the pnpm 🦀 one is the `pnprServer` the fixture is configured with, which
  // moves dependency resolution onto the registry.
  pnpm_pnpr: {
    scenario: 'pnpm_pnpr',
    legend: 'pnpm + pnpr',
    mdLegend: '[pnpm + pnpr](https://pnpm.io/pnpr/install-acceleration)',
    color: '#2fa84f',
    displayVersion: '12',
    rustEngine: true,
    name: 'pnpm',
    args: [
      'install',
      '--ignore-scripts',
    ]
  },
  yarn: {
    scenario: 'yarn',
    legend: 'Yarn',
    color: '#248ebd',
    name: 'yarn',
    args: [
      'install'
    ]
  },
  bun: {
    scenario: 'bun',
    legend: 'Bun',
    color: '#e0709a',
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
