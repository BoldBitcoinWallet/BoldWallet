# NIP-44 Encryption and Rumor/Seal/Wrap Pattern

This document explains the security scheme of performing transactions over NOSTR work in the BoldWallet TSS (Threshold Signature Scheme) implementation.
NIP-44 encryption and the rumor/seal/wrap pattern works

## Table of Contents

1. [Overview](#overview)
2. [NIP-44 Encryption Basics](#nip-44-encryption-basics)
3. [Rumor/Seal/Wrap Pattern](#rumorsealwrap-pattern)
4. [Complete Message Flow](#complete-message-flow)
5. [Implementation Details](#implementation-details)

---

## Overview

The BoldWallet TSS implementation uses a Multi-layer encryption pattern based on Nostr Improvement Proposals (NIPs):

- **NIP-44**: Encrypted Direct Messages using shared secret derivation
- **NIP-59**: Gift Wraps (Rumor → Seal → Wrap for TSS message transport) for additional privacy

This provides:
- **End-to-end encryption** between parties
- **Metadata privacy** (relays can't see sender/recipient relationships)
- **Forward secrecy** (one-time keys for wraps)
- **Authentication** (signed seals verify sender identity)

---

## Rumor/Seal/Wrap: Simplified Flowchart

Below is a step-by-step flowchart of the message pipeline, showing key details for each stage. 
The NIP-44 encryption step is shown as its own box with details.
Breaking the message into chunks is required due to the size limit of NIP-44 being 16KB per message.
Keysign is under the 16KB limit, but keygen is usually larger and needs chunking.

```plaintext

┌──────────────────────────────────────────────┐
│        Content (pre-agreed)                  │
├──────────────────────────────────────────────┤
│ - session_id                                 │
│ - chunk                                      │
│ - data (TSS payload)                         │
│ - tx_intent_hash: hash(address, amount, fee) │
│   (All parties must agree on this hash)      │
└──────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│                  Rumor                       │
├──────────────────────────────────────────────┤
│ Type:    Unsigned Nostr Event                │
│ Kind:    14 (Chat Message)                   │
│ Content: {                                   │
│    "session_id": "...",                      │
│    "chunk": "...",                           │
│    "data": "..."                             │
│ }                                            │
│ ID:      Calculated from JSON content        │
└──────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│                NIP-44 Encrypt                │
├──────────────────────────────────────────────┤
│ Purpose:  Shared secret encryption between   │
│           sender and recipient               │
│ Algorithm: XChaCha20-Poly1305 (NIP-44)       │
│ Keys:     Sender's nsec + Recipient's npub   │
│ Output:   Encrypted rumor JSON               │
└──────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│                   Seal                       │
├──────────────────────────────────────────────┤
│ Type:    Signed Nostr Event                  │
│ Kind:    13 (Sealed Direct Message)          │
│ Content: NIP-44 encrypted Rumor JSON         │
│ ID:      From signed/encrypted content       │
│ Signature: Sender's nsec                     │
└──────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│                   Wrap                       │
├──────────────────────────────────────────────┤
│ Type:    One-time Nostr Event                │
│ Kind:    1059 (Gift Wrap)                    │
│ Content: NIP-44 encrypted Seal               │
│ ID:      From one-time key                   │
│ Sender pubkey: Ephemeral/one-time key        │
└──────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│            Publish to Nostr Relay            │
└──────────────────────────────────────────────┘
                 |
                 |
                 ▼
┌──────────────────────────────────────────────┐
│ Recipient/s subscribed to Nostr relay         │
│ receive and process message                  │
└──────────────────────────────────────────────┘


```

**Summary**:
- **Rumor**: Unsigned, raw message chunk. Basic JSON chunk data. `Kind: 14`
- **NIP-44 Encrypt**: Uses sender's nsec and recipient's npub to encrypt Rumor using XChaCha20-Poly1305.
- **Seal**: Rumor encrypted (NIP-44) and signed. `Kind: 13`
- **Wrap**: Seal is encrypted again and wrapped in a one-time-use event (kind 1059), using a new ephemeral key for sender.

Each stage adds a layer of privacy, authentication, and unlinkability.

---

## Code References

- **Crypto functions**: `BBMTLib/tss/nostrtransport/crypto.go`
- **Messenger (sending)**: `BBMTLib/tss/nostrtransport/messenger.go`
- **Message pump (receiving)**: `BBMTLib/tss/nostrtransport/pump.go`
- **Client (publishing)**: `BBMTLib/tss/nostrtransport/client.go`

---

### Summary

The implementation is **fully compliant** with NIP-59 core requirements:
- ✅ Seals use kind:13 with empty tags
- ✅ Wraps use kind:1059 with recipient "p" tag
- ✅ Uses NIP-44 encryption
- ✅ Uses one-time keys for wraps

The differences are **extensions** that add TSS-specific functionality (chunking, session management) without violating the specification. The code correctly implements the rumor/seal/wrap pattern as specified in [NIP-59](https://www.e2encrypted.com/nostr/nips/59/).

---

## References

- [NIP-44: Encrypted Direct Messages](https://github.com/nostr-protocol/nips/blob/master/44.md)
- [NIP-59: Gift Wraps](https://www.e2encrypted.com/nostr/nips/59/)
- [NIP-19: bech32-encoded entities](https://github.com/nostr-protocol/nips/blob/master/19.md)

