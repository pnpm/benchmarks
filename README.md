# Benchmarks of JavaScript Package Managers

The current numbers are in [benchmarks.md](./benchmarks.md).

## Usage

```
pnpm install
pnpm run benchmark
```

A run measures every package manager, appends the timings to `results/<manager>/<version>/<fixture>.yaml`, and rewrites what it publishes from them: `benchmarks.md` and the charts it refers to, in `img/benchmarks/`. The charts sit at the path the markdown points at (`/img/benchmarks/...`), so a site serving these files can take both across unchanged.

`pnpm run regenerate-svgs` redraws the charts from the recorded YAML without measuring anything.

npm, pnpm, and Bun are installed from the registry by the benchmark itself. Yarn is not on the registry anymore — Yarn 6 ships as a platform binary — so it is downloaded from its release channel instead, which needs `unzip` on `PATH`.

## The registry the install benchmark runs against

Every package manager installs through a [pnpr](https://pnpm.io/pnpr) registry of the benchmark's own rather than npmjs, and pnpm 12 is measured a second time with dependency resolution offloaded to that server. `benchmarkRegistry.js` brings all of that up. pnpr is installed from the registry by the benchmark, like the package managers are, and needs no setup.

Four things about it are worth knowing before changing it.

The registry is reached across an emulated network. A registry on the benchmark machine hides what resolving a dependency graph costs — round trips — which is exactly what the `pnpm + pnpr` column exists to measure.

The server itself resolves on loopback. pnpr resolves against the registry URL the client sends, and the client's configured registry sits behind the emulated link — so left alone, the server would fetch every packument by crossing that link back into its own public endpoint, paying per graph level the very round trips server-side resolution exists to remove. The accelerated scenario therefore tells the client (through the `PACQUET_BENCHMARK_*` env hooks pnpm carries for the pnpm monorepo's `integrated-benchmark` task, which models the same thing) to have the server resolve against its own un-proxied address, declared as a route in the server's config. That is the production shape — a resolver co-located with its registry — while tarballs still cross the emulated link like every other scenario's.

The numbers are recorded under their own fixture name (`alotta-files-pnpr`), and the runs recorded before the benchmark installed through pnpr are left where they are under `alotta-files`. They were measured against a different registry over a different network, so pooling the two would average unrelated things together. The same rule holds within the name: change the setup in a way that changes what a number means, and the runs recorded before the change have to be deleted, or `min()` pools them with the new ones and a number from the old setup stands in for the new one.

The network is emulated by `latencyProxy.js`, which every client's traffic passes through — including pnpm's resolution requests, at the same round trip, so no client gets a cheaper link than another. It runs as a process of its own because installs are measured with a synchronous spawn: a proxy inside the benchmark process would accept no connection until the install it is serving had already finished. The same reasoning applies to output — pnpr and the proxy write to files rather than pipes, because nothing drains a pipe while a measured install holds the event loop, and a full pipe buffer would stop the server answering mid-scenario.

## Node.js version management

The Node.js version management section compares pnpm with fnm and nvm. nvm is cloned by the benchmark itself, but `fnm` has to be on `PATH`:

```
curl -fsSL https://fnm.vercel.app/install | bash
```

That section times commands inside the shell with `$EPOCHREALTIME`, so it needs Bash 5 or newer on `PATH` and refuses to measure without it. macOS still ships Bash 3.2 as `/bin/bash`:

```
brew install bash
```
