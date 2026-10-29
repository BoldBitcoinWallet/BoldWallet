# BoldWallet MPC Wallet — Hardening Reference Report

## 1. Header

- **Release:** v4.1.1 (consolidated branch `security/hardenings`)
- **Date:** 2026-10-26
- **Scope:** BoldWallet React Native app, native bridge (Android/iOS), Go/gomobile MPC core (DKLs23 + GG18), keyshare backup and storage, LAN/Nostr ceremony transport, build and release toolchain.
- **Methodology:** red-team threat model (malicious co-signer, malicious LAN relay, malicious JS/npm, rooted device, stolen backup, compromised build pipeline), adversarial code review of every layer, native instrumentation (bridge-spy and heap checks), Go and JVM test gates, cross-version v4.1.0 ↔ v4.1.1 compatibility fixtures, and real-device QA checklists (release-owner executed).
- **Finding tracker:** `security/audit-2025/mpc-remediation-tracker.md` (canonical status), `security/audit-2025/mpc-regression-test-plan.md`, `security/audit-2025/wave2-pr-notes.md`, `security/audit-2025/wave3-design.md`, `security/audit-2025/wave6-f20-design.md`, `security/audit-2025/f32-analysis.md`, `security/audit-2025/build-notes.md`.

## 2. Executive Summary

This release is the consolidated remediation of a full security audit of the BoldWallet MPC wallet on `security/hardenings`: 6 implementation waves, a toolchain rebuild track, pre-ship fixes, and the F32/F39/F41b protocol track. The dominant themes were (1) keyshare plaintext crossing trust boundaries it never needed to cross, (2) unauthenticated encryption, unverified transaction/group-key parameters, and fail-open error paths, and (3) a shipped native library built with a known-vulnerable Go toolchain on both platforms.

**Totals:** 53 tracked items (F1–F42 + sub-rows + section items).

| Severity | Critical | High | Med-High | Medium | Low-Med | Low | Not rated* |
|---|---|---|---|---|---|---|---|
| Count | 7 | 23 | 2 | 11 | 1 | 4 | 5 |

\* process items, sub-items, and not-a-finding closures (F34, F24b, F14-B, F22, axios hygiene).

| Disposition | Count | Items |
|---|---|---|
| Done / Implemented in v4.1.1 | 42 | see §3 (Waves 1–6 + F32/F39/F41b) |
| Documented residual / non-feature | 3 | F26, F40, F42 |
| Not-a-finding / N-A (closed with evidence) | 3 | F7, F14-B, F22 |
| Skipped (manual process) | 1 | F34 |
| Partial (remainder deferred) | 1 | F5 |
| Accepted residual | 1 | F16b |
| Tracked watch item (CI-gated) | 1 | F41b |
| Deferred to v4.1.2+ | 1 | F8 |

**Top 3 highest-impact fixes**

1. **Ceremony authorization boundary (F10-bridge, F10-GG18, F15b-2, F19).** Before: any JavaScript in the app — including a compromised npm dependency — could call signing, decrypt, export, and key-generation bridge methods directly. After: every sensitive bridge method (25) requires a per-ceremony token minted only by an OS biometric/device-credential prompt, bound to operation class and session, ≤10 minutes, revoked on cancel. GG18 was tokenized with the same model (not removed — production holds live GG18 keyshares).
2. **Backup fund-diversion chain (B1: F1 + F2 + F16).** Before: backups were AES-CBC (no MAC, tamper undetectable) with a single SHA-256(password) KDF and a 3-rule password gate, and import never checked that the file's `pub_key` matched the share — a tampered backup silently diverted deposits to attacker addresses. After: AES-256-GCM + Argon2id, versioned format with pre-KDF parameter caps, import-time `pub_key`/ciphersuite binding, full 5-rule export policy. Legacy backups still import.
3. **Shipped vulnerable toolchain (F29).** v4.1.0 shipped `libbbmtmobile.so` built with Go 1.26.0 (forged-certificate x509 CVE class) — verified on Android (multi-arch) and iOS (`4.1.0 (71)` archive, strings `go1.26.0`). v4.1.1 rebuilds on Go 1.26.10 with a verification gate (`F28-exp`) that fails the build if any artifact is below 1.26.10.

**What remains open at v4.1.1 (explicit):** F8 (cleartext to LAN IPs — load-bearing for raw IP pairing), F5 remainder (native-held nsec handle), F16b (accepted — airgap 6-digit PIN), F26 (documented timing residual), F40 (documented non-feature — manual key rotation via new wallet), F41b (go-ethereum pin watch, gated by CI govulncheck), F42 (historical test keyshares in git history only, 0 at HEAD), F34 (artifact `.sha256`/`.asc` produced manually on the GitHub release). Wave 6 items (F20, F31, F32, F35, F36, F38, F39) are now implemented in v4.1.1.

**Trust-model delta (one paragraph).** After v4.1.1, an attacker needs a user-present, ceremony-bound authorization (or physical access plus a strong backup password) to cause the wallet to do anything security-relevant: JavaScript alone can no longer reach secret material or invoke signing; a stolen backup is an offline Argon2id brute-force problem, not a silent key swap; a LAN or Nostr relay can delay or drop messages but can no longer oracle, forge-accept, or suppress ceremonies invisibly; and the shipped binary is provably built with a patched toolchain and pinned dependencies. §4 details each attacker class.

## 3. Findings by Category

Commit references: fix commit where single, wave merge otherwise. Waves: W1 = B1 (`c6d2613f`), W2 (`2d634e91`), W3a (`9d52d812`), W3b (`88501dcd`), W4 (`84c54eaa`), W5 (`8d88ec95`), T411 = v4.1.1 toolchain track (`746bdd8d`), A = Phase A pre-ship fixes (`0195d75c`, `f6168bfc`, `655d66ce`), W6 = Wave 6 (`2dfb9278`) + F32/F39/F41b (`0188e10f`..`5b9693d2`) + F20/Testnet4 tightening (`6d674c50`), consolidated on `security/hardenings`.

### Cryptographic storage

| ID | Sev | Description | Disposition | Wave | Commit |
|---|---|---|---|---|---|
| F1 | Crit | Backup AES-CBC no-MAC, `SHA-256(pw)` KDF | Done — AES-256-GCM + Argon2id, versioned `BW2$` format, legacy import kept | W1 | `c6d2613f` |
| F1b | Med | KDF-param DoS via crafted v2 header | Done — caps (m≤256MiB, t≤10, p≤4) pre-KDF + rejection test | W1 | `c6d2613f` |
| F2 | High | Imported `pub_key` never verified vs group key | Done — binding assert in `ImportKeyshare` + all callers | W1 | `c6d2613f` |
| F3 | High | Android encrypted storage fell back to plaintext | Done — typed fail-closed, StrongBox→TEE, stable security-crypto | W2 | `2d634e91` |
| F4 | High | iOS Keychain item had no ACL | Done — `WhenPasscodeSetThisDeviceOnly` (keyshare-scoped), per-ceremony OS prompt (see F10-bridge); per-read biometry deliberately not implemented | W2/W3b | `2d634e91`, `88501dcd` |
| F15 | High | `ExportKeyShare` returned plaintext despite `SecureBytes` | Done (closed via F15b-1/F15b-2) | W2/W3 | `2d634e91` |
| F15b-1 | Crit | Shares crossed JS on persist/import-decrypt/read | Done — native-held envelope; metadata-only getters (bridge-spy verified) | W3a | `9d52d812` |
| F16 | Low | Export gate used 3-rule password check | Done — full 5-rule `isValid` gate | W1 | `b345e4e8` |
| F23 | Crit | v2 file backups silently empty on iOS / failed on Android | Done — utf8 envelope write + fail-closed stat guard; sniff-based import | W3b | `a6904d45` |

### Bridge and authorization

| ID | Sev | Description | Disposition | Wave | Commit |
|---|---|---|---|---|---|
| F9 | High | Secrets crossed bridge as strings; no zeroization | Done (subsumed: F15b-1/F15b-2 + F27) | W3 | `9d52d812`, `88501dcd` |
| F10-clipboard | High | Full keyshare JSON copied to clipboard | Done — metadata-only copy; dice copy disabled | W3a | `9d52d812` |
| F10-bridge | High | Signing/decrypt callable from any JS (35+ methods) | Done — 25 methods token-gated, class+session bound, OS prompt mint | W3b | `88501dcd` |
| F10-GG18 | Crit | GG18 sign/setup branches bypassed the token model | Done — all 6 branches tokenized, per-class prompts | W3b | `88501dcd` |
| F11 | High | No input validation at JNI/Go seams; FFI crashes | Done — 66 Go exports validated, JNI guards, `SecureRandom` bounded, `fetchData` fail-closed | W4 | `84c54eaa` |
| F15b-2 | Crit | Signing path exposed plaintext (ceremony flows) | Done — native-held shares; tokens gate signing | W3b | `88501dcd` |
| F18 | High | Android `nostrJoinKeysign` took keyshare JSON from JS (dead code, both platforms) | Done — methods removed after zero-caller verification | W3b | `88501dcd` |
| F19 | High | GG18 protocol-variant decision | Done (tokenized, not deprecated — live keyshares) | W3b | `88501dcd` |
| F21 | Med | Pairing nsec retained in JS state after finalize | Done — post-finalize clear + guardrail tests | W3b | `88501dcd` |
| F27 | High | Go errors resolved as JS values (error-text-as-value, 59 instances) | Done — reject-on-error both platforms; delta mirrored | W5 | `062a4c77`, `d35a2b4a`, `bd058acf`, `8069f370` |
| F27-GG18 | High | GG18 raw-resolve errors as signatures/handles | Done — iOS 6/6 fixed; Android verified already clean (correction recorded) | W5 | `062a4c77` |
| F37 | Med | Shared-file peek read whole file (OOM) | Done — 1 MiB cap, typed reject, 5 tests | A | `f6168bfc` |

### Transport

| ID | Sev | Description | Disposition | Wave | Commit |
|---|---|---|---|---|---|
| F6 | Med-High | LAN decrypt-before-verify padding oracle (delete/keep differential + 2 nil paths) | Done — uniform reject outcome (verify-then-decrypt is circular here: the tag covers plaintext; AEAD/EtM declined on backward-compat grounds, documented) | W4 | `84c54eaa` |
| F24 | Med-High | Empty-hash LAN messages skipped verification (fail-open) | Done — zero legit producers (producer census); empty/unknown → uniform reject | W5 | `ffeda6f5` |
| F24b | — | DKLs LAN pump verified nothing (no tag check) | Done — `h1`/`d1` gate at GG18 parity; failures keep-for-retry (no oracle split). Also closes Track-B F33 | W5 | `ffeda6f5` |
| F25 | Med | `http.DefaultClient` had no timeout (malicious-relay hang) | Done — bounded clients (5 s poll / 10 s unary, 10 sites) | W5 | `6da00e2f` |
| F26 | Low-Med | Timing residual after F6 (959 ns vs 25.6 µs reject medians) | Documented residual — indistinguishable vs passive observer; an active LAN adversary with ≥10k trials might distinguish. No code change | W5 | `2535430e` |
| F33 | High | DKLs LAN path had no payload-tag check (Track-B verification) | Done — confirmed present on main, fixed by F24b | W5 | `ffeda6f5` |
| F41 | High | ecies/go GO-2023-2380 — invalid-curve key recovery via relay-fed decrypt oracle (live duo path) | Done — ecies v2.0.8 + explicit go-ethereum v1.17.0 pin; govulncheck 0 reachable; wire format unchanged | A | `0195d75c` |

### Lifecycle and mechanism

| ID | Sev | Description | Disposition | Wave | Commit |
|---|---|---|---|---|---|
| F12 | High | Cancel was prefix-match with 15-minute poison | Done — exact-match cancel, explicit derived-session enumeration, token revocation intact | W5 | `02d1357b` |
| F13 | Med | Kill/restart lost replay memory; stale ceremonies | Done — freshness-by-construction (128+ bit fresh session IDs per ceremony; no persisted epoch, with recorded rationale) | W5 | `e71fd8ce` |
| F14 | Med | `SessionKeyHex` required but cryptographically inert | Done — Part A field removed (no migration; never read, never in keyshare JSON). Part B → Not-a-finding (below) | W5 | `f060f72f` |

### Build and release integrity

| ID | Sev | Description | Disposition | Wave | Commit |
|---|---|---|---|---|---|
| F28 | High | Gradle shipped prebuilt `libdkls_jni.so`; native fixes could silently not ship | Done — source-hash stamp + fail-fast gradle gate (option (a); (b)/(c) rejected with rationale) | W5 | `52b91b22` |
| F28-exp | High | No post-build Go-version gate | Done — `verify-native-artifacts.sh` MIN_GO gate + CI pin `1.26.10`/`GOTOOLCHAIN=local` + RELEASE.md | T411 | `7b263e7c` |
| F29 | Crit | Shipped native libs built with Go 1.26.0 (forged-cert CVE class) | Done — rebuild on Go 1.26.10; per-arch verification incl. in-APK `go version -m` | T411 | `6515461f` |
| F30 | High | Node 20.x EOL toolchain | Done — 22.23.4 (Dockerfile, engines, `.nvmrc`) | T411 | `35eb0106` |
| F34 | — | `.sha256`/`.asc` missing on release artifacts | Skipped — produced manually on the GitHub release per release process (owner decision) | T411 | — |
| (hygiene) | — | `axios` direct dep with 35 advisories, zero importers | Done — removed; audit 18→15, remainder documented-accept | A | `655d66ce` |

### Not-a-finding (closed with rationale)

| ID | Description | Closure evidence |
|---|---|---|
| F7 | Hardcoded signing passwords "on disk" | Closed — committed `.jks` is a dummy (cert mismatch with production); prod scripts/keys were never committed. Residual fail-closed build guard kept (`85a0e49d`, `d1b93a4b`). See Appendix B |
| F14-B | `nsec` inside exportable backup | Not-a-finding — `nsec` is one facet of a single secret bundle under the B1 envelope + F16 gate; splitting it breaks cross-device restore. Audit overreach (product decision) |
| F22 | Suspected secret material in ceremony logs | Not-applicable — traced to the repo's own sanitizer over-matching (`keyshare` substring in monikers); bypass audit found no secret material. `relay.go` `%+v` trim remains a hygiene note |

### Wave 6 & F32 additions (shipped in v4.1.1)

| ID | Sev | Description | Disposition |
|---|---|---|---|
| F20 | High | No native PSBT/send confirmation screen | Implemented — fused native PSBT & send confirmation sheets + strict SHA-256 content-digest binding (`contentBindingOk` rejects unbound tokens and mismatches, revoking session) (`818a7bb8`..`a5142b5a`) |
| F31 | Med | No fee-rate cap on the mempool path | Implemented — `MaxFeeRateSatVB = 10000` + `checkFeeVsAmount` bound (`524dc08d`) |
| F32 | High | Trio LAN key = `sha256(sessionID + "," + masterHost)` (public inputs) | Implemented — SAS-authenticated P-256 ECDH + Burmester-Desmedt ring round (`XOR` invariant check) + 6-digit compare code; legacy derivation retired (`0188e10f`) |
| F35 | High | Mempool hosts + Nostr relays fetched unsigned from GitHub raw | Implemented — pinned to a reviewed commit, size/entry bounds, strict `https:`/`wss:` hostname validation (`fa6ac142`). v4.1.1 pin was `b94706d4`; this branch pins signed `90a154c7` (`a88a35ce`) |
| F36 | Med | No root/jailbreak/Play Integrity/App Attest signals (biometry only) | Implemented — client-side native integrity signals + warn-and-confirm on extractive actions (`6a51776b`) |
| F38 | Low | WebView `originWhitelist: ['*']` (quotes marquee, escaped, nav-gated) | Implemented — locked to `['about:blank']` with file access disabled (`a031e07b`) |
| F39 | Med | No post-DKG group-key cross-check | Implemented — post-DKG group-key unanimity check across DKLs23 and GG18 (LAN + Nostr), fail-closed on mismatch (`bc19e176`, `324c8a6c`) |
| F40 | Med | DKLs23 key refresh unavailable (lib `tss_refresh_new` → `ProtocolMismatch`; manual rotation exists) | Documented non-feature — manual rotation via new wallet (`7d547475`) |
| F41b | Low | Transitive go-ethereum pin (v1.17.0) needs review at each ecies bump | Gated — `govulncheck` CI job in `bbmtlib-test.yml` (`5b9693d2`) |
| F42 | Low | Developer test keyshares in Nov–Dec 2025 git history | Documented — 0 tracked at HEAD, output dirs gitignored (`b1e1f688`) |

### Deferred to future work (v4.1.2+)

| ID | Sev | Description | Disposition |
|---|---|---|---|
| F5 | High | `nsec` in JS heap (backup half closed via F14-B) | Partial — F21 cleared post-finalize state; native-held nsec handle deferred to v4.1.2+ |
| F8 | High | Global Android cleartext + ws/http | Deferred — known residual in v4.1.1 release notes; IP literals cannot be domain-scoped (§5) |
| F16b | Med | Airgap export is a 6-digit PIN over SHA-256/CBC | Accepted residual — attack requires visual capture; longer PIN or PAKE deferred |

## 4. What an Attacker Can No Longer Do

**Stolen backup file.** *Before:* offline attack was cheap and silent — CBC without a MAC meant tampering was undetectable, the key was a single unsalted SHA-256 of the password, gating allowed weak passwords, and a substituted `pub_key` made the victim deposit to attacker addresses while holding a genuine share. *Now:* the backup is AES-256-GCM (any tampered byte rejects), keyed by Argon2id with per-file salt (≈250 ms/guess on-device, parameter caps reject crafted headers pre-KDF), import binds `pub_key` to the share's group key, and export requires the full password policy. Legacy CBC backups still import — with the known caveat that legacy tamper is only detectable as garbage output (documented, unavoidable without a MAC).

**Lost or stolen device.** *Before:* Android storage could silently fall back to plaintext prefs; the iOS keychain item had no protection class. *Now:* Android fails closed with typed errors (StrongBox→TEE, never plaintext) and iOS keyshares live in `WhenPasscodeSetThisDeviceOnly` items that do not migrate with backups. Ceremonies refuse to start on a device without a screen lock, and client-side device-integrity signals (root/jailbreak/Frida/emulator, F36) warn and require explicit confirmation before extractive actions. Residual: a determined attacker with the unlocked device and heavy instrumentation can hook client-side checks (full Play Integrity / App Attest requires a backend, which this app does not use).

**Malicious npm package / compromised JS.** *Before:* any JS — app code or dependency — could call 35+ bridge methods, copy the full keyshare to the clipboard, read share plaintext off the bridge, or display one transaction while signing another. *Now:* shares are native-held end-to-end (persist, import-decrypt, read, sign); JS receives handles and allowlisted metadata only; all 25 sensitive methods require a ceremony token that JS cannot mint (mint requires an OS-visible prompt); PSBT signing and BTC sends require a fused native confirmation sheet (parsed in Go for PSBTs, canonicalized for sends) that binds the token to the exact SHA-256 artifact digest (`contentBindingOk` rejects unbound sign tokens and any swapped payload, revoking the session) (F20, F20-1b); dynamic mempool/relay lists are pinned to a reviewed commit (`90a154c7` on this branch; `b94706d4` in the v4.1.1 notes) and strictly validated (F35); mempool fee rates are sanity-capped at `10,000 sat/vB` and bounded against the payment amount (F31); clipboard secret export is removed; bridge inputs are validated so malformed calls produce typed errors instead of panics or error-text-as-value exfil channels.

**Malicious LAN relay / LAN observer.** *Before:* crafted ciphertexts yielded a padding oracle via the delete/keep differential; empty-tag messages skipped verification entirely; trio LAN session keys derived from public `sha256(sessionID + "," + masterHost)`; unbounded HTTP clients could be hung forever; one-line prefix cancels killed unrelated sessions. *Now:* all reject classes are observably identical; empty/unknown tags reject (producer census proved no legit untagged sender); the DKLs pump verifies `h1`/`d1` tags; trio LAN keygen runs SAS-authenticated P-256 ECDH + a Burmester-Desmedt ring round (`XOR` invariant check) with a 6-digit compare code across all 3 devices (F32); clients time out (5 s/10 s); cancel is exact-match. A relay can still drop or delay messages (availability), but cannot distinguish, forge-accept, derive the trio session key, or poison. Residuals: F26 (timing, documented), F8 (cleartext HTTP transport to raw LAN IPs).

**Malicious build pipeline.** *Before:* gradle could ship a stale prebuilt `.so` while JNI sources said otherwise (this actually happened: F11's JNI fixes were initially tested against a stale binary), the shipped app contained Go 1.26.0, Node was EOL, and an unused HTTP library carried 35 advisories. *Now:* the `.so` carries a source-hash stamp that fails the build on mismatch, `verify-native-artifacts.sh` fails if any artifact is below Go 1.26.10 (both merge-gated and release-machine steps), CI pins Go/Node exactly and runs `govulncheck` on `BBMTLib` (F41b), `govulncheck` reports 0 reachable vulnerabilities (`ecies/go` v2.0.8 + `go-ethereum` v1.17.0, F41), and the unused dependency is gone. Residual: F34 artifact signatures are manual (process control, not automation); F41b (pin review duty).

**Malicious peer (GG18 co-signer / Nostr relay).** *Before:* GG18 signing/setup was the last untokenized path; errors from Go resolved as if they were signatures/handles; cancel-by-prefix could suppress a victim's ceremonies; divergent group keys after DKG went undetected until deposit. *Now:* GG18 is token-gated with operation-specific prompts, errors reject on both platforms, cancel is exact and revokes the ceremony token atomically, and post-DKG group-key unanimity is verified across DKLs23 and GG18 (LAN + Nostr) before any share is returned or persisted (`DKG_GROUP_KEY_MISMATCH` fails closed, while mixed-version ceremonies with older peers warn and proceed after timeout) (F39).

## 5. Residual Risks

Stated plainly — these remain after v4.1.1:

- **F8 (High-as-tracked, deferred) — cleartext HTTP to LAN IPs.** `network_security_config` cannot allowlist IP literals, and LAN pairing depends on cleartext `http://<LAN-IP>` (while MPC payloads themselves are ECIES- or ECDH/AES-encrypted and `h1`/`d1`-tagged). Full transport-level scoping needs runtime peer verification. Listed as a known residual in the v4.1.1 release notes.
- **F40 (Medium, documented non-feature) — no DKLs23 key refresh.** `libtss` returns `ProtocolMismatch` for DKLs23 (refresh is FROST-only). Share rotation is performed manually by creating a new wallet and moving funds.
- **F36 residual (Low-Med) — client-side integrity signals only.** Root/jailbreak/Frida/emulator detection runs locally on the device (`getDeviceIntegritySignals`) and gates extractive actions with a warning; a hooked device can spoof client-side checks, and hardware attestation (Play Integrity / App Attest) requires a backend server that BoldWallet does not have.
- **F41b (Low, CI-gated) — transitive pin maintenance.** F41 was resolved by an explicit `require github.com/ethereum/go-ethereum v1.17.0` overriding ecies v2.0.8's transitive v1.13.5, gated by a `govulncheck` CI job (`bbmtlib-test.yml`). Review the pin at every ecies bump.
- **F42 (Low, historical) — developer test keyshares in Nov–Dec 2025 git history.** 101 `gitleaks` hits in historical MPC test-output files; 0 files tracked at HEAD and output directories are gitignored.
- **F14-B (documented) — `nsec` inside the keyshare backup.** Deliberate: the backup is a single secret bundle under one envelope; a facet-specific warning would falsely imply differential sensitivity. Splitting breaks cross-device restore.
- **F16b (accepted) — airgap 6-digit PIN.** Attack requires capturing the animated QR *and* observing PIN entry (visual access). Longer PIN or PAKE deferred to v4.1.2+.
- **F26 (documented) — timing residual.** Reject paths differ by ~25 µs (panic/recover cost). Indistinguishable against a passive observer under LAN jitter; an active LAN-local adversary with ≥10k repeated trials could potentially distinguish. The `<50ms` test is a hang-check, not a timing proof.
- **F5 remainder (Partial) — pairing `nsec` in JS heap.** F21 clears it after finalize, but during pairing the `nsec` exists in JS. A native-held handle is deferred (v4.1.2+); the `nsec` is not the MPC share.
- **F34 (process) — artifact signatures are manual.** `.sha256`/`.asc` for v4.1.1 are produced and uploaded by the release owner on the GitHub release. No automation gates their presence.

## 6. Verification Evidence

Per wave (full detail in `mpc-remediation-tracker.md` §close-outs; regression cases in `mpc-regression-test-plan.md`; Wave 2 bridge audit in `wave2-pr-notes.md`):

- **Wave 1 (B1).** Tamper-byte rejection, wrong-password, legacy-import, and KDF-cap tests in Go; Argon2id measured 155 ms (Mac arm64) / 243–263 ms (arm64 emulator; ARM uses the portable path — same code phones run).
- **Wave 2.** F3 fault-injection (key-invalidated / not-authenticated → typed throw, no plaintext file); F4 keychain harness 7/7 against the real patched `RNEncryptedStorage.m`; patch-package verified on fresh installs.
- **Wave 3a.** L1 bridge-spy (11/11): known test share appears in zero recorded bridge messages across setup/import/persist/read/delete/migration; instrumented envelope 5/5 on `Small_Phone_API_35`; real-device QA passed (release-owner reported, 2026-10-24).
- **Wave 3b.** Token state-machine tests (JVM + Swift harness mirrors); L5 malicious-JS suite 15/15 over all 25 gated methods (unsigned, wrong-class, and wrong-session calls all fail closed); GG18 legacy-fixture end-to-end sign with independent ECDSA verification (`TestF19_LegacyGG18LoopbackKeysign`, 11.7 s, `-race` clean); 12-item real-device checklist (incl. GG18 items 9–12) passed (release-owner reported, 2026-10-24).
- **Wave 4.** F6 oracle tests (uniform DELETE observed across 4 failure classes; timing medians documented, not claimed constant-time; `-race` clean); F11 fuzz/validation suites (Go seam 6/6, JVM 47/47, instrumented 5/5); real-device QA 4/4 passed (2026-10-25): JNI null-arg on ARM Android (typed error, no crash), `setAPI file://` rejected on real iOS, LAN ceremony over real WiFi, tampered message fails cleanly.
- **Wave 5.** F28 stamp tamper proofs (C++ and Go source edits both fail the build with the re-run message); F12 exact-match tests (8, incl. poison-window and sibling isolation); F24/F24b tag tests; F27 forced-error tests (instrumented suite 16/16 on arm64 emulator); jest 758.
- **v4.1.1 track + Phase A.** `go version -m` shows `go1.26.10` on all 3 Android ABIs inside the built APK; iOS archives contain only `go1.26.10` strings; `verify-native-artifacts.sh` PASS; govulncheck `./...` = **0 reachable** (19–20 module-required not-called); Go `-race` full suites green (tss 65 s, dkls 235 s); `./gradlew test` green (141 tests across variants, 0 failures); instrumented `:app` 16/16; jest 763 (758 + 5 F37) with the single pre-existing urBytesQr frames failure (baseline-identical since before the audit waves); tsc 32 / eslint 16 errors, both baseline-identical in untouched files; binary growth +5% worst-arch vs the 15% budget.
- **Wave 6 + F32/F39/F41b (`security/hardenings`).** Phase-0 cross-version compatibility fixtures (`6d1bec8b`, v4.1.0 ↔ v4.1.1 DKLs shares, trio AES chunks, duo ECIES v2.0.3 ↔ v2.0.8 ciphertexts, legacy CBC backups) green under `-race`; F20/F20-1b Go `TestF20_*`, Kotlin `F20PsbtBindingTest` + `F20SendBindingTest` (including strict unbound-token rejection & revocation `6d674c50`), Swift `f20-harness` + `ceremony-harness` green, instrumented 16/16 on physical Android 13 (`2304FPN6DG`); F31 `f31_fee_cap_test.go` green; F35 `f35DynamicLists` 7/7 (including Testnet4 API list alignment); F32 `trio_ecdh_test.go` (8 Go exchange + trio DKG composition tests) + `lanMpcTransport.test.ts` (11 jest tests) green; F39 `f39_groupkey_test.go` + nostr/GG18 consensus tests green; F36 `deviceIntegrity` 8/8; F38 WebView tests green; `verify-native-artifacts.sh` PASS (69 JNI symbols, Go 1.26.10, `ecies/go` v2.0.8).
- **Device QA records.** Waves 3 and 4 QA were executed and reported passed by the release owner (2026-10-24 / 2026-10-25). Device models, OS versions, and runner names were not recorded in the tracker at the time and remain "pending fill-in" — the pass/fail record stands, the device inventory does not. Future waves should record all four fields.
- **Known verification gaps (honest).** (1) `xcodebuild test` *execution* was not run: the build phases fail under this shell's sandbox-exec profile (environmental; mechanism disjoint from all changes) and the sole iOS test is the stock React Native template asserting literal "Welcome to React" text — it has never been maintained and fails by design. `xcodebuild build` and `build-for-testing` both SUCCEEDED; details in `build-notes.md` §2. (2) Two transient environment failures occurred during Phase A — gradle offline cache misses and a corrupted `node_modules` caused by a pipe-masked `npm ci` exit code (see `build-notes.md` §1) — both were root-caused, fixed, and re-verified with unpiped exit codes. (3) FROST and DKLs23 *vendored fork diffs* vs upstream were never reviewed (owner-side, still open as a process item).

## 7. Future Work (v4.1.2+)

- **v4.1.2+ (platform/hygiene):** F8 (runtime peer verification to retire Android LAN cleartext base-config), F5 remainder (native-held `nsec` handle during pairing), F16b (longer airgap PIN or PAKE), F40 (DKLs23 key refresh if `libtss` adds protocol support), F41b (pin review at each `ecies` bump).
- **Long-term (out of scope, not queued):** GG18 deprecation path — (1) tokenize (done, 3b-6); (2) stop issuing new GG18 keyshares at DKG; (3) remove GG18 signing only after telemetry proves zero GG18 keyshares remain. Multi-quarter; not this year.
- No timelines are committed for any of the above.

## 8. Audit Trail

**Wave branches (final tips) and merges into `security/hardenings`:**

| Track | Branch tip | Lands on `security/hardenings` via |
|---|---|---|
| Wave 1 (B1: F1, F1b, F2, F16) | `security/b1-backup-crypto` | merge `c6d2613f` |
| Wave 2 (F15-half, F3, F4) | `security/wave2-f15-f3-f4` | merge `2d634e91` |
| Wave 3a (F15b-1, F10-clipboard) | `security/wave3a-f15b1-f10clip` | merge `9d52d812` |
| Wave 3b (F15b-2, F18, F10-bridge, F19, F21, F23) | `security/wave3b-f15b2-f18-f10` | merge `88501dcd` |
| Wave 4 (F6, F11) | `security/wave4-f6-f11` @ `0619ac20` | merge `84c54eaa` |
| Wave 5 (F28, F25, F12, F13, F14-A, F24, F27, F26) | `security/wave5-f12-f14-f13` @ `2535430e` | merge `8d88ec95` |
| v4.1.1 toolchain (F29, F30, F28-exp) | `security/v4.1.1-toolchain` @ `ec5421ae` | merge `746bdd8d` |
| Phase A pre-ship fixes (F41, F37, axios) | `feature/hardenings` | `0195d75c`, `f6168bfc`, `655d66ce` |
| Wave 6 (F20, F31, F35, F36, F38, F39, F42) | `security/wave6-f20-f35` @ `c1f6ce0a` | merge `2dfb9278` |
| F32 + F39-GG18 + F40 + F41b + F20/Testnet4 polish | `security/f32-trio-ecdh` → `security/hardenings` | `0188e10f`..`6d674c50` |

**Consolidation:** `security/hardenings` aggregates the entire delta since `v4.1.0` (`92362c6b`): Waves 1–6, Testnet4 migration (`0092854c`), v4.1.1 toolchain rebuild (`746bdd8d`), Phase A pre-ship fixes, F32/F39/F41b, F20 strict unbound-token rejection + Testnet4 API list alignment (`6d674c50`), and final documentation sync.

**Release & Tagging:** Branch merges, `v4.1.1` tag management, and remote pushes are managed directly by the release owner from `security/hardenings`.

**Source-report gap disclosure:**

> The original audit report (`mpc-wallet-security-report.md` + layer files) was not preserved in this repository. Findings F1–F41 represent the canonical tracker state. Reconciliation was performed against the review correspondence and re-verified against source. Where tracker numbering diverges from the original audit numbering, see Appendix A.

## Appendix A — Original Audit → Current Tracker Mapping

Numbering shifted through three independent collisions (not a single swap). Review-proposal IDs came from the external review correspondence; tracker IDs are canonical.

| Original reference | Current tracker | Source |
|---|---|---|
| Review F23 (empty-hash) → F24 | F24 | Tracker close-out (F23 taken by 3b-6d) |
| Review F24 (timeout) → F25 | F25 | Wave 4 collision shift |
| Review F25 (timing) → F26 | F26 | Wave 4 collision shift |
| Review F26 (error-text) → F27 | F27 | Wave 4 collision shift |
| Review F27 (build integrity) → F28 | F28 | Wave 4 collision shift |
| Track B "F5" (cleartext check) | F8 (tracker F5 = nsec, different finding) | v4.1.1 section + cedab49b |
| User-notes F8 (GitHub raw) | F35 (tracker F8 = cleartext) | Reconciliation section |
| Original-audit F9 (device integrity) | F36 (tracker F9 = bridge strings) | Review correspondence + reconciliation |
| F10 → clipboard/bridge/GG18; F15 → F15b-1/2; F14 → A/B; F16 → F16b; F27 → GG18; F24 → F24b; F28 → F28-exp | sub-rows | Tracker rows (splits, not renames) |
| F29/F30/F33/F34 (Track A/B IDs, no table rows) | v4.1.1 section dispositions | Tracker section |

## Appendix B — Findings Closed as Not-Applicable

- **F7 — hardcoded signing passwords.** Verification: the committed `.jks` is a dummy whose certificate does not match the production keystore; production scripts and keys were never committed (owner-confirmed against history). Closed. A fail-closed release-build guard remains as defense (`d1b93a4b`, `85a0e49d`).
- **F14-B — `nsec` in exportable backup.** Verification (product): the `nsec` is one facet of the keyshare secret bundle, protected uniformly by the B1 envelope (AES-256-GCM + Argon2id) and the F16 export gate. Splitting it out breaks cross-device restore (a restored share would have no peer identity). A facet-specific warning would falsely imply differential sensitivity. Not-a-finding; audit remediation was overreach.
- **F22 — suspected secret material in logs.** Verification: the two flagged lines are the repo's own sanitizer (`sanitizeLogMessage`) redacting the word "keyshare" in party monikers (`p1`/`p2`, non-secret). A bypass audit of raw `log.Printf` sites found only session/participant/message IDs and already-encrypted transport bodies. No secret material. Not-applicable (sanitizer over-match, by design).
- **F33 — DKLs LAN path checks no tag.** Verification: confirmed present on `main` (pump decrypted via raw `AesDecrypt` with no tag verification), then confirmed fixed by Wave 5 F24b (`ffeda6f5`, `lanPayloadHashValid` + `VerifyLANPayloadTag`/`VerifyLANPayloadDigest` at GG18 parity). No separate fix was needed on the v4.1.1 track; the Wave 5 merge carries it.



