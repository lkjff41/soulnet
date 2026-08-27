# payment/ — SoulMirror payment gateway (paygate)

A local USDC payment gateway built on Coinbase CDP v2: a **standalone local process**
installed alongside the SoulMirror plugin, listening on `127.0.0.1:9001` (loopback only),
providing wallet creation, USDC transfers and on-chain payment verification for A2A.

Architecture and decisions live in [`docs/cdp-a2a-payment-plan.md`](../docs/cdp-a2a-payment-plan.md) (§5 gateway design).

## Why a local process

- **Everyone runs their own gateway with their own CDP**: no public server, no platform
  hosting; CDP secrets are configured per user and live only in the local keychain /
  environment — **real secrets never enter the repository** (only the `.env.example`
  placeholders do).
- **Interop happens on-chain, not through CDP**: settlement is USDC on Base; any address
  can transfer to any address directly.
- Three capability tiers: ① no CDP (receive / pay manually / verify); ② local CDP (the
  alter pays automatically, full functionality); ③ a future public gateway (same code,
  different `gateway_url` config).

## Build

The repo go.mod requires Go ≥ 1.25 (a system Go 1.19 cannot compile; use `_tools/go` at
the repo root).

```sh
go build -o bin/paygate ./payment/cmd/paygate
```

## Run (development; starts fine without secrets)

```sh
# Minimal start: manual-address tier only (no CDP), join.verify / balance available
PAYGATE_HOME=$HOME/.soulmirror/a2a/pay ./bin/paygate
```

Enable the full CDP tier (environment variables, or enter them in the settings page):

```sh
export CDP_API_KEY_ID=...
export CDP_API_KEY_SECRET=...     # base64 Ed25519 (64B) or PEM EC P-256
export CDP_WALLET_SECRET=...      # base64 DER EC P-256 PKCS8
export CDP_NETWORK=base-sepolia   # or base
./bin/paygate
```

## API

Every request must carry the A2A request signature (`X-A2A-Pub` / `X-A2A-Timestamp` /
`X-A2A-Signature`, same format as the relay's `VerifyRequest`, using `a2a.SignReq`).

| Endpoint | Description | Needs CDP |
|---|---|---|
| `POST /v2/pay/wallet.create` | get-or-create the alter's wallet (CDP EVM account, named by fingerprint) | ✅ |
| `GET /v2/pay/wallet` | USDC/ETH balances (CDP or public RPC) | receiving address only |
| `POST /v2/pay/transfer` | send USDC from the alter's wallet (build EIP-1559 tx → CDP signs and broadcasts) | ✅ |
| `POST /v2/pay/join.verify` | verify a paid group-join transfer on-chain (public Base RPC parses Transfer logs); enforces tx sender == the applicant's declared payer and validates the wallet-secret receipt | ❌ |
| `POST /v2/pay/join.receipt` | mint a wallet-secret receipt (ES256 signature over {fp, tx_hash, payer} with the wallet key) proving the applicant controls the paying wallet — replay protection for paid joins | ✅ |
| `POST/GET /v2/pay/config` | tiered mode configuration (secrets never pass through here) | — |
| `GET /v2/pay/health` | health check | — |

## Tests

```sh
# Unit tests (RLP vectors / JWT structure / keccak256 vectors / on-chain log parsing /
# amount conversion / receipt verification) — run offline
go test ./payment/...

# End-to-end (real Base Sepolia RPC + real transfer sample)
PAYGATE_LIVE=1 go test ./payment/internal/payapi -run TestLiveJoinVerify -v
```

## Layout

```
payment/
├── cmd/paygate/          entrypoint (config loading, HTTP server, graceful shutdown)
├── internal/cdp/         CDP v2 REST client: platform JWT / X-Wallet-Auth JWT,
│                         create account, token-balances, send/transaction,
│                         EIP-1559 RLP (USDC ERC-20 transfer), keccak256/address
│                         derivation, wallet-secret signing (receipts)
├── internal/rpcclient/   public Base RPC: tx receipts (incl. from), Transfer log
│                         parsing, balances, gas
├── internal/payapi/      /v2/pay/* HTTP layer + A2A signature middleware + receipt verify
├── internal/store/       wallets.json / transfers.jsonl / config.json
├── internal/config/      environment loading
└── .env.example          secret placeholders (never fill in real values)
```
