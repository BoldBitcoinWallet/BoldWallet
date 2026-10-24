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
| F15b-2 | Native-held shares: ceremony flows (3b) | Critical | signing methods; nostrJoinKeysign ×2 | Token params on DKLs signing; F18 removal; GG18 carved to F19 | TBD | In Progress (security/wave3b-f15b2-f18-f10) |
| F18 | nostrJoinKeysign takes keyshare JSON from JS on BOTH platforms; dead from JS | High | BBMTLibNativeModule.kt:741; BBMTLibNativeModule.swift:927 | REMOVE both bridge methods in 3b (dead code mitigates reachability, not severity — any JS can call them today) | TBD | In Progress (security/wave3b-f15b2-f18-f10) |
| F19 | GG18 protocol-variant decision (deferred, post-Wave-3) | High | mpcTssSetup; nostrMpcTssSetup; GG18 signing ×4 | Decide: migrate GG18 (setup A1/A2 plaintext reachable via opt-out pref; signing untokenized) to handles, or deprecate new GG18 keygen. A6/A7/envelope stay backend-agnostic (no GG18 import regression) | TBD | Open (deferred) |
| F20 | No native PSBT-confirmation screen (ceremony prompt summary is JS-supplied/spoofable) | High | §6.4 wave3-design | Native screen parsing destination/amount from PSBT bytes at signing time | TBD | Open (post-Wave-3) |
| F21 | Pairing nsec returned to JS in full, retained in state after finalize (not the MPC share; separate from F15b) | Med | screens/MobileNostrPairing.tsx:1240,478,1242,1891 | Clear localNsec state + pendingKeyshareRef.partyNsec after ensureNostrKeyshareStored succeeds; long-term native-held nsec handle (F5 scope) | TBD | Done (3b first commit; guardrail __tests__/f21PairingNsec.test.ts 3/3; dereference, not heap wipe — disclosed) |
| F3 | Android ESP silently falls back to plaintext | High | BBMTLibNativeModule.kt:170 | DONE (Wave 2): typed fail-closed errors, StrongBox→TEE, security-crypto 1.1.0, UI surfacing, patch-package. No per-read auth (backgrounded reads) | TBD | Done |
| F4 | iOS Keychain item has no ACL | High | RNEncryptedStorage.m setItem | DONE (Wave 2): keyshare-scoped WhenPasscodeSetThisDeviceOnly, biometry → 3b ceremony auth (per-ceremony OS prompt; item class stands), patch-package, harness 7/7 | TBD | Done |
| F5 | nsec in JS heap + embedded in backup blob | High | screens/MobileNostrPairing.tsx:1230; dkls/keyshare.go:26 | nsec in Keychain/RNES only; opaque ref; exclude from export | TBD | Open |
| F8 | Global Android cleartext + ws/http allowed | High | network_security_config.xml:3 | Scope cleartext to loopback/link-local; block non-LAN ws/http | TBD | Open |
| F9 | Secrets cross bridge as strings; no zeroization | High | BBMTLibNativeModule.kt:160; BbmtBridge.mm:13 | Opaque handles; SecureBytes/memset+mlock; minimize copies | TBD | Open |
| F10-clipboard | Secret clipboard writes (full keyshare JSON, dice rolls) | High | KeyshareInfoContent.tsx:605; DiceEntropySheet.tsx:604 | Metadata-only copy (npub/pub_key/suite); dice copyDisabled; clipboard-after-export tests | TBD | Green (3a-5 evidence below; unmerged on security/wave3a-f15b1-f10clip) |
| F10-bridge | Bridge sign/decrypt callable from any JS | High | services/TssProvider.ts:116 (62 native methods) | Ceremony tokens (3b); setAPI/fee allowlist; dead-oracle removal in 3a; keypair generators retained + token-gated (B20–B21, OS-visible prompt) — acceptance, not removal | TBD | In Progress (security/wave3b-f15b2-f18-f10) |
| F11 | No input validation at JNI/Go seams; FFI crashes | High | bbmtmobile/export_dkls.go:17; tss/common.go:465; mpc.go:1238 | Nil/length/caps checks; bound SecureRandom; nil-guard resp/req. Wave-3 scope MUST include new BbmtBackupEncrypt/Decrypt + JNI trampolines (added guard-less in B1) | TBD | Open |
| F6 | LAN decrypt-before-verify padding oracle | Med-High | BBMTLib/tss/mpc.go:1149 | Verify-then-decrypt; uniform observable; AEAD | TBD | Open |
| F12 | Prefix-match cancel + 15-min poison; no-confirm bridge cancel | High | tss/cancel.go:29,103; BBMTLibNativeModule.kt:505 | Exact-match cancel; per-session contexts/keys; confirm token | TBD | Open |
| F14 | SessionKeyHex inert; secrecy rests on long-term nsec | Med | tss/nostrtransport/config.go:49 | HKDF session key into AEAD or remove field (allowlist is DKG-pinned: signing_resolve.go:57) | TBD | Open |
| F13 | Background/kill: warning-only; replay memory is RAM-only | Med | services/mpcKeepAlive.ts:200 | Ceremony epoch or fresh session IDs post-death; persist seen-IDs | TBD | Open |

Fix waves: (1) F7+sweep done. (2) B1 done. (3) F15(partial→F15b),F3,F4 done. Wave 3a = F15b-1+F10-clip (GREEN, unmerged); Wave 3b = F15b-2+F18+F10-bridge+F4-auth; Wave 4 = F11+F6; then F12,F14; F13. F19/F20 deferred; F21 open (nsec JS-retention, non-blocking for 3a).
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

## Wave 3b — F15b-2 + F18 + F10-bridge + F4-auth: IN PROGRESS on `security/wave3b-f15b2-f18-f10`.

Sequence: F21 (Done, first commit) → 3b-1 token core →
Table B gating → F18 + A12 → cancel/F4 → L5 tests.
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
