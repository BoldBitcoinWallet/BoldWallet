# DKLs23 scripts testing

Deterministic validation for the libtss (DKLs23) MPC backend, mirroring [../scripts/TESTING.md](../scripts/TESTING.md).

## CLI settlement status (parity with GG18 `scripts/`)

| Capability | GG18 | DKLS | In `dkls-test-all.sh` |
|------------|------|------|------------------------|
| In-process keygen | via `keygen.sh` + relay | `local-keygen`, `local-keygen-3` | yes |
| LAN keygen (duo/trio) | `keygen.sh` | `dkls-lan-keygen.sh` | yes (e2e) |
| LAN keysign | `keysign.sh` | `dkls-lan-keysign.sh` | yes (e2e) |
| Nostr keygen duo/trio | `nostr-keygen*.sh` | `dkls-nostr-keygen*.sh` | syntax only (needs relays) |
| Nostr keysign | `nostr-keysign.sh` | `dkls-nostr-keysign.sh` | syntax only |
| Keyshare validation / recovery check | `validate-ks` | `validate-ks` | yes |
| MPC spend (PSBT) | `spend-bitcoin.sh` | not yet (app/RN path) | — |
| Full GG18-style `test-all.sh` e2e | `test-all.sh` | `dkls-test-all.sh` | yes |

**Recovery** here means: exported DKLS keyshare JSON validates (`validate-ks`) and can be re-imported by the app (same schema as mobile backup).

## Quick run (default pre-mobile gate, ~35s)

```bash
cd BBMTLib
export CGO_ENABLED=1
export CGO_LDFLAGS="-L$(cd ../libtss && pwd)/target/release -llibtss_ffi -lm -framework Security -framework CoreFoundation"
./scripts-dkls/dkls-test-all.sh
```

Requires `../../libtss/target/release/liblibtss_ffi.a` (the script builds via Cargo if missing).

## GG18 parity

| GG18 (`scripts/`) | DKLS (`scripts-dkls/`) |
|-------------------|------------------------|
| `keygen.sh` | `dkls-lan-keygen.sh` (`PARTY_COUNT=2` or `3`) |
| `keysign.sh` | `dkls-lan-keysign.sh` |
| `nostr-keygen.sh` | `dkls-nostr-keygen.sh` |
| `nostr-keygen-3party.sh` | `dkls-nostr-keygen-trio.sh` |
| `nostr-keysign.sh` | `dkls-nostr-keysign.sh` |
| `test-all.sh` | `dkls-test-all.sh` (Go unit matrix + optional LAN) |

## Scripts

| Script / CLI | Purpose |
|--------------|---------|
| `main.go` | `hello-dkg`, `local-keygen`, `local-keygen-3`, `validate-ks`, `relay`, `lan-keygen`, `lan-keysign`, `nostr-keygen`, `nostr-keysign` |
| `dkls-local-keygen.sh` | In-process 2-of-2 DKG |
| `dkls-lan-keygen.sh` | LAN HTTP relay keygen (duo/trio) |
| `dkls-lan-keysign.sh` | LAN keysign (needs `dkls-lan-keygen.sh` output) |
| `dkls-nostr-keygen.sh` | Two-party Nostr DKG |
| `dkls-nostr-keygen-trio.sh` | Three-party Nostr DKG |
| `dkls-nostr-test-all.sh` | Go duo/trio tests + shell e2e (needs local relay) |
| `dkls-nostr-keysign.sh` | Nostr keysign wrapper |
| `dkls-local-keygen-trio.sh` | In-process 2-of-3 DKG |
| `dkls-test-all.sh` | Full local test matrix + LAN duo e2e |

## Optional gates

```bash
# Extra LAN Go integration tests (~30s)
RUN_DKLS_LAN_INTEGRATION=1 ./scripts-dkls/dkls-test-all.sh

# Trio LAN stress
RUN_DKLS_TRIO_STRESS=1 ./scripts-dkls/dkls-test-all.sh
```

LAN duo shell e2e (keygen + keysign + matching sigs) runs in the **default** `dkls-test-all.sh` gate.

## Nostr keygen (local relay)

The relay container listens on **0.0.0.0:7777**; Nostr clients (Go tests, shell e2e, app) must use **`ws://127.0.0.1:7777`** on the same host (scripts pick this automatically when `RELAYS` is unset).

```bash
cd BBMTLib
./scripts/start-local-relay.sh
./scripts-dkls/dkls-nostr-test-all.sh
# or: DKLS_NOSTR_START_RELAY=1 ./scripts-dkls/dkls-nostr-test-all.sh
```

One build of `dkls-scripts`, one `go test` (`TestNostrJoinKeygenDuo` + `TestNostrJoinKeygenTrio`), then duo and trio shell e2e — same `dkls.NostrJoinKeygen` path as mobile after `./build-all.sh`. Set `DKLS_NOSTR_VERBOSE=1` for full logs.

Three physical devices against a dev-machine relay: set app relays to `ws://<your-lan-ip>:7777` (not `0.0.0.0`).

## Keyshare format

DKLs23 keyshares include `tss_backend: "dkls23"`, `suite: 6`, and `share_b64` (libtss export). They are **not** compatible with BNB GG18 keyshares.

## Environment

| Variable | Default | Use |
|----------|---------|-----|
| `DKLS_TEST_DKG_SEC` | `90` in Go LAN tests | Short DKG deadline for integration tests |
| `DKLS_LAN_PUMP_MS` | `100` in LAN tests | Relay poll interval |
| `RUN_DKLS_LAN_INTEGRATION` | off | Enable LAN `go test` in `dkls-test-all.sh` |
| `RUN_DKLS_SCRIPT_E2E` | off | Run `dkls-lan-keygen.sh` / `dkls-lan-keysign.sh` |
| `PARTY_COUNT` | `2` | `dkls-lan-keygen.sh` duo vs trio |
