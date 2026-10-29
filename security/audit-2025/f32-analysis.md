# F32 analysis: trio LAN session key derived from public values (decision required)

> **Status: IMPLEMENTED (Option A — SAS-authenticated P-256 ECDH + Burmester-Desmedt ring exchange)** in commit `0188e10f`, consolidated on `security/hardenings`. Public `sha256(sessionID + "," + masterHost)` derivation is retired (`TRIO_LEGACY_KEY_REFUSED`); mixed-version trio keygen with pre-ECDH peers fails closed (`TRIO_PEER_OUTDATED`).

## Verified facts

- `BBMTLib/tss/lan_crypto.go:10` — `DeriveLANSessionKey(sessionID, masterHost)`
  returns `sha256(sessionID + "," + masterHost)`. No secret input.
- Both inputs are public on the LAN:
  - `sessionID` travels in the pairing handshake payload
    (`screens/MobilesPairing.tsx:878`: `` `${attemptId}:${sessionSeed}` `` —
    attempt IDs are also relay-visible; `seenLanAttemptIds` dedupe).
  - `masterHost` is the LAN IP/host both devices (and any LAN
    observer) know — it is the relay address.
- The derivation is mirrored in JS (`services/lanMpcTransport.ts:57`:
  `sha256([sessionID, masterHost].join(','))`) and as a Go fallback
  for legacy callers (`BBMTLib/dkls/lan.go:109`,
  `normalizeLANTransportKeys`). Any fix must change all three
  consistently.
- Scope is trio-only. Duo uses ECIES (`encKey` = peer pubkey,
  `decKey` = local privkey — secrecy from the private key, correct).
- The association channel itself is LAN-clear: discovery on port
  55055, handshake payload, and the dice checksum tag
  (`diceChecksumTag`) are all exchanged over / derived from public
  values. There is no out-of-band secret today — only an
  out-of-band *comparison* (user compares dice tags/codes on two
  screens they both hold).

## Impact assessment (what it is and is not)

A LAN-local attacker who observes one handshake derives the trio
AES key and can decrypt and forge trio LAN MPC messages.

What that yields:

- Protocol metadata confidentiality loss (commitments, ZK proofs,
  partial signatures, timing/shape).
- Arbitrary message forgery → ceremony DoS, and a surface for
  protocol-level attacks (malicious-contribution class).

What it does NOT directly yield:

- Key shares. DKG and signing contributions carry proofs verified
  by the counterparty device (the DKLs/FROST transcript checks the
  audit verified); a forged contribution fails verification and
  aborts the ceremony rather than extracting the peer's share.
  Share theft via this key alone would require a protocol-level
  break on top of the transport break — two independent breaks,
  not one.

So the transport key is defense-in-depth over an already
peer-verified protocol channel — not the sole control. The
original High assumed the key guards shares directly; the
mechanism shows it guards metadata availability/integrity, with
share impact only via a second, protocol-level break.

## Why there is no small fix

A secret key over a fully observed channel with no PKI and no
pre-shared secret is the key-exchange impossibility: any value
both honest devices compute from public inputs, the observer
computes too. The pairing association (discovery, handshake,
dice tag) is itself public-derived, so "bind the dice tag" adds
no secrecy — only session confirmation (which it already gives).

Any real fix changes the wire or the UX, and any version that
still interops with old versions is downgradeable by a MITM
forcing the legacy derivation. There is no backward-compatible
secret — this is the compat analysis the plan called for.

## Options

**A. SAS-authenticated ECDH (the real fix).** Each device
generates an ECDH keypair, exchanges pubkeys over the LAN,
derives the session key, and shows a short authentication string
(first N digits of the transcript hash) on both screens; the
ceremony proceeds only after the user confirms the codes match
on both devices (compare UX already exists for dice tags).
Cost: new crypto round + relay message types + pairing-screen
UX on both platforms + mixed-version story (old versions cannot
do it — old↔new LAN ceremonies either fail or run unchecked,
both need a product decision). Breaks the Phase-0 cross-version
matrix for LAN until re-proved. Estimated: multi-day protocol +
UX work, plus real-device QA of the compare flow.

**B. ECIES-ify trio (per-recipient encryption with the existing
device keypairs).** Reuses the duo key material; each broadcast
becomes N encryptions with per-recipient addressing on the
relay. Same compat break as A, plus relay addressing changes
and 2–3x message volume. No UX cost, but larger transport
surgery than A for weaker authentication (still no MITM
detection without a compare step).

**C. Accept as documented residual, re-rate Medium.** Record:
trio LAN key is public-derived; threat is a LAN-local active
attacker; impact is metadata/DoS plus a second-break requirement
for share impact; revisit trigger (revisit if trio is ever used
beyond same-user same-LAN pairing, or if a protocol-level
forgery impact is demonstrated). Zero compat risk, zero code
churn. Cost: honesty in the report.

## Recommendation

C, with A parked as the follow-up if LAN pairing ever leaves
the same-user threat model. Reasoning: the practical exploit
requires the attacker on the victim's LAN during a pairing
ceremony between two devices the victim holds and is looking
at (the dice/code compare step is already a human-attended
moment — a forgery that breaks the ceremony is *visible* as a
failed pairing, not a silent theft). The MPC layer's own
verification converts forgery into abort. That is a Medium:
real, local, non-silent, and gated behind a second break for
fund impact.

## Decision required (do not implement without sign-off)

1. Re-rate F32 to Medium and close as documented residual (C)?
2. Or authorize A (SAS/ECDH) as Phase 3b with its compat break
   and UX cost?
3. Or authorize B?

F32 stays Open in the tracker until this is decided. F39
(LAN + nostr DKLS cross-check) is implemented independently of
this decision and does not prejudge it.
