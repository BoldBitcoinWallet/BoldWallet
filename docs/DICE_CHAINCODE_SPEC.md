# DICE Chaincode Spec v2.2 (local only)

## 1. Scope
Opt-in dice-only master chaincode. No MPC lib changes (GG18/DKLs untouched).
Skip path = today byte-identical. The app compares a short public `dice_` +
6-hex tag and aborts setup on mismatch. Rolls, full commitments, and the master
chaincode stay local.

## 2. Canonical encoding (local only, never transmitted)
- Per-set: `<sides>:<r1>,<r2>,...` e.g. `6:3,5,1,6,...`. Roll order is part of
  the sequence. A different order is a different chaincode.
- Per-set commitment (local, for the read-aloud code and the hash input):
  `commit_i = SHA256Hex('BOLD-DICE-COMMIT-v1||' + canonical_i)`.
- Canonical-all:
  `canonicalAllAscii = 'BOLD-DICE-v1|' + sorted(commit_i).join('|')`.

## 3. Isolation
Rolls, full commitments, and the chaincode never go over LAN or Nostr. No
`:dice1=` handshake field and no `dice1:` fullNonce entry for setup. LAN /
Nostr may carry only `dice_` + 6 hex (a prefix of the local commitment).
Same-room copy is type, paste, or an optical QR (`BOLD-DICE-QR-v1|...`).
That QR is not a network message.

Each phone derives from the rolls entered on that phone. `assertMatchingDiceChecksums`
aborts when peer tags disagree.

## 4. Dice-only derivation
- `finalChaincode = SHA256Hex('BOLD-DICE-CHAINCODE-v1||' + canonicalAllAscii)`.
- LAN seed and Nostr nonce stay session binders only. They are not hashed into
  the chaincode on the opt-in path.
- On device, the hash is `BBMTLibNativeModule.sha256`. Jest uses the ASCII
  SHA-256 fallback, which matches Go `DeriveDiceChaincodeHex`.
- Empty local sets: caller keeps the base chaincode unchanged.

## 5. 256-bit minimum (enforced in the library)
- D6: 100 rolls. D20: 60 rolls. Coin: 256 flips.
- `deriveLocalDiceChaincode` rejects below 256 bits; the sheet also blocks.
- Rejections: empty, out-of-range, all-identical (≥6), sequential 1..N
  repeat (≥12), alternating two-face patterns (≥12), and (at length floor)
  low distinct-face / Shannon entropy floors.

## 6. Skip path
No dice on this phone → existing `{attemptId}:{seed}` / sessionID / sessionKey /
chaincode flow unchanged. Old wallets still load. Chaincode for addresses is
read from the encrypted keyshare blob. Plaintext metadata `chain_code_hex` stays
blank.

## 7. Receipt
After keygen, this phone may show rolls count, bits, dice type, and the first
8 hex characters of the local commitment. No canonical string, no chaincode.

## 8. Explicit scope
Closes all-phones-RNG-predictable derivation when the same dice sequence of
≥256 bits is entered on every phone. Does not cover encrypted-backup theft,
live device extraction, keylogged entry, or a user who types different rolls.
