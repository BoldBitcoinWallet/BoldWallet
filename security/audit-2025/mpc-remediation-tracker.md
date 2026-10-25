# BoldWallet remediation tracker (final pass)

Bundle B1 (F1+F2+F16) is tracked as ONE Critical sprint item. Do not split it.

| ID | Title | Sev | File:line | Fix | Owner | Status |
|---|---|---|---|---|---|---|
| F7 | Hardcoded prod signing passwords on disk | Closed | android/signed-release.sh:10 | Owner-confirmed: history .jks unrelated, never shipped; scripts/keys never committed. Optional keep: fail-closed release build | TBD | Closed |
| B1 | F1+F2+F16 backup-crypto chain (bundle) | Crit | see F1/F2/F16 | Ship as one fix; see rows | TBD | Done (merged c6d2613f) |
| F1 | Backup AES-CBC no-MAC, SHA-256(pw) KDF, no salt | Crit | BBMTLib/tss/mpc.go:484; services/keyshareImport.ts:67 | AES-256-GCM; Argon2id+random salt; fail closed | TBD | Done |
| F1b | KDF param DoS via crafted v2 header (new in B1) | Med | BBMTLib/tss/backup_v2.go caps | Cap m<=256MiB/t<=10/p<=4 pre-KDF + rejection test | TBD | Done |
| F2 | Imported pub_key never verified vs group key | High (Crit in B1) | BBMTLib/dkls/keyshare.go:104 | Assert ks.PubKey==hex(share.GroupKey())+suite post-import | TBD | Done |
| F16 | Export password gate is strength>=3, not full policy | Low (gate/UX; handler already enforced) | components/BackupKeyshareModal.tsx:508 | Gate on isValid (all 5 rules); airgap uses PIN path, unaffected | TBD | Done |
| F16b | Airgap export PIN is 6 digits + SHA-256 + CBC | Med | services/airgapPin.ts:3; components/AirgapKeyshareExportModal.tsx:86 | Longer PIN or PAKE; GCM; warn on screen-record | TBD | Open |
| F15 | ExportKeyShare plaintext despite SecureBytes | High | BBMTLib/dkls/keyshare.go:31 | PARTIAL (Wave 2): SecureBytes-at-export + Destroy/wipe + BbmtFree memset + theater-wrapper removal + backup-export opacity. share_b64 still crosses JS on persist/import/read → F15b | TBD | Partial |
| F15b-1 | Native-held shares: storage flows (3a) | Critical | persistWalletKeyshare; getKeyshare; backupDecrypt; RNES keyshare value | Go registry + at-rest envelope + native persist/staged-import/metadata getters; GG18 setup carved to F19 | TBD | Green (3a-5 evidence below; unmerged on security/wave3a-f15b1-f10clip) |
| F15b-2 | Native-held shares: ceremony flows (3b) | Critical | signing methods; nostrJoinKeysign ×2 | Implemented (3b): per-ceremony tokens (sign/keygen/export/import/config, ≤10min TTL-start, OS prompt, no-lock refuse) gate all DKLs + GG18 sign/setup/keypair/transport/import/export/cancel (3b-6 tokenized GG18); F18 removed; evidence 3b-6 | TBD | Implemented, pending QA/merge (security/wave3b-f15b2-f18-f10) |
| F18 | nostrJoinKeysign takes keyshare JSON from JS on BOTH platforms; dead from JS | High | BBMTLibNativeModule.kt:741; BBMTLibNativeModule.swift:927 | Implemented (3b-3): REMOVED both bridge methods + JNI/shim layers after zero-caller re-verification (static/dynamic/WebView/reflection); Go core stays native-only; f18Removal 6/6 pins | TBD | Implemented, pending QA/merge (security/wave3b-f15b2-f18-f10) |
| F19 | GG18 protocol-variant decision | High | mpcTssSetup; nostrMpcTssSetup; GG18 signing ×4 | Decided pre-Wave-4: TOKENIZE, do not remove/deprecate (production holds live GG18 keyshares; removal locks funds). 3b-6 gated all 6 GG18 sign/setup branches with class-binding tokens + OS prompts; GG18 e2e with legacy keyshare (no tss_backend) proves backward compat. Future deprecation (out of scope, not queued): (1) tokenize — done; (2) stop issuing new GG18 keyshares at DKG; (3) remove GG18 signing only after telemetry proves zero GG18 keyshares remain | TBD | Done (tokenized) |
| F20 | No native PSBT-confirmation screen (ceremony prompt summary is JS-supplied/spoofable) | High | §6.4 wave3-design | Native screen parsing destination/amount from PSBT bytes at signing time | TBD | Open (post-Wave-3) |
| F21 | Pairing nsec returned to JS in full, retained in state after finalize (not the MPC share; separate from F15b) | Med | screens/MobileNostrPairing.tsx:1240,478,1242,1891 | Clear localNsec state + pendingKeyshareRef.partyNsec after ensureNostrKeyshareStored succeeds; long-term native-held nsec handle (F5 scope) | TBD | Done (3b first commit; guardrail __tests__/f21PairingNsec.test.ts 3/3; dereference, not heap wipe — disclosed) |
| F23 | v2 file backups silently empty on iOS / export fails on Android (B1 file-layer escape) | Critical | components/BackupKeyshareModal.tsx:164 (writeFile 'base64' of "BW2$..."); services/keyshareImport.ts read path | DONE (3b-6d, pre-merge blocker): write envelope as utf8 ASCII + fail-closed stat guard (never share 0-byte file); import sniffs utf8 "BW2$" passthrough else base64 legacy fallback (readBackupBlobFromUri). iOS B1-era v2 files are 0 bytes and UNRECOVERABLE from the file — recovery via older legacy backup or live paired device only. Legacy backups never affected. Opacity test encoding pin corrected base64→utf8; 6 new tests (5 sniff + 1 stat guard) | TBD | Done (3b-6d; needs device retest round-trip before merge) |
| F3 | Android ESP silently falls back to plaintext | High | BBMTLibNativeModule.kt:170 | DONE (Wave 2): typed fail-closed errors, StrongBox→TEE, security-crypto 1.1.0, UI surfacing, patch-package. No per-read auth (backgrounded reads) | TBD | Done |
| F4 | iOS Keychain item has no ACL | High | RNEncryptedStorage.m setItem | DONE (Wave 2): keyshare-scoped WhenPasscodeSetThisDeviceOnly, biometry → 3b ceremony auth (per-ceremony OS prompt; item class stands), patch-package, harness 7/7 | TBD | Done |
| F5 | nsec in JS heap + embedded in backup blob | High | screens/MobileNostrPairing.tsx:1230; dkls/keyshare.go:26 | nsec in Keychain/RNES only; opaque ref; exclude from export | TBD | Open |
| F8 | Global Android cleartext + ws/http allowed | High | network_security_config.xml:3 | Scope cleartext to loopback/link-local; block non-LAN ws/http | TBD | Open |
| F9 | Secrets cross bridge as strings; no zeroization | High | BBMTLibNativeModule.kt:160; BbmtBridge.mm:13 | Opaque handles; SecureBytes/memset+mlock; minimize copies | TBD | Open |
| F10-clipboard | Secret clipboard writes (full keyshare JSON, dice rolls) | High | KeyshareInfoContent.tsx:605; DiceEntropySheet.tsx:604 | Metadata-only copy (npub/pub_key/suite); dice copyDisabled; clipboard-after-export tests | TBD | Green (3a-5 evidence below; unmerged on security/wave3a-f15b1-f10clip) |
| F10-bridge | Bridge sign/decrypt callable from any JS | High | services/TssProvider.ts:116 (62 native methods) | Done (3b-6): Table B fully gated (B5–B21 + A12 + B19 cancel-consume); setAPI/fee allowlist-or-token; keypair generators retained + gated (OS prompt); L5 malicious-JS suite 15/15 over 25 gated methods. No carve-outs — GG18 sign/setup tokenized, F10-GG18 closed | TBD | Done (security/wave3b-f15b2-f18-f10, pending QA/merge) |
| F10-GG18 | GG18 sign/setup branches token-gated | Critical | mpcSignPSBT; mpcSendBTCWithUTXOs; nostrMpcSendBTC; nostrMpcSignPSBT; mpcTssSetup; nostrMpcTssSetup (GG18 branches) | Done (3b-6): all 6 branches take class-binding tokens (sign ×4 incl. 2 single-call nostr; keygen ×2 strict-session) on both platforms with operation-specific OS prompts; pin tests rewritten as authorization assertions (unsigned/wrong-class/wrong-session fail, valid succeeds); GG18 legacy e2e 5/5 | TBD | Done |
| F11 | No input validation at JNI/Go seams; FFI crashes | High | bbmtmobile/export_dkls.go:17; tss/common.go:465; mpc.go:1238 | Done (wave4, 6 commits): Go seam validate.go (mustGoStr nil/8MiB, mustNonNegative, recoverBridge) × 66 exports; SecureRandom [1,4096] + RecoverAsError; amounts 21M-BTC, isEdDSA 0/1, preparams-timeout bounded. JNI null+16MiB guards × 53 entry points (65 symbols unchanged). Kotlin 58 @ReactMethods nullable+INVALID_ARGS; fail-closed publish/fetch/listen/discover; setAPI shape (https any; http/ws/wss LAN-literal, no DNS) + error-prefix rejects. Swift 59 @objc nullable+guard; fail-closed 4; shape mirror + harness 47; dupC nil-propagating. JS INVALID_URL contract tests. Evidence: Go seam 6/6 (tagged), tss full green, JVM 47/47, instrumented F11 5/5 emulator, harness PASSED, assembleDebug + xcodebuild Debug green, L5 15/15 (window 600→1300, property unchanged). Residuals (documented, not blocking): (1) broad error-text-as-value propagation on unfixed iOS resolve()/Android bbmt* methods — named methods fixed, wholesale fix is F10-bridge follow-up; (2) listen/discover no prefix check (user-controlled peer names — deliberate); (3) DklsBridge.mm dead, no callers; (4) empty-string requiredness owned by domain code | TBD | Done |
| F6 | LAN decrypt-before-verify padding oracle | Med-High | BBMTLib/tss/mpc.go:1149 | Done (wave4): uniform-outcome (all reject classes DELETE same poll + dummy MAC work) instead of reorder — h1 tag covers plaintext by wire design, so verify-before-decrypt would break cross-version ceremonies (AEAD/EtM declined, see PR). Nil-guards on DELETE path (no Do(nil), no nil Body.Close). Tests: f6_oracle_test.go (same-poll DELETE ×4 classes, nil-safety ×2, timing medians 959ns vs 25.6µs with <50ms bound — hang-check only, NOT a timing-oracle proof; -race clean). Verified: single DELETE constructor (no class-dependent fields); dummy HMAC is real hmac.New+Sum work. Residuals → F24/F25/F26 | TBD | Done |
| F24 | Empty-hash LAN messages skip verification entirely (pre-existing fail-open; review proposed as F23 but F23 taken) | Med-High | BBMTLib/tss/mpc.go:1183 (if Hash != gate) | Producer census first: if no legit producer omits hash, drop untagged; else understand path. Disposition vs F6: DISTINCT vector, not a reopening — F6's delete/keep oracle is closed (Done stands); F24 is a separate bypass path | TBD | Open (Wave 5) |
| F27 | Go errors resolve as values (error-text-as-value) across the bridge (review proposed as F26; F26 taken by timing residual) | High | iOS BBMTLibNativeModule.swift resolve()/ternary; Android bbmt* raw wrappers (DklsNative.kt) | Wave 5 order: (1) audit the iOS/Android delta FIRST — 9-instance gap (Android 34 vs iOS 25 residual; review said 15, arithmetic corrected), incl. postTx txid + btcAddress fixed on iOS but not Android: mirror those before the rest; (2) F27-GG18 sub-row first; (3) remaining config/misc per-method (status channels prefix-check + reject; data channels assessed individually). Count (measured): iOS 25 residual / 20 fixed / 23 N/A (68); Android 34 residual / 19 fixed / 17 N/A (70). Proven bite: testnet4 error-text mempool URL incident | TBD | Open (Wave 5) |
| F27-GG18 | GG18 sign/setup raw-resolve Go errors as signatures/handles, both platforms | High | mpcSignPSBT/mpcSendBTCWithUTXOs/nostrMpcSendBTC/nostrMpcSignPSBT/mpcTssSetup/nostrMpcTssSetup (iOS ternary + Android raw resolve) | First within F27: same protocol under-tested throughout the audit (untokenized until 3b-6); convert to reject-on-error both platforms | TBD | Open (Wave 5, first in F27) |
| F28 | Build integrity: gradle ships prebuilt .so, native fixes don't reach binary without manual rebuild (review proposed as F27) | High | android/app/build.gradle (no externalNativeBuild path); jniLibs prebuilts | One of: (a) source-hash verification in build (fail if .so older than cpp/Go sources), (b) always-rebuild gradle task wiring build-dkls.sh, (c) committed .so with embedded build stamp + CI check. F11 instrumented null test crashed on stale .so and passed after rebuild — proof the pipeline silently ships stale code | TBD | Open (Wave 5) |
| F25 | No HTTP timeout on LAN DELETE/poll GET (malicious-relay hang; review proposed as F24) | Med | BBMTLib/tss/mpc.go:1065,1240 (http.DefaultClient) | Bounded http.Client{Timeout} on transport calls | TBD | Open (Wave 5) |
| F26 | F6 timing residual: reject medians 959ns vs 25.6µs (panic/recover cost; review proposed as F25) | Low-Med | BBMTLib/tss/mpc.go:1152 reject paths | Documented: network-indistinguishable vs passive observer; potentially distinguishable by active LAN-local adversary with repeated trials. Fix if prioritized: balance fast paths or cheaper error path | TBD | Open-doc (Wave 5) |
| F12 | Prefix-match cancel + 15-min poison; no-confirm bridge cancel | High | tss/cancel.go:29,103; BBMTLibNativeModule.kt:505 | Exact-match cancel; per-session contexts/keys; confirm token | TBD | Open |
| F14 | SessionKeyHex inert; secrecy rests on long-term nsec | Med | tss/nostrtransport/config.go:49 | HKDF session key into AEAD or remove field (allowlist is DKG-pinned: signing_resolve.go:57) | TBD | Open |
| F13 | Background/kill: warning-only; replay memory is RAM-only | Med | services/mpcKeepAlive.ts:200 | Ceremony epoch or fresh session IDs post-death; persist seen-IDs | TBD | Open |
| F31 | No fee-rate cap: mempool API value flows unbounded into send (only 1 sat/vB floor) | Med | BBMTLib/tss/btc.go:233,1392,1191 | Cap fee rate (sanity max sat/vB) + cap total fee vs amount; reject absurd mempool values | TBD | Open (v4.1.1 Track B, NEW — Wave 6+) |
| F32 | Trio LAN session key derived from public values only (sha256 of sessionID + masterHost) | High | BBMTLib/tss/lan_crypto.go:9-13 | Derive from a secret (PAKE/pairing secret or ECIES-wrapped random key); protocol change | TBD | Open (v4.1.1 Track B, NEW — Wave 6+) |

Fix waves: (1) F7+sweep done. (2) B1 done. (3) F15(partial→F15b),F3,F4 done. Wave 3a = F15b-1+F10-clip (GREEN, unmerged); Wave 3b = F15b-2+F18+F10-bridge+F4-auth (implemented incl. 3b-6 GG18 tokenization, pending QA/merge); Wave 4 = F11+F6; then F12,F14; F13. F19 Done (tokenized); F20 deferred; F21 Done (3b first commit). F10-GG18 Done. F23 Done (3b-6d v2 file fix; retest round-trip gates merge).
Still owner-side: govulncheck, npm audit, gitleaks/trufflehog history, FROST/DKLs23 fork diff.

## Wave 1 — B1 (F1+F2+F16): DONE (merged c6d2613f). F7-residual fail-closed build: done.

## Wave 2 — F15 (partial) + F3 + F4: DONE (merged 2d634e91).

See `security/audit-2025/wave2-pr-notes.md` for the full PR description,
bridge audit, failure matrix, and test evidence. F15b (native-held
shares) is the follow-up that actually closes plaintext-to-JS.

## Wave 3a — F15b-1 + F10-clipboard: GREEN on `security/wave3a-f15b1-f10clip` (unmerged).

Design: `security/audit-2025/wave3-design.md` (Phase A approved
with split; pre-Phase-B resolutions in §10). GG18 carved to F19;
PSBT-screen to F20.

3a-5 evidence (L1+L2 primary per §10; L3/L4 supporting):
- L1 jest bridge-spy `__tests__/wave3a-bridgeSpy.test.ts` 11/11:
  setup-output LAN+Nostr, orchestrator pass-through, import,
  persist (nsec-arg exception documented), read/metadata,
  dev-view redacted + source guardrail, delete, migration; known
  share fixture absent from all recorded traffic. GG18 branch
  skipped with explicit kind-tag assertion (F19 cite).
- L1 suites: f10Clipboard 5/5, keyshareImport 11/11,
  walletSetupOrchestrator 17/17, tssProviderSetupDispatch 7/7,
  chaincodeSecureReader 5/5, keyshareEnvelopeMigration 6/6,
  keyshareHandles 2/2, keyshareMetadata 19/19 (fixed ESM
  op-sqlite collect stub; suite failed identically at Wave 2
  base), keyshareDevView green.
- L2/L3/L4 native+Go: JVM 12/12; instrumented envelope 5/5 on
  Small_Phone_API_35 (device Keystore round-trip, migration
  converge/crash-recovery/corrupt-fails-closed/empty-noop);
  SecurePrefs 1/1; swiftc envelope harness PASSED; Go
  keyhandles 5/5 + full dkls package PASS; JNI 66 symbols, no
  dupes; Android instrumented build + iOS workspace build green.
- 3a-5 code fixes: Go RedactedStructure HTML-escape
  (\u003c markers now literal); Android seal provider-IV
  (Keystore rejects caller IVs — instrumented catch, would have
  broken on-device encrypt).
- Out of 3a scope, verified pre-existing at Wave 2 base (left
  untouched): urBytesQr 1 frame-count failure,
  mpcProgressAbort collect failure, 4 libtss-submodule suites
  (need native libtss), 32 tsc errors in non-3a tests.
- L4 scoping: sign round-trip belongs to 3b (signing path is
  F15b-2/F18); kill-mid-session follows from heap-only registry
  (zero disk writes in staged path, verified by grep, not
  disk-write instrumentation) + envelope at-rest verified
  readable; clipboard-after-export via L1 payload + guardrails
  per accepted-evidence rule.
- F21 (new, non-blocking): pairing nsec is native-generated
  (nostrKeypair :1240) but returned to JS in full and kept in
  localNsec state (:478, set :1242, never cleared) plus
  pendingKeyshareRef.partyNsec (:1891, never nulled after
  successful finalize) for the screen's lifetime. No
  persistent-store writes found; signing takes no nsec
  (native loads creds). Fix is a post-finalize clear, tracked
  separately — nsec isn't the MPC share.

## Wave 3a QA gate — RESULT: passed (2026-10-24, release-owner reported)
- Scope: 3a storage flows on device (envelope persist/read, legacy
  migration converge, clipboard metadata-only, backup export v2).
- Devices/OS/runner: to be confirmed by QA runner (verbal pass
  received; models + OS versions pending fill-in).
- Merge gate satisfied; 3a merges to main, then 3b.
## Wave 3b — F15b-2 + F18 + F10-bridge + F4-auth: Implemented, pending QA/merge on `security/wave3b-f15b2-f18-f10`.

Sequence: F21 (Done, first commit) → 3b-1 token core →
Table B gating → F18 + A12 → cancel/F4 → L5 tests → 3b-6
GG18 tokenization. All slices green; F15b-2/F18
implemented pending QA/merge; F10-bridge Done (F10-GG18
closed, F19 tokenized — no carve-outs).
Real-device QA (8-item checklist) is a MERGE GATE — run
before merge, record "QA passed" here. Merge after QA:
3a → main (--no-ff), then 3b → main (--no-ff).
Doc reconciliations at kickoff (design §6/Table B–D):
(1) token expiry 10 min wins (§6.2 "30-min" was a doc bug);
(2) Table C dead-oracle removals actually landed in 3a,
"(3b)" label stale — no code action; (3) Table D cancel
bullet struck, superseded by B19 (cancel takes + revokes
the ceremony token; only F12's exact-match mechanism stays
Wave 4). Keypair generators: retain + token-gate (B20–B21),
do not remove. F21 tracked Done independently of F15b-2.

3b-1 token core GREEN: CeremonyTokens.kt + CeremonyTokens.swift
(state machine minted→active→used|expired|revoked, class+
session binding, ≤10min TTL, single-live-session mint,
cancel→revokeSession), JVM CeremonyTokensTest 12/12,
ceremony-harness PASSED (mirrors JVM case-for-case),
ceremonyAuth.test.ts 8/8 (wrapper + malicious-mint
simulation + Test-hook guardrail), Debug+Release iOS builds
green (#if DEBUG strip proven), Android compile green
(androidx.biometric 1.1.0 — cached; 1.2.0 API unused).
Backgrounding DECISION (flag b): NO revoke on background —
Android foreground-service keep-alive legitimately runs
prepare/keygen/co-sign for minutes backgrounded
(mpcKeepAlive.ts); revoke-on-background would break it.
≤10min expiry is the bound; mint implicitly requires
foreground (OS prompt needs a live Activity/scene).
TTL bounds start, not duration (3b-1c). Mint supersession =
bounded DoS only (every mint needs user presence, so JS
alone cannot revoke a live ceremony — not exploitable).
androidx.biometric pinned 1.1.0 (cached; upgrade when
online — 1.2.0 API unused). Verify is timing-flat
pre-check (single false, no transition-then-rollback).
3b-1d: test mint compile-eliminated both platforms
(Android debug source set + reflective registration,
release classes verified absent; iOS #if DEBUG, Release
build green). Mint entry is per-ceremony only (3b-1b, no
generic minter); TTL bounds start (3b-1c).

3b-2a sign slice GREEN: 4 DKLs sign wrappers
(mpcSignPSBT, mpcSendBTCWithUTXOs, nostrMpcSendBTC,
nostrMpcSignPSBT) mint-or-receive a sign token via
withSignToken (complete on success, release on throw,
owner tokens pass through untouched); native gates both
platforms (Kotlin verify/verifySingleCall + reject helper,
Swift guard + .m ceremonyToken params — gate FIRST,
before runtime/storage checks). Session-less calls (sends,
nostr) use verifySingleCall (opClass + TTL-start +
revocation; session equality inapplicable — documented at
both call sites). GG18 branch untokenized (F19 gap,
tested). Evidence: tssSignTokenGating 8/8, JVM 15/15,
ceremony-harness PASSED, tsc 32 pre-existing, eslint
clean. complete/release evict the JS session map in
finally (no stale reuse after native failure).

3b-2b keygen/keypair slice GREEN (B9-B12, B20-B21): 2 DKLs
setup wrappers take keygen tokens (strict session verify;
GG18 setup excluded per F19, tested); nostrKeypair +
eciesKeypair retained + gated via new TssProvider wrappers
(single-call keygen ceremony each — pairing precedes DKG by
minutes, so the design's "one token covers both" sharing is
inapplicable; each mint carries its own OS prompt).
withSignToken generalized to withCeremonyToken (mint fn
pinned per call site — still no generic minter). Zero
direct native keypair callers remain (2 screens migrated).
Evidence: tssKeygenTokenGating 8/8, JVM 16/16, harness
PASSED, iOS Debug + Android release green, tsc 32
pre-existing, eslint 0 errors. Spy/dispatch mocks extended
for the keygen mint (token traffic share-free).

3b-2c transport slice GREEN (B13-B14): design premise
corrected — the only JS transport callers are pre-ceremony
LAN pairing signaling (MobilesPairing publish/fetch);
in-ceremony MPC transport runs inside Go (net/http), so no
parent ceremony token exists at these call sites. Resolution:
the HANDSHAKE is the ceremony — initSession mints a
keygen (setup) or sign (send/sign) token after validation,
owns it across publish + fetch polls, completes before each
return, releases on any throw; user-cancel/no-lock errors
pass through with actionable text. Native verifyTransport
(sign|keygen + strict session; no transport class) both
platforms; TssProvider wrappers take REQUIRED token+session
(transport never mints — a fallback would prompt-spam the
poll loop). Gate rejects (fail fast), unlike the legacy
resolve-"" transport errors. Evidence: tssTransportGating
4/4, JVM 18/18, harness PASSED (66 checks), iOS Debug +
Android release green, tsc 32 pre-existing, eslint 0 errors.
Full jest 670 passed, same 6 pre-existing failures.

3b-2d config slice GREEN (B15-B16): allowlist-or-token.
Native CeremonyApiAllowlist both platforms (seeds =
mempool.space mainnet+testnet defaults, fail-safe on drift;
private prefs/UserDefaults store, sole-writer verified;
normalize + CSV parse; pure decide()). setAPI/setFeeAPIs
gate FIRST: allowlisted applies silently, unknown needs a
`config` token (strict session) and is then persisted
(best-effort persist, always applies once approved). JS:
TssProvider wrappers (token optional, '' default) +
apiConfigApply ensureMempoolApiApplied/ensureFeeApisApplied
(silent try; unknown URLs get in-app URL confirm — the OS
prompt cannot show the host — then config mint; null-confirm
direct mint for settings saves with the URL on screen;
per-session denial memory; same-URL inflight dedup). All 30
call sites migrated (25 setAPI + 5 setFeeAPIs incl.
contexts; zero direct native callers remain). No QR-provided
URL reaches setAPI (QR carries network only; URLs are
stored-or-default) — legacy custom URLs re-confirm once via
the Alert. Evidence: apiConfigApply 12/12, JVM allowlist
9/9 + tokens 18/18, harness PASSED (80 checks), iOS Debug +
Android release green, tsc 32 pre-existing, eslint 0 errors.
Full jest 682 passed, same 6 pre-existing failures.

3b-2e import slice GREEN (B17-B18, Table B COMPLETE):
strict `import` ceremony on stage + persist, both platforms.
Import flow (adjacent stage→persist, no user action between)
shares ONE owner ceremony: importKeyshareFromBase64 mints,
threads the pair, completes at the end. Setup-commit flows
are DECOUPLED from setup by the backup-check UI (persist
from a pending-handle ref on an explicit save tap), so
persist mints its own save ceremony there — one prompt per
explicit user action, not one per flow. TssProvider wrappers
are owner-or-mint with a both-or-neither half-pair guard
(throws, never silently re-mints); withCeremonyToken fn now
also receives the ceremony session for native strict verify.
Spy F1 sha256 assertion narrowed to ceremony-session inputs
only (ceremony/<purpose>/ nonce, never password-derived).
Evidence: tssImportTokenGating 8/8, keyshareImport owner
tests 3/3, JVM tokens 19/19, harness PASSED (84 checks), iOS
Debug + Android release green, tsc 32 pre-existing, eslint 0
errors (fixed one pre-existing unused import in the touched
file). Full jest 693 passed, same 6 pre-existing failures.

3b-3 GREEN (F18 removal + A12 export token): nostrJoinKeysign
REMOVED both platforms — zero-caller re-verified (static JS
scan, WebView/eval/computed-dispatch/reflection all absent;
both twins took keyshareJSON plaintext). Removed: bridge
methods + .m export + DklsNative wrapper/decl + JNI impl
(Android) + TssShim + BbmtBridge mm/h (iOS). Go
BbmtNostrJoinKeysign stays (native-only, harmless, still
drives in-Go signing). Already-dead dkls-side
nostrJoinKeysignJni decl left untouched (out of scope,
unreachable). A12: backupEncryptStoredKeyshare takes a
single-call `export` token both platforms; both modals route
via TssProvider (no JS biometric gate existed — enforced
ceremony auth is strictly stronger). Evidence: f18Removal
6/6 source-text pins, tssExportTokenGating 4/4, JVM 20/20,
harness PASSED (86 checks), assembleDebug (NDK) + iOS Debug
green, JNI 65 symbols no dupes, tsc 32 pre-existing, eslint
clean. Full jest 703 passed, same 6 pre-existing failures.

3b-4 GREEN (B19 cancel gating + F4-auth): all 4 cancels take
a ceremony token (same op+session) and natively ATOMICALLY
revoke the session (cancelConsume: authorize+revoke under
one lock — no authorize→revoke TOCTOU; revocation precedes
the Go broadcast so a failed broadcast still leaves the
ceremony dead; Swift needed a lock-free inner revoke,
NSLock is non-reentrant). Sessioned cancels verify session
equality; nostr global cancels scope revocation to the
token's own session. JS prefers the live token (no prompt
on abort; nostr finds the sole live ceremony) and falls
back to a fresh same-session mint (B19 stuck-cancel,
OS prompt; also covers GG18 flows which never minted).
Stuck-mint class threaded from both abort sites (isKeygen;
live tokens pass through regardless). F4-auth: verified
(both prompts are biometric-or-device-credential with
no-lock refuse, mint only on success) and pinned by
f4CeremonyAuth source-text suite (single release mint per
platform, 5 entries via promptAndMint, DEBUG mint stays
eliminated). isCeremonyAuthRejection hoisted to ceremonyAuth
(cycle-free; apiConfigApply re-exports). Evidence:
tssCancelTokenGating 6/6, f4CeremonyAuth 8/8, JVM 23/23,
harness PASSED (98 checks), iOS Debug + Android release
green, tsc 32 pre-existing, eslint 0 errors. Full jest 717
passed, same 6 pre-existing failures.

3b-5 GREEN (L5 + round-trips + evidence): l5MaliciousJs 11/11
(strict-native simulator: all unsigned/direct calls fail
closed; cross-class and cross-session replay fail; config
evil-URL/wrong-class fail, seeds pass; no generic minter;
all 19 gated methods carry + verify ceremonyToken both
platforms; setup→persist→read→sign round-trip leaves zero
live tokens; no background revocation wiring; tokens
memory-only so kill-mid-session recovers nothing).
Regression: JVM 44/44, instrumented 6/6 on emulator,
harness 98 checks PASSED, iOS Debug + Release SUCCEEDED,
assembleDebug (NDK) green, JNI 65 symbols no dupes, tsc 32
pre-existing, eslint 0 errors. Full jest 743 passed
(3b-6: +15 GG18/e2e); same 6 pre-existing failures
(2 suites identical at 3b base; 4 libtss-submodule
environmental).

MANUAL QA CHECKLIST (real devices — MERGE GATE, run after
3b-6; devices: one Android fingerprint-only, one iOS Face
ID; record "QA passed" + models/OS/date below):
1. Fresh install → create wallet (LAN): Welcome →
ShowcaseScreen → leave TssBackendSelector on default →
MobilesPairing → complete pairing. OBSERVE: OS prompt
"Authenticate to generate keys" fires at keypair, at DKG
setup, and at save; wallet creates; no extra prompts.
Repeat over MobileNostrPairing (nostr): same 3 prompts.
2. Restore backup: Welcome → restore → pick a v2 backup
file → enter password. OBSERVE: exactly one import
prompt ("Authenticate to import backup"); wallet
restores. Repeat with a legacy CBC backup: legacy
warning shows; wrong password → clean error, no crash.
3. Send + sign PSBT (LAN + nostr): WalletHome → Send
(SendBitcoinModal) → enter address/amount → confirm.
OBSERVE: one "Authenticate to sign" prompt per ceremony;
sign completes. PSBT: PSBTScreen → sign → same prompt.
Abort mid-sign → cancels with NO second prompt. Stuck
abort (airplane mode mid-sign) → exactly one re-prompt,
then cancels.
4. Export backup: WalletSettings → backup → password
export (BackupKeyshareModal, 5-rule password) → confirm.
OBSERVE: one "Authenticate to export backup" prompt per
export; file writes. F23 ROUND-TRIP (merge gate):
verify the .share file is NON-EMPTY (>0 bytes), then
delete the wallet and restore from THAT file — restore
must succeed. Repeat airgap QR export
(AirgapKeyshareExportModal): prompt fires, QR shows.
5. Change provider: WalletSettings → Network providers →
edit/add a mempool host → save. OBSERVE: one
"Authenticate to change settings" prompt; new host
persists; kill + restart → new host active, no prompt.
6. Background/kill: start a sign ceremony → background
the app 2+ min → foreground. OBSERVE: ceremony
continues (no revoke). Kill mid-sign → relaunch:
no crash, no orphan state, re-sign works (re-prompts).
7. No-lock device (disable screen lock in OS settings):
attempt any ceremony. OBSERVE: refuses with the
screen-lock message, never a raw keychain error.
Re-enable lock → ceremonies work again.
8. Cancel-dead: start sign → cancel from the UI →
wait past the ceremony window. OBSERVE: no late
signature lands; balance/nonce state unchanged.
9. GG18 legacy sign: restore/install a wallet whose
keyshare predates tss_backend (or set the GG18 opt-out
and use a GG18 keyshare) → Send → confirm. OBSERVE:
"Authenticate to sign" fires; ceremony completes;
signature broadcasts/verifies.
10. GG18 setup: ShowcaseScreen → TssBackendSelector →
choose GG18 → complete pairing (LAN or nostr).
OBSERVE: prompt text names key generation ("Authenticate
to generate keys" / setup ceremony); DKG completes.
11. GG18 cancel: start a GG18 sign → cancel. OBSERVE:
no residual prompt/token; immediate re-sign re-prompts
fresh and works.
12. GG18 aborted setup: start GG18 DKG → abort mid-DKG
(airplane or cancel). OBSERVE: clean error; no orphaned
share on device (fresh restore/create works after).

QA RESULT: _pending — record "QA passed" + device models,
OS versions, date here before merging._

Log-trace close-out (pre-merge, parallel with QA): the two
"[redacted: sensitive log suppressed]" lines in the GG18
loopback output are the repo's OWN sanitizer
(sanitizeLogMessage, logs.go:62) redacting
`Logln("BBMTLog", "keyshare generated: ", moniker)` — the
"keyshare" substring token matches, so party monikers
("p1"/"p2", non-secret) are suppressed by design.
Bypass audit: only relay.go uses raw log.Printf (5 sites:
session register/delete, message add/delete, 2 completion
logs); content is session/participant/message IDs + one
full message struct whose body is encrypted-or-public
transport bytes — no share/nonce/nsec/session-key
material. With InitLog, even those pass the sanitizer via
logWriter before reaching the RN bridge. VERDICT: verified
non-secret, sanitizer over-matches by design — no F22.
Hygiene note for Wave 4 (opportunistic, not a finding):
trim relay.go:239 `%+v` full-body log to metadata-only.

3b-review response (pre-merge items):
1. GG18 verdict: LIVE — do NOT remove. Evidence: production
Welcome screen (App.tsx "Welcome" → ShowcaseScreen) offers
TssBackendSelector for new keygen (dkls23 default, gg18 via
DKLS23_OPTED_OUT pref); legacy keyshares without
tss_backend infer gg18 in detectKeyshareTssBackend with no
forced migration. No 3b-6 removal commit. F10-bridge is
Partial; F10-GG18 Critical open names the 6 untokenized GG18
sign/setup branches (GG18 cancels ARE gated). Pin tests
assert the bypass shape, not authorization.

3b-6 supersedes review item 1 (pre-Wave-4 decision):
GG18 TOKENIZED, not removed/deprecated — production
holds live GG18 keyshares and removal would lock funds.
All 6 branches gated (Kotlin + Swift + .m + TssProvider
wrappers; keygen ×2 strict-session, sign ×2
strict-session + ×2 single-call nostr) with the existing
operation-specific prompts ("Authenticate to sign" /
"Authenticate to generate keys"). Pin tests rewritten as
authorization assertions; GG18 legacy e2e
(tssGg18LegacyE2E 5/5, fixture without tss_backend)
proves backward compat. F10-GG18 → Done, F10-bridge →
Done, F19 → Done (tokenized). Evidence: jest 743 passed
(same 6 pre-existing suite failures), JVM 44/44, harness
98/98, L5 15/15 over 25 methods (GG18 session-index pins
asserted, not just documented), Go
TestF19_LegacyGG18LoopbackKeysign PASS (in-process 2-party
DKG + threshold sign, both sigs independently verified;
11.7s, -race clean, -short skip), iOS Debug + Release
SUCCEEDED, assembleDebug green, JNI 65 symbols, tsc 32
pre-existing, eslint clean.

3b-6e (backup nudge UX): REVERTED by 3b-6f per product
— persistent nag removed as annoying/meaningless since
internal auto-realign + always-newest-format exports
cover old keys. What stays: SILENT legacy import (no
alert, envelope realign internally, newest format on next
export; pinned by 3b-6f no-alert test). One-time
post-migration prompt ("Keyshare storage upgraded", Q2)
kept — fires once ever, only when a migration ran.
2. Real-device QA is a merge gate (8 items, Android
fingerprint + iOS Face ID). Not run by the agent — record
"QA passed" here before merging.
3. Status wording corrected: F15b-2/F18 "Implemented,
pending QA/merge"; F10-bridge "Partial, pending F19".
Config-allowlist seed spot-check (both entries read-only):
Kotlin `val SEEDS` + Swift `static let seeds` are immutable
consts referenced only by isAllowed reads; persist() merges
store.load() only — seeds never written or persisted.
Notes: ceremony tokens are ephemeral (memory-only); process
kill = re-auth on next ceremony (no recovery, no orphans).
Dead dkls-side nostrJoinKeysignJni decl + impl deferred as
Low cleanup (unreachable, zero Kotlin callers) — not Wave 4.

## Wave 3b QA gate — RESULT: passed (2026-10-24, release-owner reported)
- Scope: 12-item real-device checklist (8 ceremony items +
  4 GG18 additions: legacy-keyshare sign, setup, cancel
  revocation, abort no-orphan). All pass, incl. GG18
  backward-compat items 9–12.
- Devices/OS/runner: to be confirmed by QA runner (verbal pass
  received; models + OS versions pending fill-in).
- Merge gate satisfied; merge 3a → main (--no-ff), then
  3b → main (--no-ff, references 3a).

## Wave 4 close-out notes (F6 + F11 on `security/wave4-f6-f11`)
- Finding-number map (review proposal → tracker): empty-hash F23 → F24
  (F23 is the 3b-6d v2-file finding, Done — no duplicate created);
  no-timeout F24 → F25; timing F25 → F26; error-text-as-value F26 → F27;
  build-integrity F27 → F28. F23 was not dropped: it stays Done as filed.
- Flake (monitored, not a regression): one transient `go test ./tss/`
  FAIL under load during F11-1 validation; unreproduced across 5
  subsequent runs (F6 ×3, full ×2). If it recurs, capture the failing
  test name before rerunning.
- L5 window 600→1300: ceiling MEASURED (max verify distance 1162 on
  14-param GG18 send, +138 margin), not loosened. Property (all 25
  carry + verify tokens) unchanged; null guards only pushed text down.
- Emulator note: Small_Phone_API_35 on this host is arm64 — the ART-x86
  vs ART-ARM JNI concern is partially mitigated (real-device run still
  differs in drivers/thermal, not ISA).
- QA record: RESULT passed (2026-10-25, user-reported). 4 items —
  JNI null-arg on real Android ARM (typed error, no crash), setAPI
  file:// on real iOS (rejected), LAN ceremony on real WiFi
  (completes), transport-abuse approximation (clean fail + retry) —
  all pass. Device models/OS + runner name: pending fill-in by QA
  runner.

## B1 close-out notes
- Argon2id timing (production t=3/m=64MiB/p=1): 155 ms Mac arm64; 243-263 ms
  arm64 emulator (pure-Go build; x/crypto/argon2 has amd64 asm only, so ARM
  devices use the same portable path). Mid-range-phone estimate 300-600 ms.
  No param tuning needed. Real-device spot-check remains a nice-to-have.
- F7 gradle guard verified: debug configures without secrets; release without
  secrets fails with the exact message; release with secrets configures.
  android/release.properties is untracked, on-disk only, complete (4 keys).
- .sh resolution (open): signed-release.sh / generate-signed-bundle.sh are
  gitignored, so the set -euo pipefail + : "${VAR:?}" hardening is disk-only
  and will not reach CI via git. Options: (a) env-var-ize passwords and
  force-add the scripts (recommended; removes hardcoded secrets too);
  (b) mount via CI secret management; (c) document as a manual release step.
  Decision needed before calling F7-residual done.
- Legacy import UX: wrong-password-vs-corruption now reads
  "Wrong password or corrupted backup" for legacy content failures.

## v4.1.1 toolchain track (`security/v4.1.1-toolchain`, from main 84c54eaa)
- F29 (Go rebuild, Critical) Done 6515461f: go.mod toolchain go1.26.10,
  Dockerfiles pinned + checksummed, GOTOOLCHAIN=local; rebuilt + verified
  per-arch (3/3 .so `go version -m` = go1.26.10, iOS 786x strings, APK
  contains go1.26.10 on all 3 ABIs). libtss/Dockerfile deferred to libtss
  repo (submodule). Rebuild required: x509 compiled into the .so.
- F30 (Node 22.23.4, High) Done 35eb0106: Dockerfile Node 22.23.4+b8492284,
  engines>=22.23.4, .nvmrc, npm ci green, jest 752/1 baseline identical.
- F34 SKIPPED per user: manual GitHub release upload of .sha/.asc.
- F28-exp Done 7b263e7c: verify-native-artifacts.sh gains MIN_GO=1.26.10
  gate (.so via `go version -m` + all-ABIs-agree; iOS .a via strings >=
  floor); gate proven both directions (exit 1 on forged floor, PASS on
  revert); CI setup-go pinned 1.26 -> 1.26.10 + GOTOOLCHAIN=local in both
  workflows; RELEASE.md documents minimums + pre-release gate. No
  artifact-upload CI workflow exists on this track, so the script is a
  release-machine gate (stamp workflows live on Wave 5 branch).
- Version check: 4.1.1/72 already set everywhere (package.json, gradle,
  Xcode MARKETING_VERSION/CURRENT_PROJECT_VERSION); no bump commit needed.
- Full suite on this branch: Go -race (tss, dkls -short, nostrtransport,
  bbmtmobile tagged) green; jest 752 pass / 1 pre-existing fail (urBytesQr
  frames, same as baseline); tsc 32 pre-existing (baseline-identical);
  eslint 16 err / 169 warn in untouched files (track changes zero
  lintable sources — pre-existing by construction); JVM 47/47; F4
  harness PASSED; assembleDebug SUCCESS; xcodebuild Debug SUCCEEDED;
  :app:connectedDebugAndroidTest 11/11 on Small_Phone_API_35.
- Known non-blocker: root `connectedDebugAndroidTest` fails at
  :op-engineering_op-sqlite:mergeDebugAndroidTestNativeLibs (duplicate
  libc++_shared.so from op-sqlite vs react-android transforms) — third-party
  androidTest packaging conflict, no test failure; deterministic in this
  env, independent of branch state (track touches no gradle/deps files).
  App-module instrumented (the suite with the repo's tests) is 11/11.
- Track B verification (report only, no code on this branch):
  F31 CONFIRMED Medium — no fee cap: mempool /v1/fees/recommended ->
  RecommendedFees (btc.go:233) -> calculateFees (btc.go:1392) ->
  MpcSendBTCWithUTXOs estimatedFeeStr (btc.go:1191, parsed unbounded);
  only a 1 sat/vB floor exists. NEW finding, Wave 6+.
  F32 CONFIRMED High — trio LAN key = sha256(sessionID + "," + masterHost)
  (lan_crypto.go:9-13), both inputs public, no secret; anyone on LAN can
  derive + forge. NEW finding, Wave 6+ (protocol change, not v4.1.1).
  F33 CONFIRMED on main (pump decrypts via raw AesDecrypt, no tag check)
  but FIXED by Wave 5 F24b (ffeda6f5 lanPayloadHashValid) — no action,
  merge carries the fix.
  F5 NOT DONE — base-config cleartextTrafficPermitted="true" globally
  (network_security_config.xml:3, with tools:ignore); already tracked as
  F8 Open, no new row.
