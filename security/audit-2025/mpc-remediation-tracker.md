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
| F15b | Native-held shares: remove share_b64 from all JS-visible values | High | persistWalletKeyshare; getKeyshare; backupDecrypt; nostrJoinKeysign (Android) | Native-side persist; import-decrypt returns metadata only; metadata-only getKeyshare; Android nostrJoinKeysign loads natively | TBD | Open |
| F3 | Android ESP silently falls back to plaintext | High | BBMTLibNativeModule.kt:170 | DONE (Wave 2): typed fail-closed errors, StrongBox→TEE, security-crypto 1.1.0, UI surfacing, patch-package. No per-read auth (backgrounded reads) | TBD | Done |
| F4 | iOS Keychain item has no ACL | High | RNEncryptedStorage.m setItem | DONE (Wave 2): keyshare-scoped WhenPasscodeSetThisDeviceOnly, no per-read biometry (backgrounded/JS-polled reads; nobody locked out), patch-package, harness 7/7 | TBD | Done |
| F5 | nsec in JS heap + embedded in backup blob | High | screens/MobileNostrPairing.tsx:1230; dkls/keyshare.go:26 | nsec in Keychain/RNES only; opaque ref; exclude from export | TBD | Open |
| F8 | Global Android cleartext + ws/http allowed | High | network_security_config.xml:3 | Scope cleartext to loopback/link-local; block non-LAN ws/http | TBD | Open |
| F9 | Secrets cross bridge as strings; no zeroization | High | BBMTLibNativeModule.kt:160; BbmtBridge.mm:13 | Opaque handles; SecureBytes/memset+mlock; minimize copies | TBD | Open |
| F10 | Bridge sign/decrypt callable from any JS; clipboard exfil | High | services/TssProvider.ts:116; KeyshareInfoContent.tsx:605 | Origin pinning or per-call user token; remove secret clipboard | TBD | Open |
| F11 | No input validation at JNI/Go seams; FFI crashes | High | bbmtmobile/export_dkls.go:17; tss/common.go:465; mpc.go:1238 | Nil/length/caps checks; bound SecureRandom; nil-guard resp/req. Wave-3 scope MUST include new BbmtBackupEncrypt/Decrypt + JNI trampolines (added guard-less in B1) | TBD | Open |
| F6 | LAN decrypt-before-verify padding oracle | Med-High | BBMTLib/tss/mpc.go:1149 | Verify-then-decrypt; uniform observable; AEAD | TBD | Open |
| F12 | Prefix-match cancel + 15-min poison; no-confirm bridge cancel | High | tss/cancel.go:29,103; BBMTLibNativeModule.kt:505 | Exact-match cancel; per-session contexts/keys; confirm token | TBD | Open |
| F14 | SessionKeyHex inert; secrecy rests on long-term nsec | Med | tss/nostrtransport/config.go:49 | HKDF session key into AEAD or remove field (allowlist is DKG-pinned: signing_resolve.go:57) | TBD | Open |
| F13 | Background/kill: warning-only; replay memory is RAM-only | Med | services/mpcKeepAlive.ts:200 | Ceremony epoch or fresh session IDs post-death; persist seen-IDs | TBD | Open |

Fix waves: (1) F7+sweep. (2) B1. (3) F15,F3,F4. (4) F11,F6. (5) F12,F14. (6) F13.
Still owner-side: govulncheck, npm audit, gitleaks/trufflehog history, FROST/DKLs23 fork diff.

## Wave 1 — B1 (F1+F2+F16): DONE (merged c6d2613f). F7-residual fail-closed build: done.

## Wave 2 — F15 (partial) + F3 + F4: READY FOR REVIEW on `security/wave2-f15-f3-f4`.

See `security/audit-2025/wave2-pr-notes.md` for the full PR description,
bridge audit, failure matrix, and test evidence. F15b (native-held
shares) is the follow-up that actually closes plaintext-to-JS.

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
