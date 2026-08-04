# RNG audit — Coldcard-class risk (internal)

**Date:** August 2026  
**Scope:** BBMTLib GG18 (`BoldBitcoinWallet/tss-lib` v3) and DKLs23 (`libtss` / NDKLs23)  
**Audience:** Engineering / security

## Verdict

**No Coldcard-class weak RNG or weak seed in production TSS paths.**

Coldcard (July 2026) used a non-cryptographic Yasmarang software PRNG seeded from MCU UID + timers after a firmware macro bug bypassed the hardware TRNG. That failure mode does **not** apply here.

| Component | Production RNG | Same class as Coldcard? |
|-----------|----------------|-------------------------|
| GG18 / tss-lib v3 | Go `crypto/rand.Reader` | No |
| DKLs23 / NDKLs23 | Rust `ThreadRng` via `getrandom` | No |
| libtss FROST | `rand_core::OsRng` | No |
| BBMTLib `SecureRandom` / AES IVs | Go `crypto/rand` | No |

`session_id` / app session strings are **protocol binders**, not the entropy source for DKG secret polynomials or signing nonces.

DKLs23 `insecure-rng` is test-only (`cfg(all(test, feature = "insecure-rng"))`) and is not enabled in release builds.

## App-layer follow-ups (shipped with this audit)

These are **not** fund-theft paths (MPC shares remain OS-random):

1. Nostr keygen partial nonce now uses `crypto.getRandomValues` via `generateSecureHex64()` (was `Date.now()` + `Math.random()`).
2. `generateMpcAttemptId` now emits full 256-bit hex (was 128-bit with duplicated halves).
3. Native keygen rejects empty / all-zero / invalid chain codes.

## Public messaging

User-facing note: [docs/SECURITY-NOTE-COLDCARD-2026.md](../../docs/SECURITY-NOTE-COLDCARD-2026.md). Do not disclose the historical Math.random detail in public posts.

## References

- Block: https://engineering.block.xyz/blog/predictable-rng-fallback-and-32-bit-reseed-in-coldcard-firmware
- BBMTLib `SecureRandom`: `tss/common.go`
- tss-lib params default to `rand.Reader`: fork `tss/params.go` `NewParameters`
- NDKLs23 `get_rng()`: `dkls23-core/src/utilities/rng.rs`
