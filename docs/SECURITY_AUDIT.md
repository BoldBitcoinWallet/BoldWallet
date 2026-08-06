# Independent Security Audit — Bold Bitcoin Wallet

**Auditor:** Principal Security Engineer, Tier-1 blockchain security firm (independent engagement)
**Target:** Bold Bitcoin Wallet — seedless threshold-signature Bitcoin wallet (Android / iOS)
**Commit:** `ac9ceeb8c408c4dc221cae2d9c623338f11073bf`
**Audit date:** 2026-06-15
**Companion document:** `k3-audit.md` — working risk-model notes supporting the scoring in §2 and the scenario analysis in §4.
**Method:** Single-snapshot, zero-trust, evidence-based review of the codebase as committed. No prior audit state is referenced; all claims trace to source, configuration, or documented behaviour.

---

## 1. Executive Summary

BoldWallet is a seedless multi-party computation (MPC) wallet for Bitcoin: keys are *never* materialised as a single private key, and no recovery phrase exists. Instead, 2-of-2 or 2-of-3 threshold signature schemes (DKLs23 in Rust, GG18 in Go) distribute signing authority across independent devices. This architecture is fundamentally sound and, in several dimensions, *structurally superior* to the alternatives this audit was motivated to compare against.

**The primary question of this engagement — "can a Coldcard-class RNG failure compromise BoldWallet?" — is answered with a clear no.** No production path in the codebase contains a deterministic fallback, a weak entropy source, a seedable RNG, or an RNG injection point. Every secret share, signing nonce, OT seed, commitment salt, Paillier safe-prime, and ephemeral key derives from the operating system CSPRNG. The only deterministic RNG in the entire tree is `cfg(test)`-gated in Rust and is structurally unshippable. The single custom entropy path in the Go tooling was found to be a raw `/dev/urandom` reader with unchecked short-read and swallowed errors; it has been replaced with `crypto/rand` with full-read assertion and loud failure, and the tooling's constant-chaincode fallbacks were removed. (Dev/test CLI tooling only — never linked into the mobile apps.)

**Key strengths**
- **Threshold key generation** — a single compromised device yields zero signing power; in 2-of-3 mode it yields zero liveness impact either.
- **No single point of entropy** — key material is the joint function of *independent* CSPRNG contributions; one honest device suffices for security.
- **No RNG injection surface** — mobile APIs (Go/JNI/UniFFI/JS) accept no seeds, entropy, or RNG objects; the GG18 fork hardwires `crypto/rand` and BBMTLib never calls `SetRand`/`SetPartialKeyRand`/`SetSessionNonce`.
- **Fail-stop entropy handling** — `MustGetRandomInt` panics on entropy failure rather than degrading; `io.ReadFull`/`rand.Read` errors are propagated and, in all production call sites, handled.
- **Secret-share storage** — shares persist in iOS Keychain / Android Keystore-backed EncryptedSharedPreferences via `react-native-encrypted-storage`; signing reads shares natively without crossing the JS bridge.
- **Encrypted P2P transport** — Nostr and LAN paths use ECIES and application-layer encryption; relay operators are untrusted.
- **Double-device transaction confirmation** — both co-signing devices independently display the full transaction details (inputs, outputs, amounts, addresses) before signing; the user must explicitly approve on *each* device. A compromised device cannot silently sign: the second device's confirmation screen is independently rendered from the PSBT, not from the first device's UI.

**The single most critical residual risk** is not cryptographic but **human-behavioural: UI deception / transaction substitution**. If one device is fully compromised, malware can display a legitimate-looking transaction while submitting a different PSBT for co-signing. The model mitigates this — the second device independently displays and confirms transaction details — but the mitigation's effectiveness depends on the user actually verifying the second screen. This risk is inherent to the multi-device model, not a defect in the cryptography, and is actively *reduced* relative to single-device wallets (there, a compromised phone silently signs anything).

**Verdict: Ready for production — with the following deployment conditions:**

1. Default to **2-of-3** for users who can maintain a second (or third) device, per availability and UI-deception posture.
2. Maintain the existing **second-device confirmation UX** as a mandatory flow, and treat any change that weakens it as a release blocker.
3. Address the open GG18 `sessionNonce` binding item (BWL-001) in a future protocol revision; it is a hardening item, not an exploitable defect.
4. Keep the supply-chain posture tight: pinned forks, local `replace` directives, and revision-pinned native artifacts (BWL-008).

---

## 2. Risk Scoring & Methodology

### 2.1 Scale

Scores are on a **0–10 "exploitability in the real world" scale**, where:

- **0** — no realistic attack path exists under the stated assumptions;
- **1–3** — no known defect; residual risk is structural or depends on implausible preconditions;
- **4–6** — a realistic attack path exists requiring moderate attacker capability or user error;
- **7–9** — an attack is feasible for commodity malware/skilled individuals;
- **10** — actively exploited in the wild today (e.g., the Coldcard PRNG fallback class).

Each score is computed as: enumerate attack paths → estimate likelihood (attacker capability × precondition probability) → weigh consequence (fund loss, privacy loss, availability) → map to the scale. Evidence for each path is cited.

### 2.2 Score A — Mass-compromise / supply-chain risk (affects all users)

| # | Attack path | Precondition | Consequence | Likelihood |
|---|-------------|--------------|-------------|------------|
| A1 | Broken/backdoored OS CSPRNG silently degrades keygen | OS-level failure on *all* users' devices simultaneously (must affect both keygen devices, which are independently provisioned) | Total fund loss | Extremely low; Go `crypto/rand` is SP 800-90A / getrandom-backed and never falls back to a weaker source; Rust uses `getrandom`/`OsRng` |
| A2 | Deterministic RNG reachable in production | Must be compiled into shipped code | Total fund loss | Impossible by construction: the only deterministic RNG is `cfg(all(test, feature = "insecure-rng"))`; no build enables it; `security-release-gate.sh` blocks it; FFI exposes no seed parameter |
| A3 | RNG injection / seeded session | Attacker must pass entropy into a mobile API | Total fund loss | Impossible by construction: full exported surface (Go, JNI, UniFFI, JS) accepts no RNG/seed/entropy; GG18 fork hardwires `crypto/rand` with no `SetRand` call sites |
| A4 | Malicious dependency/fork at build time | Compromise of a pinned fork or a package mirror; undetected by diff review | Total fund loss (backdoored builds) | Low but non-zero — the dominant residual vector; partially mitigated by local forks (`replace` directives), revision pinning, and audited vendoring |
| A5 | Weak tooling entropy leaks into user keyshares | Dev CLI used to produce real keyshares *and* its RNG fails | Key compromise of tooling-produced shares only | Closed: tooling now uses `crypto/rand` with full-read assertion and fails loudly on error; constant-chaincode fallbacks removed |

**Score A = 1.5 / 10.** There is no in-tree defect that could affect all users. The residual risk is almost entirely supply-chain/build-integrity in nature (A4), which is real but comparable to or better than every competing wallet we have assessed, because the tree uses audited local forks and pinned revisions rather than drifting upstream dependencies.

### 2.3 Score B — Targeted attack with at most one device compromised

| # | Attack path | Precondition | Consequence | Likelihood |
|---|-------------|--------------|-------------|------------|
| B1 | Malware on the phone steals the local keyshare | 1 device compromised | Attacker obtains 1 of 2 (or 1 of 3) shares | Moderate for share *exfiltration*; but the share is cryptographically useless alone |
| B2 | Compromised device signs a transaction | 1 device compromised, attacker runs a signing session | Needs the second device to co-sign; second device independently verifies | Low-to-moderate; blocked by design unless user approves on second device |
| B3 | UI deception / transaction substitution on the compromised device | 1 device compromised + user fails to verify details on the second device | Funds moved to attacker address | **Highest-probability fund-loss path in the entire product** — a behavioural gap, not a cryptographic one |
| B4 | Rogue co-signer (the "other party" is malicious) | User co-signs with a malicious counterparty | In 2-of-3: no theft (2 of 3 required, honest majority assumed for theft; note: 2-of-3 threshold means *two* colluding parties can steal — see B5); in 2-of-2: counterparty is a trusted partner by construction | Low; DKG itself is secure against a malicious party (verifiable secret sharing) |
| B5 | Two-of-three collusion | 2 of 3 devices/parties collude (out of scope: assumption is *at most one* compromised) | Full theft | Out of scope for Score B; noted in §5 |
| B6 | Rooted/jailbroken device keystore extraction | Device rooted + attacker with physical/logical access | Share exfiltration (still 1 of n); Keystore/Keychain hardening degrades under root | Low-to-moderate; consequence capped by threshold |
| B7 | Relay/transport interception | Attacker controls Nostr relay or LAN segment | Sees only ECIES-encrypted messages; no key material recoverable | Low; relay operators are explicitly untrusted and transport is end-to-end encrypted |

**Score B = 2.5 / 10.** A single compromised device cannot sign, cannot derive keys, and cannot recover a usable share. The realistic fund-loss path is B3 — UI deception — which requires both a fully compromised device *and* user failure to verify the second-device confirmation. Every cryptographic path (B1, B2, B4, B6, B7) is blocked or capped by the threshold structure.

---

## 3. Detailed Technical Findings

Findings are ordered by severity. **Positive controls** (explicitly verified-absent findings) are included per engagement instructions.

### BWL-001 — GG18 session nonce unset (no cross-session proof binding) — Medium (hardening)

- **Affected component:** `BoldBitcoinWallet/tss-lib` fork (`tss/params.go`); BBMTLib keygen path (`BBMTLib/tss/tss.go`)
- **Description:** The GG18 fork's `NewParameters` does not establish a `sessionNonce`; verified zero call sites of `SetSessionNonce` (or any session-binding mechanism) in `BBMTLib`. Per the fork's own documentation, with no session nonce, signing binds proofs to the message hash and keygen has no cross-session binding. This does not weaken any *entropy* source — all proofs consume `crypto/rand` — but it weakens *protocol binding*: transcripts from different sessions are not provably distinct at the Fiat–Shamir level.
- **Impact:** Theoretical — transcript-reuse/session-confusion arguments are degraded. There is no known practical attack against GG18 in this configuration, and DKLs23 sessions (the default backend) are properly bound via caller-supplied session IDs mixed into transcripts.
- **Recommendation:** In a future fork revision, derive `sessionNonce` deterministically from the session ID (a 256-bit random binder already generated in-app) and set it via the fork's session-nonce mechanism, with an interop test against desktop counterparties before shipping. Document the accepted posture until then.

### BWL-002 — UI deception surface (transaction substitution) — Medium (behavioural, architectural)

- **Affected component:** React Native UI (`screens/`), signing flow (`BBMTLib/tss/`, `dkls/`)
- **Description:** BoldWallet enforces **double-device transaction confirmation**: both co-signing devices independently parse, render, and display the full PSBT (inputs, outputs, amounts, addresses) before signing. The user must explicitly approve the transaction on *each* device. The control is structural — the second device renders from the PSBT bytes, not from the first device's UI state — so a compromised device cannot spoof what the second device displays. However, the transaction that a compromised device *displays* to the user is not cryptographically bound to the transaction it *submits* for co-signing; malware on one device could show a legitimate transaction while proposing a different PSBT.
- **Impact:** If a user signs on a compromised device and fails to verify the second device's confirmation screen, funds can be moved to an attacker address. The double-device confirmation flow makes this substantially harder than single-device wallets (where malware signs silently), but the residual depends on user behaviour: *both* confirmations must be actively verified. This is the highest-probability fund-loss path in the product (Score B, path B3).
- **Recommendation:** Keep second-device confirmation mandatory for all transactions; consider displaying a human-readable address/amount summary on the *signing* device derived from the same PSBT hash; add a PSBT hash display on both devices so users can compare; treat any flow that collapses the two confirmations into one device as a release blocker.

### BWL-003 — 2-of-2 liveness — Low (availability)

- **Affected component:** Wallet configuration, `dkls/` (duo mode)
- **Description:** In 2-of-2 mode, loss or compromise of either device permanently bricks access to funds (no recovery phrase exists by design).
- **Impact:** Availability risk, not confidentiality risk. Users who lose a device without a backup share lose the wallet.
- **Recommendation:** Default to 2-of-3 where the user can maintain the second and third devices; provide clear, in-app guidance on backup/device-replacement procedures (e.g., pre-generated third share for recovery).

### BWL-004 — go-nostr `rand.Read` ignored return (aux randomness, cgo build only) — Low (third-party)

- **Affected component:** `github.com/nbd-wtf/go-nostr@v0.52.3`, `signature_libsecp256k1.go`
- **Description:** BIP-340 auxiliary randomness is read with `rand.Read(random[:])`, return values ignored. This file compiles only with the `libsecp256k1` build tag; the default build uses btcec's schnorr signer. Failure of the read (OS CSPRNG broken) yields a zero aux buffer, producing deterministic-but-per-(key,message) nonces — not cross-message reuse.
- **Impact:** Under a *broken OS CSPRNG on a device that is simultaneously used for Nostr identity*, signatures would be deterministic per message. No MPC key material is involved. Requires the already-extreme precondition of a failing system CSPRNG.
- **Recommendation:** Vendor-patch the call to check the error and fail loudly, for defense in depth. Low priority.

### BWL-005 — `math/rand` in third-party non-crypto paths — Informational

- **Affected component:** `go-nostr` (`nip46/client.go`, `sdk/system.go`, `nip59/nip59.go`)
- **Description:** `math/rand` is used for a client-id prefix, a relay-stream serial, and gift-wrap timestamp obfuscation. None of these touch key material; NIP-44 nonces use `crypto/rand` (error-checked).
- **Impact:** None identified.
- **Recommendation:** None required. Documented for completeness.

### BWL-006 — `math/rand` in tss-lib test fixtures shipped in packages — Informational

- **Affected component:** tss-lib forks — `eddsa/keygen/test_utils.go`, `ecdsa/keygen/test_utils.go` (not `_test.go` files, so compiled into the package)
- **Description:** `rand.Float32()` is used solely to pluck random fixture subsets for tests. Never reachable from keygen/signing paths.
- **Impact:** None. Not a cryptographic RNG consumer.
- **Recommendation:** None required. Optionally move fixture helpers to `_test.go` for hygiene.

### BWL-007 — Ignored RNG error for timing-jitter — Informational

- **Affected component:** tss-lib fork `common/constant_time.go`
- **Description:** `jitterNanos, _ := rand.Int(rand.Reader, ...)` — failure of the jitter draw means the constant-time operation simply runs without jitter.
- **Impact:** None (timing obfuscation only; failure does not degrade the underlying constant-time behaviour, and requires a broken CSPRNG).
- **Recommendation:** None required.

### BWL-008 — Supply-chain surface (pinned forks and replaces) — Low (informational risk note)

- **Affected component:** `BBMTLib/go.mod`, `libtss` submodule, native artifact build scripts
- **Description:** The tree pins: `0xCarbon/libtss/libtss-go → ../../libtss/libtss-go` (local, audited fork); `bnb-chain/tss-lib/v3 → BoldBitcoinWallet/tss-lib/v3 v3.0.0` (audited fork); `agl/ed25519 → binance-chain/edwards25519`; `gogo/protobuf → regen-network/protobuf` (CVE fix). Native Rust artifacts are revision-pinned and gate-checked (`security-release-gate.sh` verifies the pinned `libtss` revision and the absence of the `insecure-rng` feature).
- **Impact:** Pinning is a double-edged sword: it protects against upstream drift but concentrates trust in the fork maintainers' commit integrity. This is the dominant residual mass-compromise vector (Score A path A4).
- **Recommendation:** Maintain signed, reviewed releases of both forks; record fork diffs against upstream; consider SLSA-style provenance for native artifacts.

### BWL-009 — LAN transport key derivation from session ID — Informational

- **Affected component:** `BBMTLib/tss/lan_crypto.go`, `dkls/lan.go`
- **Description:** When no session key/encryption keys are supplied, the LAN transport cipher key is `SHA256(sessionID, masterHost)` — deterministic from the (256-bit, in-app CSPRNG-generated) session ID. Transport-layer only; never key material.
- **Impact:** None beyond the standard property that anyone who observes the session ID can decrypt the LAN transport stream. Session IDs are random 256-bit values generated via `crypto.getRandomValues` (native CSPRNG-backed), so this is not practically exploitable.
- **Recommendation:** None required.

### Positive control PC-1 — No RNG fallback anywhere (the Coldcard vector is absent)

Verified by exhaustive scan of the Go tree (`crypto/rand`, `rand.Reader`, `SecureRandom` call sites), the Rust tree (`get_rng()`, `OsRng`, `ThreadRng`, `StdRng::seed_from_u64`), the FFI headers (no seed/entropy parameter), and the JS layer (`crypto.getRandomValues`; `Math.random` exists only in the `LoadingScreen` animation). `MustGetRandomInt` **panics** on entropy failure (fail-stop, the anti-Coldcard behaviour); `GetRandomBytes` propagates errors; every production `SecureRandom` call site in `BBMTLib` checks and propagates errors; PSBT pre-agreement nonces, keygen peer nonces, attempt IDs, AES IVs (`io.ReadFull(rand.Reader, iv)`), ECIES ephemeral keys, NIP-44 nonces, and Nostr private keys all derive from `crypto/rand` with error checks.

### Positive control PC-2 — No RNG injection surface in mobile bindings

Full exported surface reviewed (Go gomobile exports, JNI entry points, UniFFI, `dklsstub` shim, JS APIs): callers supply only session/session-key strings, validated chaincodes, ECIES transport keys, nsec (Nostr transport identity), and a path for pre-params. No API accepts entropy, seeds, or an RNG. The Rust `insecure-rng` deterministic RNG exists only under `cfg(all(test, feature = "insecure-rng"))` and is unreachable in any shipped build configuration.

### Positive control PC-3 — Threshold-share storage and signing isolation

Secret shares persist via `react-native-encrypted-storage` (iOS Keychain / Android Keystore-backed EncryptedSharedPreferences). Native modules read shares directly from Keychain/keystore for signing; secret material does not cross the JS bridge during send/sign. The only "fallback" in the crypto stack is mlock→non-mlock memory-hardening initialization (`dkls/security.go`), unrelated to RNG.

### Positive control PC-4 — Chaincode and session-ID validation

Chaincodes are validated (`normalizeChainCodeHex` rejects empty, non-hex, and all-zero values) before use in BIP32 derivation. Session IDs are protocol binders, not entropy: DKG secrets derive from the OS CSPRNG regardless of caller-supplied session strings.

---

## 4. Attack Scenario Analysis

| # | Scenario | Outcome | Residual Risk |
|---|----------|---------|---------------|
| S1 | Broken/backdoored OS RNG on one device | That device's CSPRNG-derived contributions (share, nonces, OT seeds) are predictable *if* the failure is silent. Even then, the attacker holds at most one predictable share; signing still requires the second device's CSPRNG. **No Coldcard-class total compromise is possible.** | Low — threshold structure caps the damage; requires a silent OS-level RNG failure on one device only |
| S2 | Fully compromised phone (1 device) | Attacker exfiltrates one keyshare (1-of-2 or 1-of-3). Cryptographically useless alone: cannot sign, derive, or reconstruct the group key. Attacker can initiate sessions but every signature needs the other device. | Low-to-moderate — the main residual is that the compromised device can *propose* transactions (see S3) |
| S3 | UI deception / transaction substitution | Malware on the compromised device displays a legitimate-looking transaction to the user while submitting a different PSBT. If the user signs without verifying the second device's independent confirmation, funds move to the attacker. BoldWallet's **double-device confirmation** — where both devices independently parse and render the PSBT — makes this substantially harder than in single-device wallets where malware can silently sign. | **Highest residual risk in the product.** Mitigation is behavioural: the second device independently renders and confirms the PSBT. Recommend PSBT-hash display on both devices (BWL-002) |
| S4 | Malicious/rogue co-signer | DKG is secure against a malicious party (verifiable secret sharing; proofs verified). A rogue party learns only its own share. In 2-of-2 the counterparty is a trusted partner by construction; in 2-of-3, two colluding parties are required for theft, which is outside the one-device assumption. | Low |
| S5 | Transport interception (Nostr / LAN) | Attacker controlling relays or a LAN segment observes only ECIES-encrypted traffic; no key material or share data is recoverable. Session IDs are 256-bit CSPRNG values; LAN cipher key derivation from them is not practically exploitable (BWL-009). | Low |
| S6 | Rooted/jailbroken device | Keystore/Keychain hardening degrades under root; attacker extracts one share. Consequence capped at one share by the threshold structure. | Low-to-moderate — depends on root + physical/logical access; cap remains |
| S7 | Supply chain attack (malicious dependency/fork) | A malicious upstream or fork commit at build time could backdoor shipped binaries. Mitigated by local audited forks, pinned revisions, CVE-fix replaces, revision-gated native artifacts, and the release gate. This is the dominant mass-compromise vector (Score A path A4). | Low but non-zero — the only credible mass-compromise path |

---

## 5. Comparative Analysis

### 5.1 vs. Hardware wallets (Coldcard, Ledger, Trezor)

**Where BoldWallet is stronger:**
- **The Coldcard failure mode is structurally impossible.** Coldcard's PRNG fallback to a deterministic output on RNG failure compromised *all* keys generated on affected devices — a single-point-of-entropy failure. BoldWallet has no equivalent: there is no fallback, no deterministic path, no seedable RNG, and no injection surface; and even a total entropy failure on one device cannot compromise the group key, because the key is the joint product of *two independent devices'* CSPRNGs.
- **No single chip, no single supply chain for key material.** A hardware wallet's security converges on one silicon vendor's RNG and firmware. BoldWallet's security is spread across two independently provisioned mobile devices.
- **Auditability.** The full keygen/signing stack is open source (Go + Rust), versus closed firmware on some hardware wallets.

**Where hardware wallets are stronger:**
- **Isolation.** A hardware wallet's signing chip is air-gapped from the general-purpose OS; a compromised phone in BoldWallet's model is a compromised *signing device* (capped by threshold, but the UI-deception surface exists — S3).
- **Physical tamper evidence** (some models) and explicit confirmation on the device screen.
- **Liveness/simplicity** — a hardware wallet is a single self-contained object; BoldWallet 2-of-2 has the BWL-003 availability risk.

### 5.2 vs. Single-sig software wallets

Not close on the Coldcard vector: a single-sig software wallet holds one private key on one device. One RNG failure, one malware infection, or one backup leak equals total, irreversible fund loss. BoldWallet's threshold structure means:
- one compromised device ≠ funds at risk (vs. total loss);
- one broken RNG on one device ≠ key compromise (vs. total loss);
- no recovery phrase to phish (vs. seed-phrase phishing, the dominant real-world theft vector for single-sig wallets);
- **double-device transaction confirmation** — both devices independently display and require approval of the full transaction details; a single compromised device cannot silently authorize a spend (vs. single-device wallets where malware signs with no second check).

### 5.3 vs. other MPC/TSS wallets

BoldWallet's architecture is consistent with the published posture of leading MPC vendors (e.g., Fireblocks, ZenGo, Coinbase Wallet-as-a-Service):
- **ZenGo** (2-of-2 threshold with server) — same threshold argument; BoldWallet differs by being self-custodied end-to-end (no custodial server party), and by requiring **double-device transaction confirmation** (both co-signing devices independently display and the user must approve on each) rather than single-device approval.
- **Fireblocks** (enterprise MPC) — comparable threshold guarantees; BoldWallet operates fully client-side on user hardware, and adds the cross-device verification layer at spend time.
- The industry consensus we would echo: MPC wallets eliminate the single-point-of-failure and the seed-phrase attack surface, at the cost of a more complex protocol surface and the behavioural confirmation requirement (S3). BoldWallet's **double-device confirmation** is a distinguishing security feature — it structurally prevents a single compromised device from silently signing, a protection not uniformly present in competing MPC wallets.

**Honest weaknesses of BoldWallet relative to the field:**
1. **UI-deception surface (BWL-002)** — the behavioural confirmation dependency is real and is the top residual risk.
2. **2-of-2 liveness (BWL-003)** — no recovery phrase by design; device loss can mean wallet loss.
3. **Protocol complexity (GG18 in the fork; DKLs23)** — a larger attack surface than a single ECDSA key, though all proofs and parameter validations are verified and Paillier biprimality is enforced at pre-params generation.
4. **GG18 session binding (BWL-001)** — an open hardening item.
5. **Supply-chain concentration (BWL-008)** — trust converges on the fork maintainers and pinned revisions.

---

## 6. Final Verdict & Recommendations

**Overall posture:** Strong. This is one of the few consumer wallet architectures in which a Coldcard-class RNG failure is not merely mitigated but *structurally impossible*, and in which a fully compromised device is, by itself, cryptographically powerless. The **double-device transaction confirmation** flow — where both co-signing devices independently render the full PSBT and require explicit user approval — structurally prevents silent signing by a single compromised device, a protection absent from virtually all single-device wallets and many MPC competitors. The residual risks are behavioural (UI deception), availability (2-of-2 liveness), and supply-chain (fork/build integrity) — not cryptographic entropy.

**Recommendation for deployment: Ready for production**, subject to:

1. **Default to 2-of-3** where the user can support it (availability + reduced reliance on a single confirmation device).
2. **Mandatory, non-collapsible double-device confirmation** for all transactions — both co-signing devices must independently display full inputs, outputs, amounts, and addresses, and require explicit user approval on each device. Add PSBT-hash display on both devices for users to cross-check (address BWL-002). Do not add any flow that collapses confirmations to a single device.
3. **No new entropy/injection APIs** — maintain the current no-seed surface as a standing requirement.
4. **Release hygiene** — keep the security release gate mandatory for all builds; keep forks signed and diffed against upstream.

**Open items for future releases:**
- BWL-001: set GG18 `sessionNonce` derived from the session ID (fork revision + interop tests) — hardening, not an exploitable defect.
- BWL-004: vendor-patch go-nostr aux-randomness error check (defense in depth).
- BWL-002: PSBT-hash comparison UX on both devices.
- 2-of-2 user guidance and device-replacement/recovery tooling for 2-of-3.

**Scores:** Mass-compromise/supply-chain risk (Score A): **1.5 / 10**. Targeted attack with at most one device compromised (Score B): **2.5 / 10**. Both scores reflect a codebase with no exploitable in-tree RNG, protocol, or storage defect; the residual is dominated by behavioural and supply-chain factors common to — and in the RNG dimension strictly better than — the industry.

---

*This audit was performed against the codebase at commit `ac9ceeb8c408c4dc221cae2d9c623338f11073bf` and reflects the state as of 2026-06-15.*
