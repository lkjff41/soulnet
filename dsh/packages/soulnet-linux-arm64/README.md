# soulnet-peer-linux-arm64

The [soulnet](https://github.com/startupworld-ai/soulnet) light peer binary for Linux arm64 (`bin/soulnet`), built with `go build -trimpath -ldflags "-s -w"` from `cmd/soulnet` of the same version.

You do not install this package by hand: it is an **optional dependency** of [`soulnet-dsh`](https://www.npmjs.com/package/soulnet-dsh) (the SoulMirror plugin for DeepSeek Harness), and npm / pnpm pick the one matching your `os` / `cpu`. The plugin resolves `bin/soulnet` from here at start-up.

The binary is git-ignored in the repository; `dsh/scripts/build-peer-packages.mjs` cross-compiles it into this directory and the release workflow publishes it.

License: MIT.
