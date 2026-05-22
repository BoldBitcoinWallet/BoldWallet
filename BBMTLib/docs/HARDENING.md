# Native & MPC flow hardening

## Defaults (production and dev)

All hardening is **on** unless you opt out:

| Flag | Default |
|------|---------|
| `safeCancel` | on |
| `nostrCancelNoopOk` | on |
| `cancelTelemetry` | on (`[mpcCancel]` console logs) |

No env vars required for release builds.

## Opt-out

| Env | Effect |
|-----|--------|
| `HARDENING_OFF=1` or `HARDENING=0` | Disable everything |
| `HARDENING_SAFE_CANCEL=0` | Disable idempotent cancel only |
| `HARDENING_NOSTR_CANCEL_NOOP_OK=0` | Treat inactive Nostr cancel as error |
| `HARDENING_CANCEL_TELEMETRY=0` | Disable cancel console logs |

## Build

```bash
cd BBMTLib && ./build-all.sh
cd .. && npx react-native run-android   # or run-ios
npm run test:hardening
npm run verify:native
```

## Spend / sign (LAN and Nostr)

- **Wallet setup keygen** may be duo or trio (3 devices).
- **Send BTC and PSBT co-signing** are always **duo** (exactly two online signers), including 2-of-3 wallets where each phone picks one peer.
- **LAN join-before-start**: peer `fetchData` waits for a valid session payload (send: amount+fees; PSBT: identity hash).
- **Nostr send session**: `sessionFlag = sha256(signingNpubs, amount, receiver)` — not wallet balance, not full committee list.

## Cancel API

`TssProvider.cancelNostrMpc()` / `cancelMpcSession()` return `MpcCancelResult`:

- `cancelled` — native cancel invoked
- `noop` — no active Nostr operation
- `already_requested` — duplicate Abort tap
- `unavailable` — native lib not loaded

**Nostr abort cooldown:** After abort, wait **15 seconds** before starting another Nostr send/PSBT/keygen flow. Native `CheckNostrMpcCanStart` enforces this; JS shows `Please wait` if the user retries too soon. Stale canceled contexts are not reused for pre-agreement.
