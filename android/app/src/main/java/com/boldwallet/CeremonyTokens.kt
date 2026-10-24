package com.boldwallet

import java.security.SecureRandom

/**
 * F15b-2 / F10-bridge ceremony-token core (3b-1). Pure javax.crypto /
 * stdlib only — no Android deps — so JVM unit tests cover the state
 * machine and binding rules. The bridge layer (BBMTLibNativeModule)
 * adds the OS-visible prompt + device-lock gate; NOTHING here mints
 * without the caller having authenticated — enforced by keeping
 * mint() callable only from the post-prompt continuation and the
 * DEBUG-gated test entry.
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
 *   sessionID match && now ≤ expiresAt
 * All failures return plain false — the bridge maps every
 * failure to one CEREMONY_AUTH_REQUIRED (no reason oracle).
 */
object CeremonyTokens {
    const val TTL_MS: Long = 10 * 60 * 1000L

    enum class OpClass(val wire: String) {
        SIGN("sign"),
        KEYGEN("keygen"),
        EXPORT("export"),
        IMPORT("import"),
        TRANSPORT("transport"),
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
    fun mint(opClass: OpClass, sessionID: String): String {
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
            )
            return id
        }
    }

    /**
     * Native-side authorization check. Call with the op class the
     * NATIVE method requires — never a class supplied by JS.
     */
    fun verify(token: String, opClass: OpClass, sessionID: String): Boolean {
        synchronized(lock) {
            val rec = tokens[token] ?: return false
            if (isTerminal(rec.state)) return false
            if (nowMs() > rec.expiresAtMs) {
                tokens[token] = rec.copy(state = State.EXPIRED)
                return false
            }
            if (rec.opClass != opClass || rec.sessionID != sessionID) {
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

/**
 * DEBUG-test-mint gate, extracted pure so JVM tests pin the rule:
 * the prompt-bypassing mint exists ONLY when buildDebug is true.
 * The bridge passes BuildConfig.DEBUG; release bytecode refuses.
 */
object CeremonyTestMint {
    fun isAllowed(buildDebug: Boolean): Boolean = buildDebug
}
