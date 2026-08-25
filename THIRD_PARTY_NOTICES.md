# Third-party notices and acknowledgements

soulnet is released under the MIT License (see `LICENSE`). This file lists
third-party software it depends on and prior work it acknowledges.

## Dependencies (Go)

| Module | License | Notes |
|---|---|---|
| `gopkg.in/yaml.v3` | Apache-2.0 (parts of the original C libyaml port are MIT) | YAML parsing for `friends.yaml` and relay config |

Everything else in the Go packages is the Go standard library.

## Dependencies (dsh plugin, `dsh/`)

See `dsh/packages/dsh/package.json`. Runtime dependencies are limited to the
DeepSeek Harness plugin contracts (`@deepseek-ai/*`, MIT, type-only or
baseline-provided at runtime) and React (MIT) provided by the host page.

## Acknowledgements (no code or text reused)

- **Agent Network Protocol (ANP)** — https://github.com/agent-network-protocol
  (specification and reference SDK: Apache-2.0). The transport architecture of
  the SoulMirror A2A layer — key-pair identity, end-to-end encryption, and a
  dumb message relay that only forwards ciphertext — is *inspired by* ANP's
  design. soulnet contains **no ANP code and no ANP specification text**, and
  its wire format is **not** ANP-compatible (different curves, identity model,
  authentication headers and framing; see `spec/a2a-wire-spec.md`). "ANP" and
  "Agent Network Protocol" are names of their respective authors; soulnet does
  not claim conformance with or endorsement by ANP.
- **DeepSeek Harness (dsh)** — https://github.com/deepseek-ai/deepseek-harness
  (MIT). The `dsh/` plugin targets its public plugin contracts; its client bundle
  replicates dsh's out-of-repo bundle conventions as documented in dsh's
  cookbooks.

If an ANP interoperability adapter is ever added that reuses ANP SDK code, those
files must keep their Apache-2.0 headers, and the ANP `LICENSE`/`NOTICE` must be
shipped alongside and listed here.
