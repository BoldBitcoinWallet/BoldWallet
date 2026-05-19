# DKLs23 scripts testing

Deterministic validation for the libtss (DKLs23) MPC backend, mirroring [../scripts/TESTING.md](../scripts/TESTING.md).

## Quick run

```bash
cd BBMTLib
./scripts-dkls/dkls-test-all.sh
```

Requires a built `../../libtss/target/release/liblibtss_ffi.a` (the script builds via Cargo if missing).

## Scripts

| Script | Purpose |
|--------|---------|
| `main.go` | CLI: `hello-dkg`, `local-keygen`, `validate-ks`, `nostr-keygen` |
| `dkls-local-keygen.sh` | In-process 2-of-2 DKG |
| `dkls-nostr-keygen.sh` | Two-party Nostr DKG |
| `dkls-test-all.sh` | Full local test matrix |

## Keyshare format

DKLs23 keyshares include `tss_backend: "dkls23"`, `suite: 6`, and `share_b64` (libtss export). They are **not** compatible with BNB GG18 keyshares.
