# BoldWallet Security Note — Response to Recent Coldcard Seed Vulnerability

*August 2026*

You may have seen reports that some Coldcard hardware wallets generated
Bitcoin seed phrases with far less randomness than intended, allowing
attackers to recover private keys and steal funds.

We audited BoldWallet’s key-generation and signing stack in light of
this incident. Here is what we found, in plain terms.

## BoldWallet is not affected by this class of vulnerability.

Coldcard’s issue was a firmware bug that silently replaced a hardware
random-number generator with a weak software fallback. Seeds created
on affected devices could be guessed.

BoldWallet works differently. Your wallet does not rely on a single
device seed phrase. Instead, key material is created across your own
phones (2-of-2 or 2-of-3) using threshold cryptography (GG18 and
DKLs23). Every secret share and signing nonce is drawn from the
operating system’s cryptographic random number generator on Android
and iOS — the same secure source used by the platform itself.

We reviewed:

- Our GG18 library path (bnb-chain / BoldBitcoinWallet tss-lib)
- Our DKLs23 library path (libtss / NDKLs23)
- How BoldWallet generates session material on mobile

In all production paths that create key shares and signing nonces,
randomness comes from OS CSPRNG (Go `crypto/rand` and Rust `OsRng` /
`getrandom`). We found no Coldcard-style fallback to a weak PRNG, no
time- or device-ID seeded key generation, and no path that would let
an attacker recover your private key from public information alone.

## What this means for you

- Existing BoldWallet MPC wallets do not need to be rotated because
  of the Coldcard news.
- Spending still requires cooperation from your threshold of devices.
- No action is required for this specific issue.

We take reports like Coldcard’s seriously. When the industry finds a
new failure mode, we check whether it can apply to us — and we will
keep doing that. If we ever discover a fund-threatening issue in
BoldWallet, we will say so clearly and tell you what to do.

— BoldWallet Team
