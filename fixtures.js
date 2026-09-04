// The fixtures every measured package manager is run against, and the
// only thing the populate pass and the measuring pass have to agree on:
// a registry warmed for one set of fixtures and measured against another
// would hand whichever manager ran first the cost of the difference,
// inside a timed install.
//
// `skipManagers` names the scenarios a fixture is not measured with — for
// a manager the fixture is pathological for, or one that cannot install it
// at all. Every entry needs a reason recorded here: a column that quietly
// stops being measured is worse than one that is slow, because a reader
// cannot tell the difference from the numbers.
export const fixtures = [
  { name: 'alotta-files' },
  {
    // A dependency graph big enough for the graph-shaped costs to show.
    // On `alotta-files` they cancel out: what a package manager saves by
    // not materializing a package it already has is about what it spends
    // walking 1.3k packages to decide that, so two linking strategies
    // that differ a lot at scale land on the same number there.
    name: 'alotta-packages',
  },
  {
    // The largest graph the benchmark installs, and the shape no
    // collection of ordinary dependencies reaches: one direct dependency
    // that pulls ~5.4k packages and ~140k files, most of them from one
    // scope, resolving through a registry of bit's own.
    //
    // Kept apart from `alotta-packages` rather than folded into it. Two
    // managers cannot install it, and mixing it in would have cost that
    // fixture its pnpm 11 and Yarn columns as well — where both are
    // perfectly able to install ~3k ordinary packages, and do.
    name: 'bit-cli',
    // pnpm 11 resolves this graph in ~21 minutes, against 6 seconds for
    // pnpm 12 — same manifest, same warm registry, cold packument cache,
    // resolution only. The old resolver is what is slow, not the graph:
    // `dedupePeers` changes it by 1%, and the lockfile carries no nested
    // peer suffixes for that setting to collapse. Every scenario resolves
    // three times (two warm-ups and the measured row), so the column
    // would cost about an hour a sample to restate what the pnpm 11
    // columns on the other two fixtures already show.
    //
    // Yarn cannot install it at all. Yarn 6.0.0-rc.20's `nodeLinker: pnpm`
    // — which is what the benchmark measures Yarn with, to compare like
    // for like against pnpm's isolated layout — fails with
    // `I/O error (Permission denied (os error 13))` on any package that
    // ships a read-only file. `stringcase@4.3.1` alone reproduces it;
    // npm, pnpm and Bun install that package fine, and Yarn's default
    // `node-modules` linker does too. This graph carries at least six
    // such packages. Drop the skip when Yarn fixes it — the fixture is
    // measured with every other manager meanwhile.
    skipManagers: ['pnpm11', 'yarn'],
  },
]

/** Just the names — what the registry warm-up and the populate pass take. */
export const fixtureNames = fixtures.map((fixture) => fixture.name)
