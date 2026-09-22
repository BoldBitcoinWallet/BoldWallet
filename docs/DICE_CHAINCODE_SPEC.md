# DICE Chaincode Spec v2.2 (local only)

## 1. Scope
Opt-in dice-only master chaincode. No MPC lib changes (GG18/DKLs untouched).
Skip path = today byte-identical. The app does not compare peers and does not
abort before keygen when sequences differ.

## 2. Canonical encoding (local only, never transmitted)
- Per-set: `<sides>:<r1>,<r2>,...` e.g. `6:3,5,1,6,...`. Roll order is part of
  the sequence. A different order is a different chaincode.
- Per-set commitment (local, for the read-aloud code and the hash input):
  `commit_i = SHA256Hex('BOLD-DICE-COMMIT-v1||' + canonical_i)`.
- Canonical-all:
  `canonicalAllAscii = 'BOLD-DICE-v1|' + sorted(commit_i).join('|')`.

## 3. Isolation
Rolls, commitments, and the chaincode never go over LAN or Nostr: no `:dice1=`
handshake field, no `dice1:` fullNonce entry, no dice field on the connection
QR. Same-room copy is type, paste, or an optical QR (`BOLD-DICE-QR-v1|...`).
That QR is not a network message.

Each phone derives from the rolls entered on that phone. The UI says that a
different sequence, or dice on only some phones, makes MPC setup fail later.
The app does not enforce the match.

## 4. Dice-only derivation
- `finalChaincode = SHA256Hex('BOLD-DICE-CHAINCODE-v1||' + canonicalAllAscii)`.
- LAN seed and Nostr nonce stay session binders only. They are not hashed into
  the chaincode on the opt-in path.
- On device, the hash is `BBMTLibNativeModule.sha256`. Jest uses the ASCII
  SHA-256 fallback, which matches Go `DeriveDiceChaincodeHex`.
- Empty local sets: caller keeps the base chaincode unchanged.

## 5. 256-bit minimum (enforced on this phone)
- D6: 100 rolls. D20: 60 rolls. Coin: 256 flips.
- Use dice is blocked below the target.
- Rejections: empty, out-of-range, all-identical (≥6), sequential 1..N
  repeat (≥12), alternating two-face patterns (≥12).

## 6. Skip path
No dice on this phone → existing `{attemptId}:{seed}` / sessionID / sessionKey /
chaincode flow unchanged. Old wallets still load. Chaincode for addresses is
read from the encrypted keyshare blob. Plaintext metadata `chain_code_hex` stays
blank.

## 7. Receipt
After keygen, this phone may show rolls count, bits, dice type, and the first
8 hex characters of the local commitment. No canonical string, no chaincode,
no peer-match flag.

## 8. Explicit scope
Closes all-phones-RNG-predictable derivation when the same dice sequence of
≥256 bits is entered on every phone. Does not cover encrypted-backup theft,
live device extraction, keylogged entry, or a user who types different rolls.
A mismatch is visible only as a failed MPC setup.
