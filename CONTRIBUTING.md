# Contributing

- **English only inside the codebase**: identifiers, comments, log lines, commit messages and docs are written in English. `README.md` is English; translations live beside it as `README.<lang>.md` (e.g. `README.zh.md`). The same applies to `spec/` (`*.md` English, `*.zh.md` translations).
- Protocol changes: update `spec/a2a-wire-spec.md` **and** test vectors **and** code in the same PR. The spec is the source of truth for every client implementation.
- Gate: `gofmt -l . && go vet ./... && go test ./...` must be clean.
- Keep the module dependency-light (stdlib + `gopkg.in/yaml.v3`); do not add dependencies for convenience.
- Commit messages: **English only**, `type(scope): summary` (e.g. `feat(relay): …`, `fix(a2a): …`).
- dsh plugin (`dsh/`): pnpm workspace; see `dsh/README.md`.
- Local guard: run `git config core.hooksPath .githooks` once after cloning; the `commit-msg` hook rejects messages containing CJK characters.
