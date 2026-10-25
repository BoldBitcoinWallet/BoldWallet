package com.boldwallet

import java.security.SecureRandom

/**
 * F15b-2 / F10-bridge ceremony-token core (3b-1). Pure javax.crypto /
 * stdlib only — no Android deps — so JVM unit tests cover the state
 * machine and binding rules. The bridge layer (BBMTLibNativeModule)
 * adds the OS-visible prompt + device-lock gate; NOTHING here mints
 * without the caller having authenticated — enforced by keeping
 * mint() callable only from the post-prompt continuation and the
 * debug-source-set test module (absent in release).
 *
 * State machine (terminal: USED, EXPIRED, REVOKED):
 *   MINTED → ACTIVE    (first successful verify)
 *   MINTED → EXPIRED   (timeout, enforced lazily at verify)
 *   MINTED → REVOKED   (release / revokeSession / superseded)
 *   ACTIVE → USED      (complete on ceremony success)
 *   ACTIVE → REVOKED   (release / revokeSession / superseded)
 *   ACTIVE → EXPIRED   (timeout)
 * verify() on a terminal token returns false without transition.
 * Failed verify (wrong op/session) returns false WITHOUT
 * transitioning — probing must not kill a live token.
 *
 * Single live session: mint() revokes all non-terminal tokens of
 * any OTHER session (a new ceremony supersedes) plus any prior
 * same-(session, class) token. The app runs one ceremony at a
 * time; overlap fails closed. Cancel (B19) calls
 * revokeSession(sessionID) natively — JS cannot skip it.
 *
 * Validation (executed HERE at the bridge, never trusted from JS):
 *   exists && state ∈ {MINTED, ACTIVE} && opClass match &&
 *   sessionID match && (ACTIVE || now ≤ expiresAt).
 * TTL bounds ceremony START, not duration: an unstarted
 * (MINTED) token past TTL fails and goes EXPIRED, but a
 * started ceremony never dies mid-sign from token expiry
 * (that would be a state-consistency bug). Duration is
 * bounded by complete/release/cancel, single-live-session
 * supersession, and process death (in-memory map).
 * All failures return plain false — the bridge maps every
 * failure to one CEREMONY_AUTH_REQUIRED (no reason oracle).
 * Checks run pre-transition (flat single false); nothing
 * transitions-then-rolls-back.
 */
object CeremonyTokens {
    const val TTL_MS: Long = 10 * 60 * 1000L

    // NOTE: no TRANSPORT class. Transport calls (fetchData/
    // publishData) verify against the PARENT ceremony token
    // (sign|keygen) + session — the ceremony's own channel needs
    // no separate mint, and one token per ceremony removes a JS
    // token-confusion failure mode. The strict rule stands for
    // sign/export/import/config: never interchanged.
    enum class OpClass(val wire: String) {
        SIGN("sign"),
        KEYGEN("keygen"),
        EXPORT("export"),
        IMPORT("import"),
        CONFIG("config"),
        ;

        companion object {
            fun parse(wire: String): OpClass? = values().firstOrNull { it.wire == wire }
        }
    }

    enum class State {
        MINTED, ACTIVE, USED, EXPIRED, REVOKED,
    }

    data class Record(
        val opClass: OpClass,
        val sessionID: String,
        val expiresAtMs: Long,
        val state: State,
        val useCount: Int,
        // F20: sha256 hex of the PSBT artifact the user confirmed
        // natively; null = unbound (legacy mints). Enforced at
        // keysign by contentBindingOk when present.
        val boundDigest: String? = null,
    )

    private val lock = Any()
    private val tokens = mutableMapOf<String, Record>()

    /** Injected for tests (fake clock / deterministic IDs). */
    var nowMs: () -> Long = { System.currentTimeMillis() }
    var randomTokenId: () -> String = {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        bytes.joinToString("") { "%02x".format(it) }
    }

    /** Mint after successful OS auth. Revokes superseded tokens. */
    fun mint(opClass: OpClass, sessionID: String, boundDigest: String? = null): String {
        require(sessionID.isNotEmpty()) { "sessionID required" }
        synchronized(lock) {
            // Single live session: a new ceremony supersedes every
            // non-terminal token of any other session. Same-session
            // prior tokens (any class) are superseded too — newest
            // mint wins, so a stale issuance can never linger.
            for ((id, rec) in tokens) {
                if (!isTerminal(rec.state)) {
                    tokens[id] = rec.copy(state = State.REVOKED)
                }
            }
            var id = randomTokenId()
            while (tokens.containsKey(id)) {
                id = randomTokenId()
            }
            tokens[id] = Record(
                opClass = opClass,
                sessionID = sessionID,
                expiresAtMs = nowMs() + TTL_MS,
                state = State.MINTED,
                useCount = 0,
                boundDigest = boundDigest,
            )
            return id
        }
    }

    /**
     * Native-side authorization check. Call with the op class the
     * NATIVE method requires — never a class supplied by JS.
     */
    fun verify(token: String, opClass: OpClass, sessionID: String): Boolean {
        return verifyInner(token, setOf(opClass), sessionID)
    }

    /**
     * 3b-2a: single-call ceremonies without an MPC session (sends,
     * nostr). Enforces op-class + TTL-start + revocation; session
     * equality is inapplicable (nothing to match). Call sites that
     * HAVE a session must use verify(), not this.
     */
    fun verifySingleCall(token: String, opClass: OpClass): Boolean {
        return verifyInner(token, setOf(opClass), null)
    }

    /**
     * 3b-2c B13/B14: LAN handshake transport rides the handshake
     * ceremony token (keygen for setup, sign for send/sign) with
     * strict session equality. No transport class exists — the
     * handshake IS the ceremony, minted at initSession start.
     */
    fun verifyTransport(token: String, sessionID: String): Boolean {
        return verifyInner(token, setOf(OpClass.SIGN, OpClass.KEYGEN), sessionID)
    }

    /**
     * 3b-4 B19: authorize cancel AND atomically revoke the token's
     * session (false = reject, nothing revoked). Accepts live
     * sign|keygen tokens; when the call carries a session it must
     * match, else (nostr global cancel) the token's own session
     * scopes the revocation. Atomicity closes the
     * authorize→revoke TOCTOU (no concurrent verify can slip
     * through); revocation precedes the Go cancel broadcast, so a
     * failed broadcast still leaves the ceremony dead. Same
     * TTL-start rule as verify.
     */
    fun cancelConsume(token: String, sessionID: String?): Boolean {
        synchronized(lock) {
            val rec = tokens[token] ?: return false
            if (isTerminal(rec.state)) return false
            if (rec.state == State.MINTED && nowMs() > rec.expiresAtMs) {
                tokens[token] = rec.copy(state = State.EXPIRED)
                return false
            }
            if (rec.opClass != OpClass.SIGN && rec.opClass != OpClass.KEYGEN) {
                return false
            }
            if (!sessionID.isNullOrEmpty() && rec.sessionID != sessionID) {
                return false
            }
            revokeSession(rec.sessionID)
            return true
        }
    }

    /**
     * F20 content binding. Unbound token (boundDigest == null,
     * legacy mints) → ok. Bound token: the PSBT actually being
     * signed must hash to the confirmed digest; on mismatch the
     * whole session is revoked (a swapped artifact kills the
     * ceremony, never signs) and false returned. Unknown token →
     * false (verify() has already failed closed by then).
     */
    fun contentBindingOk(token: String, actualDigestHex: String?): Boolean {
        synchronized(lock) {
            val rec = tokens[token] ?: return false
            val bound = rec.boundDigest ?: return true
            if (actualDigestHex != null && actualDigestHex == bound) return true
            revokeSession(rec.sessionID)
            return false
        }
    }

    private fun verifyInner(
        token: String,
        allowedClasses: Set<OpClass>,
        sessionID: String?,
    ): Boolean {
        synchronized(lock) {
            val rec = tokens[token] ?: return false
            if (isTerminal(rec.state)) return false
            // TTL bounds START: only unstarted tokens can expire.
            if (rec.state == State.MINTED && nowMs() > rec.expiresAtMs) {
                tokens[token] = rec.copy(state = State.EXPIRED)
                return false
            }
            if (rec.opClass !in allowedClasses) {
                return false
            }
            if (sessionID != null && rec.sessionID != sessionID) {
                return false
            }
            tokens[token] = rec.copy(
                state = State.ACTIVE,
                useCount = rec.useCount + 1,
            )
            return true
        }
    }

    /** Ceremony completed normally → USED. Idempotent. */
    fun complete(token: String) {
        synchronized(lock) {
            val rec = tokens[token] ?: return
            if (!isTerminal(rec.state)) {
                tokens[token] = rec.copy(state = State.USED)
            }
        }
    }

    /** Tear down without completion → REVOKED. Idempotent. */
    fun release(token: String) {
        synchronized(lock) {
            val rec = tokens[token] ?: return
            if (!isTerminal(rec.state)) {
                tokens[token] = rec.copy(state = State.REVOKED)
            }
        }
    }

    /** B19: cancel revokes every live token of the session. */
    fun revokeSession(sessionID: String) {
        synchronized(lock) {
            for ((id, rec) in tokens) {
                if (rec.sessionID == sessionID && !isTerminal(rec.state)) {
                    tokens[id] = rec.copy(state = State.REVOKED)
                }
            }
        }
    }

    fun stateOf(token: String): State? {
        synchronized(lock) {
            return tokens[token]?.state
        }
    }

    fun useCountOf(token: String): Int {
        synchronized(lock) {
            return tokens[token]?.useCount ?: 0
        }
    }

    private fun isTerminal(state: State): Boolean {
        return state == State.USED || state == State.EXPIRED || state == State.REVOKED
    }

    /** Test-only reset (wipes the store + restores real clock/IDs). */
    fun resetForTest(defaultNowMs: () -> Long = { System.currentTimeMillis() }) {
        synchronized(lock) {
            tokens.clear()
        }
        nowMs = defaultNowMs
        randomTokenId = {
            val bytes = ByteArray(16)
            SecureRandom().nextBytes(bytes)
            bytes.joinToString("") { "%02x".format(it) }
        }
    }
}

// NOTE: no test-mint gate here. The prompt-bypassing mint is a
// debug-source-set module (CeremonyTestModule) + Swift
// #if DEBUG — compile-time absent from release, not runtime
// gated. Guardrailed in jest (ceremonyAuth.test.ts).