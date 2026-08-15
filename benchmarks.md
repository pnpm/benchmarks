# Benchmarks of JavaScript Package Managers

**Last benchmarked at**: _Aug 15, 2026, 7:42 PM_ (_daily_ updated).

This benchmark compares the performance of npm, pnpm, Yarn, Yarn PnP, and Bun (check [Yarn's benchmarks](https://yarnpkg.com/benchmarks) for any other Yarn modes that are not included here). Every package manager installs through the same [pnpr](https://pnpm.io/pnpr) registry (v0.1.0-alpha.6) across an emulated 50ms round trip at 200 Mbit/s, so they all face one registry over one reproducible network instead of whatever link the benchmark machine happens to have. pnpm 12 is measured twice: once on its own, and once resolving its dependency graph [on the server](https://pnpm.io/pnpr/install-acceleration) instead of walking it itself. The page also compares how fast pnpm, fnm, and nvm install and switch Node.js versions.

About the setup:

- **Every manager crosses the same link.** The round trip is applied to all of them, and to pnpm's resolution requests as well, so no client gets a cheaper connection than another.
- **pnpr's cache is warmed before anything is timed** — with the fixture's dependency graph and with the one the update row installs — so no manager pays to pull either into the registry on behalf of the ones measured after it.
- **Server-side resolution pays off when there is a graph to resolve.** Resolving one means walking it level by level, and each level costs a round trip, so the cost is roughly the depth of the graph times the latency. pnpr does that walk next to the registry — its own metadata access stays on loopback, the co-located shape the [pnpm monorepo's integrated benchmark](https://github.com/pnpm/pnpm) measures — and answers with the whole resolved lockfile at once, which is why the rows without a lockfile, and the row that changes dependencies, are the ones where it pulls ahead of plain pnpm.
- **With an up-to-date lockfile there is nothing to resolve.** pnpm doesn't ask the server then, so those rows measure the same install in both pnpm 12 columns.
- Tarballs are still fetched by the client, in parallel and directly, on every row.

Each row's label lists which of `cache`, `lockfile`, and `node_modules` are warm/present before install runs. Quick mapping to the real world (ordered from slowest to fastest scenario):

- `clean`: a brand-new clone — nothing cached, no lockfile, no `node_modules`.
- `cache`: a developer reinstalling without a lockfile.
- `lockfile`: a CI server doing its first install.
- `cache+lockfile`: a developer reinstalling a known project.
- `cache+node_modules`: the lockfile is deleted and install is run again.
- `node_modules`: the cache and lockfile are deleted and install is run again.
- `lockfile+node_modules`: the cache is deleted and install is run again.
- `cache+lockfile+node_modules`: re-running install when nothing has changed.
- `update`: dependency versions are bumped in `package.json` and install is run again.

## Lots of Files

The app's `package.json` [here](https://github.com/pnpm/benchmarks/blob/main/fixtures/alotta-files/package.json)

| action  | cache | lockfile | node_modules| npm | pnpm | [pnpm 🦀](https://github.com/pnpm/pacquet) | [pnpm + pnpr](https://pnpm.io/pnpr/install-acceleration) | Yarn | Yarn PnP | Bun |
| ---     | ---   | ---      | ---         | --- | --- | --- | --- | --- | --- | --- |
| install |   |   |   | 54.4s | 7.2s | 4.4s | 2.7s | 6.1s | 3s | 4.1s |
| install | ✔ |   |   | 51.2s | 4s | 1.1s | 816ms | 4.9s | 3s | 782ms |
| install |   | ✔ |   | 10.6s | 5.8s | 3.8s | 2.2s | 4s | 988ms | 1.7s |
| install | ✔ | ✔ |   | 7.2s | 2.2s | 689ms | 690ms | 1.9s | 127ms | 766ms |
| install | ✔ |   | ✔ | 1.4s | 482ms | 63ms | 66ms | 3.1s | n/a | 1.9s |
| install |   |   | ✔ | 1.4s | 478ms | 70ms | 72ms | 6.5s | n/a | 3.4s |
| install |   | ✔ | ✔ | 1s | 494ms | 79ms | 81ms | 4.4s | n/a | 46ms |
| install | ✔ | ✔ | ✔ | 1s | 363ms | 20ms | 19ms | 1.1s | n/a | 46ms |
| update | n/a | n/a | n/a | 8.6s | 6.7s | 3s | 902ms | 2.4s | 2.1s | 452ms |

<img alt="Graph of the alotta-files results" src="/img/benchmarks/alotta-files.svg?v=6300bbf7" />

### pnpm vs pnpm 🦀

pnpm v12 will use a new installation engine for fetching and linking written in Rust. See [pacquet](https://github.com/pnpm/pacquet).

| action  | cache | lockfile | node_modules| pnpm | [pnpm 🦀](https://github.com/pnpm/pacquet) |
| ---     | ---   | ---      | ---         | --- | --- |
| install |   |   |   | 7.2s | 4.4s |
| install |   | ✔ |   | 5.8s | 3.8s |
| install | ✔ |   |   | 4s | 1.1s |
| install | ✔ | ✔ |   | 2.2s | 689ms |
| install |   | ✔ | ✔ | 494ms | 79ms |
| install | ✔ |   | ✔ | 482ms | 63ms |
| install |   |   | ✔ | 478ms | 70ms |
| install | ✔ | ✔ | ✔ | 363ms | 20ms |
| update | n/a | n/a | n/a | 6.7s | 3s |

<img alt="Graph comparing pnpm versions on the alotta-files fixture" src="/img/benchmarks/alotta-files-pnpm.svg?v=516a3779" />

## Node.js Version Management

pnpm installs and switches Node.js versions itself, so a separate version manager is not needed. This section compares [`pnpm runtime set node`](https://pnpm.io/cli/runtime) with fnm and nvm.

| scenario | pnpm 12 | fnm | nvm |
| ---      | --- | --- | --- |
| install Node.js 24 with nothing cached | 1s | 2.3s | 2.4s |
| install Node.js 24 that was installed before | 154ms | 2.4s | 2.2s |
| run `node` in a project pinned to Node.js 22 | 7ms | 4ms | 81ms |

<img alt="Graph comparing Node.js version managers on installing Node.js" src="/img/benchmarks/node-versions.svg?v=333727fa" />

A few things to keep in mind when reading these numbers:

- pnpm keeps Node.js in its content-addressable store and nvm keeps the downloaded tarballs in `$NVM_DIR/.cache`, so for both of them installing a version that was installed before needs no download. fnm has no download cache and fetches Node.js again.
- pnpm doesn't extract the `npm`, `npx`, and `corepack` binaries bundled with Node.js, so on a clean install it downloads and writes fewer files than the other two.
- Per-project switching costs no command at all in pnpm: the `node` on your PATH is a shim that reads the [`devEngines.runtime`](https://pnpm.io/package_json#devenginesruntime) of the project and runs the matching version. fnm and nvm read a `.node-version` or `.nvmrc` file through a shell hook that fires on `cd`, which is what `fnm exec` and `nvm use` measure in that row. Loading nvm into the shell in the first place is not counted at all here, and it costs more than everything in that row.
- All three have to materialize the pinned version the first time a project asks for it: pnpm links it from its store, fnm downloads it, nvm unpacks it. The row measures the repeated runs after that.