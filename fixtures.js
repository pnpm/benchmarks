// The fixtures every measured package manager is run against, and the
// only thing the populate pass and the measuring pass have to agree on:
// a registry warmed for one set of fixtures and measured against another
// would hand whichever manager ran first the cost of the difference,
// inside a timed install.
//
// `skipManagers` names the scenarios a fixture is not measured with. It
// exists for a manager a fixture is pathological for, where the row would
// dominate the run's wall time and tell a reader nothing they can't
// already see on a fixture that finishes.
export const fixtures = [
  { name: 'alotta-files' },
  {
    // A dependency graph big enough for the graph-shaped costs to show.
    // On `alotta-files` they cancel out: what a package manager saves by
    // not materializing a package it already has is about what it spends
    // walking 1.3k packages to decide that, so two linking strategies
    // that differ a lot at scale land on the same number there.
    name: 'alotta-packages',
    // pnpm 11 resolves this graph in ~21 minutes, against 6 seconds for
    // pnpm 12 — measured on the same manifest, the same warm registry and
    // a cold packument cache, resolution only. The old resolver is what
    // is slow, not the fixture: `dedupePeers` changes it by 1%, and the
    // lockfile carries no nested peer suffixes for it to collapse. Every
    // scenario resolves this graph three times (two warm-ups and the
    // measured row), so keeping the column would cost an hour a sample to
    // restate what the `alotta-files` pnpm 11 column already shows.
    skipManagers: ['pnpm11'],
  },
]

/** Just the names — what the registry warm-up and the populate pass take. */
export const fixtureNames = fixtures.map((fixture) => fixture.name)
