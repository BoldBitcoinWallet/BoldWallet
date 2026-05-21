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
| New keygen | `resolveTssBackendForKeygen(setupMode?, explicitBackend?)` → preference or route param | `dkls23_opted_out` in app config; Showcase passes `backend` in nav params |
| Send / PSBT / sign | `resolveTssBackend()` | From `keyshare_meta` + full keyshare shape |
| Native MPC calls | `TssProvider` (optional `backend` arg) | GG18: `mpc*` / `nostr*`; DKLs: `dkls*` |
| Wallet setup orchestration | `services/walletSetupOrchestrator.ts` | Shared LAN/Nostr prepare + LAN keygen sequence (main-branch GG18 parity) |
| Go keygen dispatch | `tss.DispatchJoinKeygen` / `DispatchNostrJoinKeygen` | `gg18` / `dkls23` (alias `dkls`); registered from `dkls` init |
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

LAN wallet setup uses **GG18-analog copy and progress** for both stacks (`services/walletSetupUi.ts`, `keygenPercentForUi` in `mpcProgress.ts`). DKLS still routes via `TssProvider` / `dklsMpcTssSetup`; only labels and the progress curve match GG18 on screen.

- Backend: `resolveMpcHookBackend()` — preference / keyshare metadata; while MPC is active, fall back so early hooks are not dropped.
- Before keygen/keysign modals open, resolve `keygenBackend` / `spendBackend` so the first hooks map correctly.
- Mapping (`services/mpcProgress.ts`):
  - **DKLs23 keygen**: phased prep (steps 1–2 → 0–20%) then DKG rounds (steps 3..N → 20–99%). Max round step tuned to typical native counts (duo ~9, trio ~11) so late rounds show **~75–95%** before `done`, not ~37%.
  - **GG18 keygen**: phased `gg18KeygenPercent` (not raw `step/18`) — milestones + message apply steps map higher before completion.
  - **Keysign**: DKLs phased per input; GG18 linear `step/36` with UTXO banding for multi-input sends.
  - **btc_send**: updates UTXO bands only; ring advances on `keysign` / `done`.
- UI (`services/mpcProgressUi.ts`): animated circle (`displayPercent`, 400ms ease), phase labels (“Waiting for all devices…”, “Key generation · round N”), optional `session` filter.
- **Dev trace**: in `__DEV__`, pairing screens log `MpcHook trace` with `{backend, type, step, mappedPercent}` after each hook.
- Reference curves: `buildKeygenProgressTrace(backend, isTrio)` in unit tests.
- Native polish: join-wait pulses every 2s on LAN/Nostr step 1 so follower devices do not look frozen at ~10%.

## LAN transport encryption

DKLs23 LAN MPC uses the same relay crypto as GG18 (`BBMTLib/tss` `MessengerImp`):

| Setup | Key material | Wire encryption |
|-------|----------------|-----------------|
| Duo LAN | `encKey` = peer secp256k1 pubkey, `decKey` = local private key | ECIES per message |
| Trio LAN | shared `sessionKey` (AES, derived like GG18) | AES per message |

`JoinKeygen` / `JoinKeysignWithSighash` call `ConfigureLANTransportKeys` before the HTTP relay pump; receive path uses `DecryptLANRelayPayload` (AES or ECIES). Nostr DKLs uses NIP-44 via `nostrtransport` (unchanged).

Mobile: `services/lanMpcTransport.ts` resolves transport keys (same rules as GG18) before `TssProvider.mpcTssSetup` → `dklsMpcTssSetup`. Duo DKLs requires a non-empty peer ECIES pubkey from LAN pairing (`lan_peer_pubkey` in app config); trio uses `sha256(sessionID,masterHost)` as AES `sessionKey`. If pairing keys are missing, setup fails fast with a clear error instead of `DKLS_MPC_SETUP_ERROR`.

### DKLS trio LAN hardening (timeout triage)

**Stuck at ~38% with `step: 1` / “waiting for devices (N)”** — this is the **join barrier** (`LANAwaitJoiners`), not DKG. All devices are waiting for the relay session to list every `KeyShareN`. Check logcat for `awaitJoiners: waiting` vs `awaitJoiners: all parties joined`. Shared fixes in [`BBMTLib/tss/mpc.go`](../BBMTLib/tss/mpc.go): join/await loops use tickers (timeouts actually fire), relay participant list is **deduped**, and `equalUnordered` compares **sets** (duplicate `joinSession` posts no longer block forever).

If trio setup fails with **`DKLs timed out waiting for peer message`** after several minutes (DKG phase, steps ≥ 3):

1. **Preflight** — `assertTrioLanKeygenReady()` in [`services/trioLanKeygenPreflight.ts`](../services/trioLanKeygenPreflight.ts) before trio LAN keygen. All three peers must show on the pairing screen (IPs, device names, unique `KeyShare1/2/3`). Re-pair if anything is missing.
2. **Relay pump** — [`BBMTLib/dkls/lan_pump.go`](../BBMTLib/dkls/lan_pump.go) marks a hash consumed only after **decrypt + deliver**; duplicate `from:md5(body)` copies are deleted without re-delivering.
3. **DKG recv** — [`BBMTLib/dkls/lan.go`](../BBMTLib/dkls/lan.go): **last-wins** per sender (`mergeDKGPeerMessages`), `roundCh` buffer 256 (pump must not block during `session.Next`). Timeout errors can include **missing sender IDs**.
4. **Mobile** — KeyShare1 starts relay **before** `initSession`; `masterHost` without `:port`; followers wait ~4s (trio). Rebuild native: `cd BBMTLib && ./build-dkls.sh ios` and `android`, reinstall on **all** devices.
5. **Log filters** — `awaitJoiners`, `DKLs DKG recv`, `duplicate DKG fragment`, `DKLs LAN pump`.

GG18 trio uses `downloadMessage` in `tss/mpc.go`; DKLS uses the dedicated pump — same relay crypto, different delivery/dedupe rules.

#### Mixed Android + iOS trio LAN verify

After rebuilding `libbbmtmobile` on all devices:

1. Pair trio on same Wi‑Fi until all three show with distinct `KeyShare1/2/3` roles.
2. Confirm **KeyShare1** device taps **Start Setup** first (runs embedded relay).
3. Other two tap **Join Setup** within ~20s.
4. Expect progress past “waiting for devices” (step 1) into DKG rounds (step ≥ 3).
5. If setup fails early, check logs for `joinSession:` / `Master LAN relay unreachable` (not only `DKLS_MPC_SETUP_ERROR`).

Host helpers: `services/lanMpcSetup.ts` (`normalizeLanHost`, `resolveTrioLanRoles` at pairing). **LAN keygen JS orchestration matches main-branch GG18** (`initSession` → master `runRelay` → `waitMS(2000)` → native keygen). Main used `Tss.joinKeygen` (GG18); this branch routes the same flow through `TssProvider.mpcTssSetup` when DKLS is selected (`dklsMpcTssSetup` / `lanJoinKeygenNative`).

#### Pre-mobile checklist (host)

Run **three consecutive** passes of the default gate before rebuilding native libs for devices:

```bash
cd BBMTLib
export CGO_ENABLED=1
export CGO_LDFLAGS="-L$(cd ../libtss && pwd)/target/release -llibtss_ffi -lm -framework Security -framework CoreFoundation"
./scripts-dkls/dkls-test-all.sh   # ~20s: unit + in-process trio + router trio
RELAYS=ws://127.0.0.1:7777 ./scripts-dkls/dkls-nostr-test-all.sh   # optional: Nostr duo+trio (~30s)
cd .. && npm test -- trioLanKeygenPreflight mpcProgress
./BBMTLib/build-all.sh            # embeds dkls/ into libbbmtmobile; reinstall app on all devices
```

Optional before device trio LAN debugging:

```bash
RUN_DKLS_LAN_INTEGRATION=1 ./scripts-dkls/dkls-test-all.sh   # LAN go test matrix (~1–2 min)
RUN_DKLS_SCRIPT_E2E=1 ./scripts-dkls/dkls-test-all.sh        # dkls-lan-keygen.sh + keysign.sh
```

DKLS shell scripts mirror GG18: see [`BBMTLib/scripts-dkls/TESTING.md`](../BBMTLib/scripts-dkls/TESTING.md).

#### Local test commands (host)

```bash
cd BBMTLib
export CGO_ENABLED=1
export CGO_LDFLAGS="-L$(cd ../libtss && pwd)/target/release -llibtss_ffi -lm -framework Security -framework CoreFoundation"
# Default smoke (unit + join-barrier + runDKGWithSender trio):
./scripts-dkls/dkls-test-all.sh
# LAN keygen integration (~1–2 min with DKLS_TEST_DKG_SEC=90):
RUN_DKLS_LAN_INTEGRATION=1 ./scripts-dkls/dkls-test-all.sh
# Or directly:
go test -count=1 ./dkls/ -timeout 5m -run 'TestLanJoinKeygenDuo$|TestLanJoinKeygenTrio$|TestLanJoinKeygenTrioDerivedSessionKey'
go test -count=1 ./dkls/ -run 'TestDedupe|TestRecvPeer|TestRunDKGWithSenderTrioInProcess|TestLanAwaitJoinersPartialTrio'
npm test -- trioLanKeygenPreflight mpcProgress
```

**`deserialize failed: duplicate DKG fragment from sender`** — only one inbound fragment per peer per `session.Next()` batch. Mitigations: merge/dedupe in `lan.go`, payload dedupe in `lan_pump.go`. Requires native rebuild on devices.

## Known constraints

- Mixed-backend committees are not supported for keygen.
- GG18 prepare (`preparams`) can take minutes; DKLs uses a short `helloDkg` check.
- Descriptor paths: GG18 legacy wallets may use BIP44-style paths by `created_at`; DKLs uses standard BIP84/49 per address type.
