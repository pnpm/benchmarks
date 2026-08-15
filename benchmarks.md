# Benchmarks of JavaScript Package Managers

**Last benchmarked at**: _Aug 15, 2026, 9:24 PM_ (_daily_ updated).

This benchmark compares the performance of npm, pnpm, Yarn, Yarn PnP, and Bun (check [Yarn's benchmarks](https://yarnpkg.com/benchmarks) for any other Yarn modes that are not included here). Every package manager installs through the same [pnpr](https://pnpm.io/pnpr) registry (v0.1.0-alpha.6) across an emulated 50ms round trip at 200 Mbit/s, so they all face one registry over one reproducible network instead of whatever link the benchmark machine happens to have. pnpm 12 is measured twice: once on its own, and once resolving its dependency graph [on the server](https://pnpm.io/pnpr/install-acceleration) instead of walking it itself. The page also compares how fast pnpm, fnm, and nvm install and switch Node.js versions.

About the setup:

- **Every manager crosses the same link.** The round trip is applied to all of them, and to pnpm's resolution requests as well, so no client gets a cheaper connection than another. The bandwidth cap is the link's, shared across all of a manager's connections — opening more connections in parallel spreads the latency, as on a real network, but cannot multiply the 200 Mbit/s.
- **pnpr's cache is warmed before anything is timed** — with the fixture's dependency graph and with the one the update row installs — so no manager pays to pull either into the registry on behalf of the ones measured after it.
- **Server-side resolution pays off when there is a graph to resolve.** Resolving one means walking it level by level, and each level costs a round trip, so the cost is roughly the depth of the graph times the latency. pnpr does that walk next to the registry — its own metadata access stays on loopback, the co-located shape the [pnpm monorepo's integrated benchmark](https://github.com/pnpm/pnpm) measures — and answers with the whole resolved lockfile at once, which is why the rows without a lockfile, and the row that changes dependencies, are the ones where it pulls ahead of plain pnpm.
- **With an up-to-date lockfile there is nothing to resolve.** pnpm doesn't ask the server then, so those rows measure the same install in both pnpm 12 columns.
- Tarballs are still fetched by the client, in parallel and directly, on every row.

Each row's label lists which of `cache`, `lockfile`, and `node_modules` are warm/present before install runs. Quick mapping to the real world (ordered from slowest to fastest scenario):

- `clean`: a brand-new clone — nothing cached, no lockfile, no `node_modules`.
- `cache`: a developer reinstalling without a lockfile.
- `lockfile`: a CI server doing its first install.
- `cache+lockfile`: a developer reinstalling a known project.
- `node_modules`: the cache and lockfile are deleted and install is run again.
- `cache+node_modules`: the lockfile is deleted and install is run again.
- `lockfile+node_modules`: the cache is deleted and install is run again.
- `cache+lockfile+node_modules`: re-running install when nothing has changed.
- `update`: dependency versions are bumped in `package.json` and install is run again.

## Lots of Files

The app's `package.json` [here](https://github.com/pnpm/benchmarks/blob/main/fixtures/alotta-files/package.json)

| action  | cache | lockfile | node_modules| npm | pnpm | [pnpm 🦀](https://github.com/pnpm/pacquet) | [pnpm + pnpr](https://pnpm.io/pnpr/install-acceleration) | Yarn | Yarn PnP | Bun |
| ---     | ---   | ---      | ---         | --- | --- | --- | --- | --- | --- | --- |
| install |   |   |   | 1m 0.3s | 8.7s | 5.2s | 3.7s | 8.3s | 4.9s | 5s |
| install | ✔ |   |   | 57.1s | 4.9s | 1.1s | 765ms | 5.7s | 3.9s | 794ms |
| install |   | ✔ |   | 14.2s | 7.1s | 4.9s | 3.7s | 6.3s | 3s | 3s |
| install | ✔ | ✔ |   | 10.6s | 2.7s | 680ms | 666ms | 2s | 157ms | 764ms |
| install |   |   | ✔ | 2s | 819ms | 68ms | 74ms | 8.7s | n/a | 4.3s |
| install | ✔ |   | ✔ | 2s | 802ms | 60ms | 66ms | 3.9s | n/a | 2s |
| install |   | ✔ | ✔ | 1.5s | 783ms | 76ms | 83ms | 6.8s | n/a | 47ms |
| install | ✔ | ✔ | ✔ | 1.4s | 629ms | 19ms | 19ms | 1.3s | n/a | 49ms |
| update | n/a | n/a | n/a | 9.9s | 8.6s | 3.5s | 1.1s | 2.9s | 2.7s | 800ms |

<img alt="Graph of the alotta-files results" src="/img/benchmarks/alotta-files.svg?v=6fad0881" />

### pnpm vs pnpm 🦀

pnpm v12 will use a new installation engine for fetching and linking written in Rust. See [pacquet](https://github.com/pnpm/pacquet).

| action  | cache | lockfile | node_modules| pnpm | [pnpm 🦀](https://github.com/pnpm/pacquet) |
| ---     | ---   | ---      | ---         | --- | --- |
| install |   |   |   | 8.7s | 5.2s |
| install |   | ✔ |   | 7.1s | 4.9s |
| install | ✔ |   |   | 4.9s | 1.1s |
| install | ✔ | ✔ |   | 2.7s | 680ms |
| install |   |   | ✔ | 819ms | 68ms |
| install | ✔ |   | ✔ | 802ms | 60ms |
| install |   | ✔ | ✔ | 783ms | 76ms |
| install | ✔ | ✔ | ✔ | 629ms | 19ms |
| update | n/a | n/a | n/a | 8.6s | 3.5s |

<img alt="Graph comparing pnpm versions on the alotta-files fixture" src="/img/benchmarks/alotta-files-pnpm.svg?v=987f2ed6" />

## Node.js Version Management

pnpm installs and switches Node.js versions itself, so a separate version manager is not needed. This section compares [`pnpm runtime set node`](https://pnpm.io/cli/runtime) with fnm and nvm.

| scenario | pnpm 12 | fnm | nvm |
| ---      | --- | --- | --- |
| install Node.js 24 with nothing cached | 1s | 2.3s | 2.4s |
| install Node.js 24 that was installed before | 148ms | 2.4s | 2.2s |
| run `node` in a project pinned to Node.js 22 | 7ms | 4ms | 81ms |

<img alt="Graph comparing Node.js version managers on installing Node.js" src="/img/benchmarks/node-versions.svg?v=7e9ea3e9" />

A few things to keep in mind when reading these numbers:

- pnpm keeps Node.js in its content-addressable store and nvm keeps the downloaded tarballs in `$NVM_DIR/.cache`, so for both of them installing a version that was installed before needs no download. fnm has no download cache and fetches Node.js again.
- pnpm doesn't extract the `npm`, `npx`, and `corepack` binaries bundled with Node.js, so on a clean install it downloads and writes fewer files than the other two.
- Per-project switching costs no command at all in pnpm: the `node` on your PATH is a shim that reads the [`devEngines.runtime`](https://pnpm.io/package_json#devenginesruntime) of the project and runs the matching version. fnm and nvm read a `.node-version` or `.nvmrc` file through a shell hook that fires on `cd`, which is what `fnm exec` and `nvm use` measure in that row. Loading nvm into the shell in the first place is not counted at all here, and it costs more than everything in that row.
- All three have to materialize the pinned version the first time a project asks for it: pnpm links it from its store, fnm downloads it, nvm unpacks it. The row measures the repeated runs after that.