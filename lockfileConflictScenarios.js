// Twenty-five 3-way Git merge scenarios covering concurrent dependency and
// workspace changes across package managers and lockfile versions.
export const lockfileConflictScenarios = [
  {
    id: 'S01_add_non_adjacent_deps',
    description: 'Add two non-adjacent direct dependencies (abbrev & wrappy)',
    base: { dependencies: { debug: '4.4.3', ini: '5.0.0', once: '1.4.0' } },
    branchA: { dependencies: { abbrev: '^3.0.0', debug: '4.4.3', ini: '5.0.0', once: '1.4.0' } },
    branchB: { dependencies: { debug: '4.4.3', ini: '5.0.0', once: '1.4.0', wrappy: '^1.0.2' } },
    merged: { dependencies: { abbrev: '^3.0.0', debug: '4.4.3', ini: '5.0.0', once: '1.4.0', wrappy: '^1.0.2' } },
  },
  {
    id: 'S02_add_adjacent_deps_middle',
    description: 'Add two alphabetically adjacent direct dependencies (fast-copy & fast-redact)',
    base: { dependencies: { abbrev: '^3.0.0', once: '^1.4.0', wrappy: '^1.0.2' } },
    branchA: { dependencies: { abbrev: '^3.0.0', 'fast-copy': '^3.1.0', once: '^1.4.0', wrappy: '^1.0.2' } },
    branchB: { dependencies: { abbrev: '^3.0.0', 'fast-redact': '^3.5.0', once: '^1.4.0', wrappy: '^1.0.2' } },
    merged: { dependencies: { abbrev: '^3.0.0', 'fast-copy': '^3.1.0', 'fast-redact': '^3.5.0', once: '^1.4.0', wrappy: '^1.0.2' } },
  },
  {
    id: 'S03_add_deps_at_end',
    description: 'Add two direct dependencies at the end of dependencies (once & wrappy)',
    base: { dependencies: { abbrev: '^3.0.0', ini: '^5.0.0' } },
    branchA: { dependencies: { abbrev: '^3.0.0', ini: '^5.0.0', once: '^1.4.0' } },
    branchB: { dependencies: { abbrev: '^3.0.0', ini: '^5.0.0', wrappy: '^1.0.2' } },
    merged: { dependencies: { abbrev: '^3.0.0', ini: '^5.0.0', once: '^1.4.0', wrappy: '^1.0.2' } },
  },
  {
    id: 'S04_bump_non_adjacent_deps',
    description: 'Bump two non-adjacent direct dependencies (abbrev & safe-stable-stringify)',
    base: { dependencies: { abbrev: '2.0.0', 'fast-copy': '3.1.0', ini: '5.0.0', 'safe-stable-stringify': '2.4.3' } },
    branchA: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0', ini: '5.0.0', 'safe-stable-stringify': '2.4.3' } },
    branchB: { dependencies: { abbrev: '2.0.0', 'fast-copy': '3.1.0', ini: '5.0.0', 'safe-stable-stringify': '2.5.0' } },
    merged: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0', ini: '5.0.0', 'safe-stable-stringify': '2.5.0' } },
  },
  {
    id: 'S05_bump_adjacent_deps_exact',
    description: 'Bump two adjacent exact direct dependencies (fast-copy & fast-redact)',
    base: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.0.0', 'fast-redact': '3.4.0', ini: '5.0.0' } },
    branchA: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0', 'fast-redact': '3.4.0', ini: '5.0.0' } },
    branchB: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.0.0', 'fast-redact': '3.5.0', ini: '5.0.0' } },
    merged: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0', 'fast-redact': '3.5.0', ini: '5.0.0' } },
  },
  {
    id: 'S06_bump_adjacent_deps_ranged',
    description: 'Bump two adjacent ranged direct dependencies (~3.0.0->^3.1.0, ~3.4.0->^3.5.0)',
    base: { dependencies: { abbrev: '^3.0.0', 'fast-copy': '~3.0.0', 'fast-redact': '~3.4.0', ini: '^5.0.0' } },
    branchA: { dependencies: { abbrev: '^3.0.0', 'fast-copy': '^3.1.0', 'fast-redact': '~3.4.0', ini: '^5.0.0' } },
    branchB: { dependencies: { abbrev: '^3.0.0', 'fast-copy': '~3.0.0', 'fast-redact': '^3.5.0', ini: '^5.0.0' } },
    merged: { dependencies: { abbrev: '^3.0.0', 'fast-copy': '^3.1.0', 'fast-redact': '^3.5.0', ini: '^5.0.0' } },
  },
  {
    id: 'S07_remove_and_bump_adjacent_pkg',
    description: 'Branch A removes fast-copy; Branch B bumps adjacent fast-redact',
    base: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.0.0', 'fast-redact': '3.4.0', ini: '5.0.0' } },
    branchA: { dependencies: { abbrev: '3.0.1', 'fast-redact': '3.4.0', ini: '5.0.0' } },
    branchB: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.0.0', 'fast-redact': '3.5.0', ini: '5.0.0' } },
    merged: { dependencies: { abbrev: '3.0.1', 'fast-redact': '3.5.0', ini: '5.0.0' } },
  },
  {
    id: 'S08_add_and_bump_adjacent_pkg',
    description: 'Branch A adds fast-copy right before fast-redact; Branch B bumps fast-redact',
    base: { dependencies: { abbrev: '3.0.1', 'fast-redact': '3.4.0', ini: '5.0.0' } },
    branchA: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0', 'fast-redact': '3.4.0', ini: '5.0.0' } },
    branchB: { dependencies: { abbrev: '3.0.1', 'fast-redact': '3.5.0', ini: '5.0.0' } },
    merged: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0', 'fast-redact': '3.5.0', ini: '5.0.0' } },
  },
  {
    id: 'S09_peer_provider_bump_and_new_consumer',
    description: 'Branch A bumps peer provider (react 18.2.0->18.3.1); Branch B adds a peer consumer in another project',
    base: { workspaces: { a: { dependencies: { react: '18.2.0', 'use-sync-external-store': '1.2.0' } }, b: { dependencies: { ini: '5.0.0' } } } },
    branchA: { workspaces: { a: { dependencies: { react: '18.3.1', 'use-sync-external-store': '1.2.0' } }, b: { dependencies: { ini: '5.0.0' } } } },
    branchB: { workspaces: { a: { dependencies: { react: '18.2.0', 'use-sync-external-store': '1.2.0' } }, b: { dependencies: { ini: '5.0.0', react: '18.2.0', 'use-sync-external-store': '1.2.0' } } } },
    merged: { workspaces: { a: { dependencies: { react: '18.3.1', 'use-sync-external-store': '1.2.0' } }, b: { dependencies: { ini: '5.0.0', react: '18.3.1', 'use-sync-external-store': '1.2.0' } } } },
  },
  {
    id: 'S10_peer_provider_bump_and_consumer_bump',
    description: 'Branch A bumps peer provider (react 18.2.0->18.3.1); Branch B bumps peer consumer (use-sync-external-store 1.2.0->1.2.2)',
    base: { dependencies: { ini: '5.0.0', react: '18.2.0', 'use-sync-external-store': '1.2.0' } },
    branchA: { dependencies: { ini: '5.0.0', react: '18.3.1', 'use-sync-external-store': '1.2.0' } },
    branchB: { dependencies: { ini: '5.0.0', react: '18.2.0', 'use-sync-external-store': '1.2.2' } },
    merged: { dependencies: { ini: '5.0.0', react: '18.3.1', 'use-sync-external-store': '1.2.2' } },
  },
  {
    id: 'S11_multi_peer_set_intro_vs_provider_bump',
    description: 'Branch A bumps react 18.2.0->18.3.1 in ws/a; Branch B introduces a second peer set (react 17.0.2) in ws/b',
    base: { workspaces: { a: { dependencies: { react: '18.2.0', 'use-sync-external-store': '1.2.2' } }, b: { dependencies: { ini: '5.0.0' } } } },
    branchA: { workspaces: { a: { dependencies: { react: '18.3.1', 'use-sync-external-store': '1.2.2' } }, b: { dependencies: { ini: '5.0.0' } } } },
    branchB: { workspaces: { a: { dependencies: { react: '18.2.0', 'use-sync-external-store': '1.2.2' } }, b: { dependencies: { ini: '5.0.0', react: '17.0.2', 'use-sync-external-store': '1.2.2' } } } },
    merged: { workspaces: { a: { dependencies: { react: '18.3.1', 'use-sync-external-store': '1.2.2' } }, b: { dependencies: { ini: '5.0.0', react: '17.0.2', 'use-sync-external-store': '1.2.2' } } } },
  },
  {
    id: 'S12_workspace_independent_projects',
    description: 'Branch A adds a dependency in packages/a; Branch B adds a dependency in packages/b',
    base: { workspaces: { a: { dependencies: { abbrev: '3.0.1' } }, b: { dependencies: { ini: '5.0.0' } } } },
    branchA: { workspaces: { a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0' } }, b: { dependencies: { ini: '5.0.0' } } } },
    branchB: { workspaces: { a: { dependencies: { abbrev: '3.0.1' } }, b: { dependencies: { ini: '5.0.0', wrappy: '1.0.2' } } } },
    merged: { workspaces: { a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0' } }, b: { dependencies: { ini: '5.0.0', wrappy: '1.0.2' } } } },
  },
  {
    id: 'S13_shared_transitive_dep',
    description: 'Two branches add packages that share transitive dependencies (pump & end-of-stream)',
    base: { dependencies: { abbrev: '3.0.1', ini: '5.0.0' } },
    branchA: { dependencies: { abbrev: '3.0.1', 'end-of-stream': '1.4.5', ini: '5.0.0' } },
    branchB: { dependencies: { abbrev: '3.0.1', ini: '5.0.0', pump: '3.0.4' } },
    merged: { dependencies: { abbrev: '3.0.1', 'end-of-stream': '1.4.5', ini: '5.0.0', pump: '3.0.4' } },
  },
  {
    id: 'S14_workspace_hoisting_shift',
    description: 'Branch A adds ajv@8.17.1 to ws/a; Branch B bumps root ajv 8.12.0->8.17.1',
    base: { dependencies: { ajv: '8.12.0' }, workspaces: { a: { dependencies: { ini: '5.0.0' } }, b: { dependencies: { ms: '2.1.3' } } } },
    branchA: { dependencies: { ajv: '8.12.0' }, workspaces: { a: { dependencies: { ajv: '8.17.1', ini: '5.0.0' } }, b: { dependencies: { ms: '2.1.3' } } } },
    branchB: { dependencies: { ajv: '8.17.1' }, workspaces: { a: { dependencies: { ini: '5.0.0' } }, b: { dependencies: { ms: '2.1.3' } } } },
    merged: { dependencies: { ajv: '8.17.1' }, workspaces: { a: { dependencies: { ajv: '8.17.1', ini: '5.0.0' } }, b: { dependencies: { ms: '2.1.3' } } } },
  },
  {
    id: 'S15_bump_two_multi_dep_packages',
    description: 'Branch A bumps pino 8.19.0->9.0.0 in ws/a; Branch B bumps readable-stream 4.5.2->4.8.0 in ws/b',
    base: { workspaces: { a: { dependencies: { pino: '8.19.0' } }, b: { dependencies: { 'readable-stream': '4.5.2' } } } },
    branchA: { workspaces: { a: { dependencies: { pino: '9.0.0' } }, b: { dependencies: { 'readable-stream': '4.5.2' } } } },
    branchB: { workspaces: { a: { dependencies: { pino: '8.19.0' } }, b: { dependencies: { 'readable-stream': '4.8.0' } } } },
    merged: { workspaces: { a: { dependencies: { pino: '9.0.0' } }, b: { dependencies: { 'readable-stream': '4.8.0' } } } },
  },
  {
    id: 'S16_peer_provider_bump_and_distant_new_consumer',
    description: 'Branch A bumps react 18.2.0->18.3.1; Branch B adds swr@2.2.5 (peer consumer of react) in the same project',
    base: { dependencies: { abbrev: '3.0.1', ini: '5.0.0', react: '18.2.0', 'use-sync-external-store': '1.2.2' } },
    branchA: { dependencies: { abbrev: '3.0.1', ini: '5.0.0', react: '18.3.1', 'use-sync-external-store': '1.2.2' } },
    branchB: {
      seed: { dependencies: { abbrev: '3.0.1', ini: '5.0.0', react: '18.2.0', 'use-sync-external-store': '1.2.2' } },
      dependencies: { abbrev: '3.0.1', ini: '5.0.0', react: '18.2.0', swr: '2.2.5', 'use-sync-external-store': '1.2.2' },
    },
    merged: { dependencies: { abbrev: '3.0.1', ini: '5.0.0', react: '18.3.1', swr: '2.2.5', 'use-sync-external-store': '1.2.2' } },
  },
  {
    id: 'S17_lockfile_only_bump_adjacent_ranged_deps',
    description: 'Manifest ranges (^3.0.0, ^3.4.0) stay unchanged; Branch A updates fast-copy lock 3.0.0->3.1.0, Branch B updates fast-redact lock 3.4.0->3.5.0',
    base: {
      seed: { dependencies: { abbrev: '^3.0.0', 'fast-copy': '3.0.0', 'fast-redact': '3.4.0', ini: '^5.0.0' } },
      dependencies: { abbrev: '^3.0.0', 'fast-copy': '^3.0.0', 'fast-redact': '^3.4.0', ini: '^5.0.0' },
    },
    branchA: {
      seed: { dependencies: { abbrev: '^3.0.0', 'fast-copy': '3.1.0', 'fast-redact': '3.4.0', ini: '^5.0.0' } },
      dependencies: { abbrev: '^3.0.0', 'fast-copy': '^3.0.0', 'fast-redact': '^3.4.0', ini: '^5.0.0' },
    },
    branchB: {
      seed: { dependencies: { abbrev: '^3.0.0', 'fast-copy': '3.0.0', 'fast-redact': '3.5.0', ini: '^5.0.0' } },
      dependencies: { abbrev: '^3.0.0', 'fast-copy': '^3.0.0', 'fast-redact': '^3.4.0', ini: '^5.0.0' },
    },
    merged: {
      seed: { dependencies: { abbrev: '^3.0.0', 'fast-copy': '3.1.0', 'fast-redact': '3.5.0', ini: '^5.0.0' } },
      dependencies: { abbrev: '^3.0.0', 'fast-copy': '^3.0.0', 'fast-redact': '^3.4.0', ini: '^5.0.0' },
    },
  },
  {
    id: 'S18_bump_pkg_and_add_pkg_after_it',
    description: 'Branch A bumps fast-copy 3.0.0->3.1.0 in ws/a; Branch B adds fast-redact 3.5.0 right after fast-copy in ws/b',
    base: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.0.0' } },
        b: { dependencies: { ini: '5.0.0' } },
      },
    },
    branchA: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0' } },
        b: { dependencies: { ini: '5.0.0' } },
      },
    },
    branchB: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.0.0' } },
        b: { dependencies: { 'fast-redact': '3.5.0', ini: '5.0.0' } },
      },
    },
    merged: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0' } },
        b: { dependencies: { 'fast-redact': '3.5.0', ini: '5.0.0' } },
      },
    },
  },
  {
    id: 'S19_add_pkg_before_and_bump_pkg_after_across_ws',
    description: 'Branch A adds fast-copy 3.1.0 in ws/a; Branch B bumps fast-redact 3.4.0->3.5.0 in ws/b',
    base: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1' } },
        b: { dependencies: { 'fast-redact': '3.4.0', ini: '5.0.0' } },
      },
    },
    branchA: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0' } },
        b: { dependencies: { 'fast-redact': '3.4.0', ini: '5.0.0' } },
      },
    },
    branchB: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1' } },
        b: { dependencies: { 'fast-redact': '3.5.0', ini: '5.0.0' } },
      },
    },
    merged: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0' } },
        b: { dependencies: { 'fast-redact': '3.5.0', ini: '5.0.0' } },
      },
    },
  },
  {
    id: 'S20_remove_two_adjacent_pkgs_across_ws',
    description: 'Branch A removes fast-copy from ws/a; Branch B removes fast-redact from ws/b',
    base: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0' } },
        b: { dependencies: { 'fast-redact': '3.5.0', ini: '5.0.0' } },
      },
    },
    branchA: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1' } },
        b: { dependencies: { 'fast-redact': '3.5.0', ini: '5.0.0' } },
      },
    },
    branchB: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0' } },
        b: { dependencies: { ini: '5.0.0' } },
      },
    },
    merged: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1' } },
        b: { dependencies: { ini: '5.0.0' } },
      },
    },
  },
  {
    id: 'S21_bump_two_adjacent_pkgs_across_ws',
    description: 'Branch A bumps fast-copy 3.0.0->3.1.0 in ws/a; Branch B bumps fast-redact 3.4.0->3.5.0 in ws/b',
    base: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.0.0' } },
        b: { dependencies: { 'fast-redact': '3.4.0', ini: '5.0.0' } },
      },
    },
    branchA: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0' } },
        b: { dependencies: { 'fast-redact': '3.4.0', ini: '5.0.0' } },
      },
    },
    branchB: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.0.0' } },
        b: { dependencies: { 'fast-redact': '3.5.0', ini: '5.0.0' } },
      },
    },
    merged: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1', 'fast-copy': '3.1.0' } },
        b: { dependencies: { 'fast-redact': '3.5.0', ini: '5.0.0' } },
      },
    },
  },
  {
    id: 'S22_bump_two_adjacent_transitive_deps',
    description: 'readable-stream@4.8.0 has adjacent dependencies buffer & events; Branch A updates buffer 6.0.2->6.0.3, Branch B updates events 3.2.0->3.3.0',
    base: {
      seed: { dependencies: { buffer: '6.0.2', events: '3.2.0', 'readable-stream': '4.8.0' } },
      dependencies: { 'readable-stream': '4.8.0' },
    },
    branchA: {
      seed: { dependencies: { buffer: '6.0.3', events: '3.2.0', 'readable-stream': '4.8.0' } },
      dependencies: { 'readable-stream': '4.8.0' },
    },
    branchB: {
      seed: { dependencies: { buffer: '6.0.2', events: '3.3.0', 'readable-stream': '4.8.0' } },
      dependencies: { 'readable-stream': '4.8.0' },
    },
    merged: {
      seed: { dependencies: { buffer: '6.0.3', events: '3.3.0', 'readable-stream': '4.8.0' } },
      dependencies: { 'readable-stream': '4.8.0' },
    },
  },
  {
    id: 'S23_bump_two_non_adjacent_transitive_deps',
    description: 'readable-stream@4.8.0 has non-adjacent dependencies buffer & string_decoder; Branch A updates buffer 6.0.2->6.0.3, Branch B updates string_decoder 1.2.0->1.3.0',
    base: {
      seed: { dependencies: { buffer: '6.0.2', 'readable-stream': '4.8.0', string_decoder: '1.2.0' } },
      dependencies: { 'readable-stream': '4.8.0' },
    },
    branchA: {
      seed: { dependencies: { buffer: '6.0.3', 'readable-stream': '4.8.0', string_decoder: '1.2.0' } },
      dependencies: { 'readable-stream': '4.8.0' },
    },
    branchB: {
      seed: { dependencies: { buffer: '6.0.2', 'readable-stream': '4.8.0', string_decoder: '1.3.0' } },
      dependencies: { 'readable-stream': '4.8.0' },
    },
    merged: {
      seed: { dependencies: { buffer: '6.0.3', 'readable-stream': '4.8.0', string_decoder: '1.3.0' } },
      dependencies: { 'readable-stream': '4.8.0' },
    },
  },
  {
    id: 'S24_optional_peer_bound_vs_consumer_added',
    description: 'debug@4.4.3 has optional peer supports-color; Branch A adds supports-color@8.1.1 in ws/a; Branch B adds debug@4.4.3 in ws/b',
    base: {
      workspaces: {
        a: { dependencies: { debug: '4.4.3', ini: '5.0.0' } },
        b: { dependencies: { abbrev: '3.0.1' } },
      },
    },
    branchA: {
      workspaces: {
        a: { dependencies: { debug: '4.4.3', ini: '5.0.0', 'supports-color': '8.1.1' } },
        b: { dependencies: { abbrev: '3.0.1' } },
      },
    },
    branchB: {
      workspaces: {
        a: { dependencies: { debug: '4.4.3', ini: '5.0.0' } },
        b: { dependencies: { abbrev: '3.0.1', debug: '4.4.3' } },
      },
    },
    merged: {
      workspaces: {
        a: { dependencies: { debug: '4.4.3', ini: '5.0.0', 'supports-color': '8.1.1' } },
        b: { dependencies: { abbrev: '3.0.1', debug: '4.4.3' } },
      },
    },
  },
  {
    id: 'S25_add_new_workspace_project_vs_bump_in_another',
    description: 'Branch A adds a new workspace project packages/b; Branch B bumps a dependency in packages/c',
    base: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1' } },
        c: { dependencies: { 'fast-redact': '3.4.0' } },
      },
    },
    branchA: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1' } },
        b: { dependencies: { ini: '5.0.0' } },
        c: { dependencies: { 'fast-redact': '3.4.0' } },
      },
    },
    branchB: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1' } },
        c: { dependencies: { 'fast-redact': '3.5.0' } },
      },
    },
    merged: {
      workspaces: {
        a: { dependencies: { abbrev: '3.0.1' } },
        b: { dependencies: { ini: '5.0.0' } },
        c: { dependencies: { 'fast-redact': '3.5.0' } },
      },
    },
  },
]
