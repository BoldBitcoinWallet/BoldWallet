# GG18 + DKLs23 coexistence

Bold Wallet v4+ supports two MPC stacks for **new** wallets. Existing wallets keep the stack stamped in their keyshare.

## User setup flow

1. **MPC Signing Stack** — choose DKLs23 (default) or GG18. All devices in a new setup must pick the same stack.
2. **Choose Your Setup** — duo (2-of-2) or trio (2-of-3).
3. **Transport** — local LAN or Nostr.
4. Pairing, prepare, keygen, backup.

Restore/import skips step 1; backend is inferred from the keyshare file.

## Routing

| Phase | Resolver | Notes |
|-------|----------|--------|
| New keygen | `resolveTssBackendForKeygen()` → `getKeygenTssBackendPreference()` | `dkls23_opted_out` in app config |
| Send / PSBT / sign | `resolveTssBackend()` | From `keyshare_meta` + full keyshare shape |
| Native MPC calls | `TssProvider` only | GG18: `mpc*` / `nostr*`; DKLs: `dkls*` |
| Per-input keysign (Go) | `IsDKLsKeyshareJSON` in `BBMTLib/tss/keysign_dispatch.go` | Matches TS `detectKeyshareTssBackend` |

## Backward compatibility

Detection order (canonical in `services/tssBackend.ts`):

1. `tss_backend === 'dkls23'` or `'gg18'`
2. `ecdsa_local_data` present → **gg18**
3. `share_b64` present → **dkls23**
4. default → **gg18**

Metadata is normalized on save/import via `saveKeyshareMetadata` in `utils.js`.

## Android native split

- GG18: `android/app/libs/tss.aar` (gomobile) — unchanged; not used for DKLs keyshares.
- DKLs: `libbbmtmobile.so` + `dkls_jni` (same `bbmtmobile` package as iOS; JNI exposes `Dkls*` only).

Rebuild: `cd BBMTLib && ./build-all.sh` (or `./build.sh --with-dkls`).

## Progress UX

Hook percent uses `resolveHookProgressBackend()`:

- **Keygen**: preference or resolved `keygenBackend`
- **Send / PSBT**: waits until `spendBackend` is loaded from keyshare (no `dkls23` fallback)

Progress mapping (`services/mpcProgress.ts`):

- **GG18**: linear `step / denominator` (variable native steps; denominators 18/29 keygen, 36 keysign per input).
- **DKLs23**: phase-based mapping aligned to native steps `0 → 1–2 setup → 3..N rounds → 99 done` (`dklsKeygenPercent`, `dklsKeysignPercent`) so the bar does not stall then jump.
- Spend/sign hooks use `resolveTssBackendFromCachedMeta()` when `spendBackend` is not loaded yet (correct denominator immediately).

## LAN transport encryption

DKLs23 LAN MPC uses the same relay crypto as GG18 (`BBMTLib/tss` `MessengerImp`):

| Setup | Key material | Wire encryption |
|-------|----------------|-----------------|
| Duo LAN | `encKey` = peer secp256k1 pubkey, `decKey` = local private key | ECIES per message |
| Trio LAN | shared `sessionKey` (AES, derived like GG18) | AES per message |

`JoinKeygen` / `JoinKeysignWithSighash` call `ConfigureLANTransportKeys` before the HTTP relay pump; receive path uses `DecryptLANRelayPayload` (AES or ECIES). Nostr DKLs uses NIP-44 via `nostrtransport` (unchanged).

Mobile: `TssProvider.mpcTssSetup` passes `encKey` / `decKey` into `dklsMpcTssSetup` for DKLs keygen; send/PSBT already passed them for keysign.

## Known constraints

- Mixed-backend committees are not supported for keygen.
- GG18 prepare (`preparams`) can take minutes; DKLs uses a short `helloDkg` check.
- Descriptor paths: GG18 legacy wallets may use BIP44-style paths by `created_at`; DKLs uses standard BIP84/49 per address type.
