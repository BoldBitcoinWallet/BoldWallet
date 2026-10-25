# Wave 6 — F20 design: native PSBT confirmation (for sign-off)

> **Status: IMPLEMENTED** on `security/wave6-f20-f35` (Go 818a7bb8,
> Android 6ef6726f, iOS 8bc7a0a7, JS 6db0e962, 1b native a5142b5a).
> Tracker F20 = Implemented, pending QA/merge. Two deviations from
> §2/§7 as designed: the sheet is the platform alert dialog
> (AlertDialog / UIAlertController) rather than a custom secure
> view, and the send binding excludes the network field (address
> prefixes encode it; the banner derives from the prefix).

## Problem (verified)

`ParsePSBTDetails` (BBMTLib/tss/psbt.go:665) parses natively, but its JSON
returns to JS and JS renders the confirmation (PSBTModal, pairing screens).
The 3b ceremony token binds (opClass, sessionID) — not content. A compromised
JS layer can display PSBT-A's details while the native side signs PSBT-B.
The token authorizes *a* signing ceremony, not *this* transaction. (F20, High.)

## Design

1. **Confirm natively, from the same bytes.** For PSBT sign ceremonies, the
   sign-class mint takes the PSBT natively (it already crosses for signing).
   Go parses it (`ParsePSBTDetails` logic reused), computes
   `psbtDigest = sha256(canonical PSBT bytes)`, and the native layer renders
   a confirmation sheet: every output (address, amount), fee, network.
   Nothing user-confirms is computed or formatted by JS.
2. **Bind approval to content.** User Confirm → OS biometric/device-credential
   prompt (existing mint path) → token issued with `psbtDigest` recorded.
   Cancel (or no screen lock, per F4/Q3 precedent) → typed reject, no token.
3. **Enforce at keysign.** Token-gated PSBT keysign wrappers recompute the
   digest of the PSBT actually being signed and require equality with the
   token's bound digest. Mismatch → typed `CEREMONY_AUTH_REQUIRED`-class
   error, fail-closed, token revoked. Class/session/TTL semantics unchanged.
4. **Scope v1:** PSBT sign paths (GG18 `mpcSignPSBT`/`nostrMpcSignPSBT` +
   DKLs equivalents — enumerated at build). **Phase 1b (same wave, if
   approved):** send-BTC flows (`mpcSendBTCWithUTXOs` family) confirm the
   Go-constructed unsigned transaction the same way (native summary +
   digest of the built tx), since JS supplies receiver/amount there.

## Alternatives rejected

- **Status quo (JS display):** the finding itself.
- **Digest binding without native UI:** binds bytes but the user still
  confirms blind — the spoof becomes undetectable rather than impossible.
- **Full native tx renderer (hardware-wallet style):** correct long-term,
  disproportionate for v1; the sheet shows all outputs + fee + network.

## UX

One native sheet before the existing biometric prompt: sheet Confirm →
biometric → ceremony starts. Copy: "Confirm transaction", outputs listed,
fee line, network name spelled out (Mainnet vs Testnet4 visually distinct).
No new JS screens; PSBTModal remains as a non-authoritative preview.

## Tests (acceptance)

- Spoof test: confirm digest of PSBT-A, attempt sign of PSBT-B → typed
  reject, no signature, token revoked (Go + JVM + Swift harness mirrors).
- No-confirmation → no token minted (malicious-JS simulation, L5 style).
- Digest determinism: same PSBT → same digest across platforms.
- Round-trip: confirmed PSBT signs and verifies on both platforms;
  GG18 + DKLs; existing ceremony suites and Phase 0 fixtures green.

## Open for sign-off

1. Sheet-then-biometric (two steps) vs fused sheet (Confirm triggers the OS
   prompt inline)? **Recommend fused** — one user gesture, same binding.
2. Phase 1b (send-BTC confirmation) in this wave or deferred? **Recommend
   in-wave** — same screen, same binding, closes the sibling path.
3. Testnet4 visual distinction: color + label, or label only? **Recommend
   label + icon** (color alone is an accessibility miss).
