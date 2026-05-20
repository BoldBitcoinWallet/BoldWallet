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

## Android native (single runtime)

- **One Go runtime:** `libbbmtmobile.so` + `dkls_jni` (same `bbmtmobile` package as iOS).
- **GG18** wallet/MPC calls use `Bbmt*` JNI wrappers; **DKLs** uses `Dkls*` JNI.
- **No** `tss.aar` (gomobile) in the app — dual runtime caused heap corruption (`bad sweepgen in refill`).

Rebuild: `cd BBMTLib && ./build-dkls.sh android` (and iOS xcframework as needed).

## Progress UX

Native MPC reports steps via `Hook(SessionState)` JSON (`type`, `step`, `info`, `session`, `done`). React Native listens on `TssHook` events (`BBMT_DROID` / `BBMT_APPLE`).

### Android hook bridge (DKLs)

Both stacks register hooks through `BbmtSetHookListener` / `BbmtSetGoLogListener` (JNI → `BBMTLibNativeModule.deliverMpcHook` / `deliverGoLog` → same `TssHook` / `GoLog` tags). iOS uses `BbmtBridge.setHookListener`.

**Android:** `libbbmtmobile` loads at module init when present in APK; all `BBMTLibNativeModule` methods use `Bbmt*` / `Dkls*` JNI only.
- LAN pairing UI resets the 20s countdown when discovery starts (not during native prep). `racePeerDiscovery` ignores empty discover results so `listenForPeers` can still win the race.

### RN mapping and UI

- Backend: `resolveMpcHookBackend()` — preference / keyshare metadata; while MPC is active, fall back so early hooks are not dropped.
- Before keygen/keysign modals open, resolve `keygenBackend` / `spendBackend` so the first hooks map correctly.
- Mapping (`services/mpcProgress.ts`): **GG18** linear `step / denominator`; **DKLs23** phase-based (`dklsKeygenPercent`, `dklsKeysignPercent`) for steps `0 → 1–2 setup → 3..N rounds → 99 done`.
- UI (`services/mpcProgressUi.ts`): animated circle (`withTiming`), phase labels (“Waiting for all devices…”, “DKG round N…”), optional `session` filter for stale hooks.
- Native polish: join-wait pulses every 2s on LAN/Nostr step 1 so follower devices do not look frozen at ~10%.

## LAN transport encryption

DKLs23 LAN MPC uses the same relay crypto as GG18 (`BBMTLib/tss` `MessengerImp`):

| Setup | Key material | Wire encryption |
|-------|----------------|-----------------|
| Duo LAN | `encKey` = peer secp256k1 pubkey, `decKey` = local private key | ECIES per message |
| Trio LAN | shared `sessionKey` (AES, derived like GG18) | AES per message |

`JoinKeygen` / `JoinKeysignWithSighash` call `ConfigureLANTransportKeys` before the HTTP relay pump; receive path uses `DecryptLANRelayPayload` (AES or ECIES). Nostr DKLs uses NIP-44 via `nostrtransport` (unchanged).

Mobile: `services/lanMpcTransport.ts` resolves transport keys (same rules as GG18) before `TssProvider.mpcTssSetup` → `dklsMpcTssSetup`. Duo DKLs requires a non-empty peer ECIES pubkey from LAN pairing (`lan_peer_pubkey` in app config); trio uses `sha256(sessionID,masterHost)` as AES `sessionKey`. If pairing keys are missing, setup fails fast with a clear error instead of `DKLS_MPC_SETUP_ERROR`.

## Known constraints

- Mixed-backend committees are not supported for keygen.
- GG18 prepare (`preparams`) can take minutes; DKLs uses a short `helloDkg` check.
- Descriptor paths: GG18 legacy wallets may use BIP44-style paths by `created_at`; DKLs uses standard BIP84/49 per address type.
