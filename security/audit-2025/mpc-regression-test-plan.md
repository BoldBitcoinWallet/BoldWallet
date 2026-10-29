# BoldWallet regression test plan (write before patching; each fix lands with its test)

Wave mapping: Wave 1 (B1) = T1, T2, T3. Later waves map to the remaining cases.
Finding IDs (F1..F16) refer to the audit tracker in this directory.

T1. Tampered backup rejected (F1/F2). Flip one byte of a valid .share file -> import must fail closed.
   Mismatched pub_key label with valid share_b64 -> import rejected. Valid backup + correct password -> imports.
T2. KDF work factor (F1). Time password->key derivation; assert >100ms per guess; assert random salt header
   present and identical passwords produce different ciphertexts.
T3. Export gate enforces full policy (F16). passwordpassword1 (strength 3, isValid false) -> export button
   disabled. 12+ chars meeting all 5 rules -> enabled. Airgap: record QR stream, assert 6-digit PIN brute force
   is the only path and document capture window.
T4. Keystore fault injection (F3). MasterKey failure, KeyPermanentlyInvalidatedException,
   UserNotAuthenticatedException -> write THROWS on each path; assert no plaintext XML file exists after.
T5. Keychain ACL (F4). Dump item attrs: assert WhenPasscodeSetThisDeviceOnly + biometryAny; assert backup
   exclusion; lock device -> read requires auth.
T6. Bridge fuzz (F11). Null/empty/oversized/malformed base64/hex/JSON and negative ints into every @ReactMethod /
   RCT_EXTERN / //export entry (mpcSignPSBT, aesDecrypt, SecureRandom(-1, huge), fetchData, setAPI) -> clean
   typed errors, zero crashes. Relay DELETE failure injected -> no nil-panic (mpc.go:1238).
T7. Kill mid-ceremony (F13). SIGKILL during LAN and Nostr ceremonies -> restart either resumes cancelled state or starts a
   provably fresh session ID; assert no nonce/attempt-ID reuse against relay state.
T8. Prefix-cancel isolation (F12). cancelMpcSession("ab") must NOT cancel session "ab..."+suffix belonging to
   another flow; assert exact-match only. Overlapping sessions: start two, cancel one, other completes.
T9. Cancel auth (F12/F10). Non-UI JS context calling cancelMpcSession/sign without user token -> rejected.
T10. Heap scan post-export/sign (F15/F9). Frida/heap dump after import, sign, export -> no share_b64/nsec/sessionKey
    plaintext outside the encrypted blob; clipboard never contains secrets (F10).
T11. Oracle indistinguishability (F6). Relay-visible behavior for bad-pad vs bad-MAC must be identical
    (same HTTP traffic, same delete/keep outcome).
T12. Nostr peer binding (F14). Ceremony with peer npub outside keygen_committee_keys -> rejected at
    ResolveSigningSessionNostr; backup-derived nsec alone (no share) -> cannot join as committee member.
T13. Transport trust (F8). http:// mempool and ws:// relay URLs blocked or behind explicit override on Android;
    tampered GitHub-raw host list -> rejected (once signed).
T14. Release gate (F7). Release build with missing signing secrets -> hard failure, never debug fallback.
T15. Device integrity (F9). Rooted emulator / jailbreak / Frida present -> ceremony blocked or warned; no-sensor
    device -> explicit user opt-in, never silent true.
