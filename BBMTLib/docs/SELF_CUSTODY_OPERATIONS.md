# Self-Custody MPC Operations Runbook

This runbook applies to single-owner deployments where the app may use either 2-of-2 or 2-of-3 threshold policy.

## Pre-Release Security Gate

- Ensure CI is green for:
  - sensitive-log regression scan
  - pinned `libtss` revision checks
  - `go test ./tss/... ./dkls/...`
- Verify no payload-bearing error strings in MPC transport paths.
- Verify pre-agreement paths only accept live subscriptions and strict payload schema.

## Recovery Drill Matrix

Run all drills on test wallets before release.

| Mode | Scenario | Expected Result |
| --- | --- | --- |
| 2-of-2 | One device lost | Signing unavailable until recovery path completes; no silent keyshare bypass |
| 2-of-2 | One device reinstalled | Re-pairing or re-keygen path succeeds without exposing keyshare in logs |
| 2-of-3 | One device lost | Remaining two devices can still sign |
| 2-of-3 | One device offline + relay disruption | Signing either succeeds with healthy pair or fails closed with actionable error |

## Drill Procedure

1. Prepare fresh wallet/session in test environment.
2. Complete one successful sign flow baseline.
3. Simulate failure mode (lost device, reinstalled app, offline signer, relay interruption).
4. Attempt sign and record:
   - completion/failure outcome
   - error class
   - time to recover
5. Confirm logs contain no sensitive material (`keyshare`, `sessionKey`, `fullNonce`, `sighash`, raw payloads).
6. Repeat for both supported threshold modes (2-of-2, 2-of-3).

## Abort/Timeout Operations

- If repeated timeout/fragment-missing failures occur:
  - capture session ID prefix and retry counts
  - restart only affected session
  - rotate to alternate signer set where policy permits
- Escalate if nonce-reuse fatal error occurs; do not auto-retry the same signing context.

## Release Sign-Off

- Recovery drill evidence attached for both threshold modes.
- No open high-severity issues in logging, transport binding, concurrency, or supply chain controls.
- Runbook acknowledged by mobile and backend maintainers.
