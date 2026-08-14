# Benchmarks of JavaScript Package Managers

**Last benchmarked at**: _Aug 14, 2026, 8:47 AM_ (_daily_ updated).

This benchmark compares the performance of npm, pnpm, Yarn, Yarn PnP, and Bun (check [Yarn's benchmarks](https://yarnpkg.com/benchmarks) for any other Yarn modes that are not included here). Every package manager installs through the same [pnpr](https://pnpm.io/pnpr) registry (v0.1.0-alpha.6) across an emulated 50ms round trip at 200 Mbit/s, so they all face one registry over one reproducible network instead of whatever link the benchmark machine happens to have. pnpm is measured twice: once on its own, and once resolving its dependency graph [on the server](https://pnpm.io/pnpr/install-acceleration) instead of walking it itself. The page also compares how fast pnpm, fnm, and nvm install and switch Node.js versions.

About the setup:

- **Every manager crosses the same link.** The round trip is applied to all of them, and to pnpm's resolution requests as well, so no client gets a cheaper connection than another.
- **pnpr's cache is warmed before anything is timed**, so no manager pays to pull the fixture into the registry on behalf of the ones measured after it.
- **Server-side resolution pays off when there is a graph to resolve.** Resolving one means walking it level by level, and each level costs a round trip, so the cost is roughly the depth of the graph times the latency. pnpr does that walk next to the registry and answers with the whole resolved lockfile at once, which is why the rows without a lockfile — and the row that changes dependencies — are the ones where it pulls ahead of plain pnpm.
- **It costs a round trip when there is not.** pnpm asks the server on every install, including the ones where the lockfile is already up to date and there is nothing to work out. The server answers a question it has been asked before from its cache, in a few milliseconds — what the client pays for is the round trip and having the resolved lockfile streamed back, which plain pnpm never pays because it never asks. That is why the rows with a lockfile come out slightly behind plain pnpm instead of level with it.
- Tarballs are still fetched by the client, in parallel and directly, on every row.

Each row's label lists which of `cache`, `lockfile`, and `node_modules` are warm/present before install runs. Quick mapping to the real world (ordered from slowest to fastest scenario):

- `clean`: a brand-new clone — nothing cached, no lockfile, no `node_modules`.
- `cache`: a developer reinstalling without a lockfile.
- `lockfile`: a CI server doing its first install.
- `cache+lockfile`: a developer reinstalling a known project.
- `cache+node_modules`: the lockfile is deleted and install is run again.
- `node_modules`: the cache and lockfile are deleted and install is run again.
- `cache+lockfile+node_modules`: re-running install when nothing has changed.
- `lockfile+node_modules`: the cache is deleted and install is run again.
- `update`: dependency versions are bumped in `package.json` and install is run again.

## Lots of Files

The app's `package.json` [here](https://github.com/pnpm/benchmarks/blob/main/fixtures/alotta-files/package.json)

| action  | cache | lockfile | node_modules| npm | pnpm | [pnpm 🦀](https://github.com/pnpm/pacquet) | [pnpm + pnpr](https://pnpm.io/pnpr/install-acceleration) | Yarn | Yarn PnP | Bun |
| ---     | ---   | ---      | ---         | --- | --- | --- | --- | --- | --- | --- |
| install |   |   |   | 58.4s | 8s | 2s | 5s | 7s | 3.6s | 4.1s |
| install | ✔ |   |   | 55.4s | 4.6s | 1.2s | 2.7s | 5.5s | 3.6s | 767ms |
| install |   | ✔ |   | 13.4s | 7s | 2.2s | 5.2s | 4.4s | 1.1s | 1.7s |
| install | ✔ | ✔ |   | 10.4s | 2.4s | 711ms | 2.7s | 2s | 142ms | 743ms |
| install | ✔ |   | ✔ | 1.9s | 580ms | 58ms | 602ms | 3.7s | n/a | 1.9s |
| install |   |   | ✔ | 1.9s | 594ms | 65ms | 604ms | 7.4s | n/a | 3.4s |
| install | ✔ | ✔ | ✔ | 1.4s | 517ms | 18ms | 456ms | 1.3s | n/a | 45ms |
| install |   | ✔ | ✔ | 1.4s | 533ms | 73ms | 1.7s | 4.9s | n/a | 46ms |
| update | n/a | n/a | n/a | 10s | 8.3s | 1.2s | 2.9s | 2.6s | 2.5s | 584ms |

<img alt="Graph of the alotta-files results" src="/img/benchmarks/alotta-files.svg?v=ff1f5301" />

### pnpm vs pnpm 🦀

pnpm v12 will use a new installation engine for fetching and linking written in Rust. See [pacquet](https://github.com/pnpm/pacquet).

| action  | cache | lockfile | node_modules| pnpm | [pnpm 🦀](https://github.com/pnpm/pacquet) |
| ---     | ---   | ---      | ---         | --- | --- |
| install |   |   |   | 8s | 2s |
| install |   | ✔ |   | 7s | 2.2s |
| install | ✔ |   |   | 4.6s | 1.2s |
| install | ✔ | ✔ |   | 2.4s | 711ms |
| install |   |   | ✔ | 594ms | 65ms |
| install | ✔ |   | ✔ | 580ms | 58ms |
| install |   | ✔ | ✔ | 533ms | 73ms |
| install | ✔ | ✔ | ✔ | 517ms | 18ms |
| update | n/a | n/a | n/a | 8.3s | 1.2s |

<img alt="Graph comparing pnpm versions on the alotta-files fixture" src="/img/benchmarks/alotta-files-pnpm.svg?v=c8e5f8f8" />

## Node.js Version Management

pnpm installs and switches Node.js versions itself, so a separate version manager is not needed. This section compares [`pnpm runtime set node`](https://pnpm.io/cli/runtime) with fnm and nvm.

| scenario | pnpm 12 | fnm | nvm |
| ---      | --- | --- | --- |
| install Node.js 24 with nothing cached | 1s | 2.3s | 3s |
| install Node.js 24 that was installed before | 189ms | 2.4s | 2.8s |
| run `node` in a project pinned to Node.js 22 | 8ms | 5ms | 93ms |

<img alt="Graph comparing Node.js version managers on installing Node.js" src="/img/benchmarks/node-versions.svg?v=ce61b813" />

A few things to keep in mind when reading these numbers:

- pnpm keeps Node.js in its content-addressable store and nvm keeps the downloaded tarballs in `$NVM_DIR/.cache`, so for both of them installing a version that was installed before needs no download. fnm has no download cache and fetches Node.js again.
- pnpm doesn't extract the `npm`, `npx`, and `corepack` binaries bundled with Node.js, so on a clean install it downloads and writes fewer files than the other two.
- Per-project switching costs no command at all in pnpm: the `node` on your PATH is a shim that reads the [`devEngines.runtime`](https://pnpm.io/package_json#devenginesruntime) of the project and runs the matching version. fnm and nvm read a `.node-version` or `.nvmrc` file through a shell hook that fires on `cd`, which is what `fnm exec` and `nvm use` measure in that row. Loading nvm into the shell in the first place is not counted at all here, and it costs more than everything in that row.
- All three have to materialize the pinned version the first time a project asks for it: pnpm links it from its store, fnm downloads it, nvm unpacks it. The row measures the repeated runs after that.