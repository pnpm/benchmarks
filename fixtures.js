// The fixtures every measured package manager is run against, and the
// only thing the populate pass and the measuring pass have to agree on:
// a registry warmed for one set of fixtures and measured against another
// would hand whichever manager ran first the cost of pulling the
// difference from npmjs, inside a timed install.
export const fixtures = [
  /* 'react-app', 'ember-quickstart', 'angular-quickstart', 'medium-size-app' */
  'alotta-files',
  // A dependency graph big enough for the graph-shaped costs to show. On
  // `alotta-files` they cancel out: what a package manager saves by not
  // materializing a package it already has is about what it spends walking
  // 1.3k packages to decide that, so two linking strategies that differ a
  // lot at scale land on the same number there. This fixture is ~5k
  // packages and ~140k files, which is where they separate.
  'alotta-packages',
]
