# Dice User Guide

## Why dice?
Covers a weak or backdoored random generator on the ceremony phones. The same
sequence, typed on every phone, becomes the master chaincode. The phone's
random generator is not mixed in.

## How
1. On each phone, open Use dice rolls before setup starts.
2. Choose D6 (100 rolls: 5 dice × 20 throws), D20 (60), or a coin (256 flips).
3. Enter that sequence on every phone in the same order. Paste, tap, or scan
   the other phone's QR in the same room. The QR is not sent over Wi-Fi or Nostr.
4. Read the short code aloud. It should match. The app does not check it.
5. Start setup. The same sequence lets the secure computation finish. A
   different sequence, or dice on only some phones, makes setup fail later.

## Rules
- Film the ceremony if you want an audit. No cloud keyboard. Watch for
  someone reading over your shoulder.
- Write the rolls on paper. The encrypted backup already holds the chaincode.
- Skip leaves today's setup unchanged.

## Exports
- Account descriptors (Sparrow) contain the account chaincode, not the master
  chaincode.
- Do not share the raw rolls.

See DICE_CHAINCODE_SPEC.md and SECURITY_AUDIT.md section 7.
