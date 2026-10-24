package com.boldwallet

/**
 * 3b-2d B15/B16: native-held mempool API allowlist.
 *
 * Rule: setAPI/setFeeAPIs apply silently iff every URL is
 * allowlisted; otherwise a valid `config` ceremony token is
 * required, and the approved URLs are persisted. Malicious JS
 * can neither add hosts (no bridge writer except the gated
 * methods) nor bypass the prompt (native verify).
 *
 * Seeds must match services/mempoolApiBase.ts defaults. Drift
 * fails SAFE: an unknown default prompts, never silently allows.
 */
object CeremonyApiAllowlist {

    val SEEDS: Set<String> = setOf(
        "https://mempool.space/api",
        "https://mempool.space/testnet/api",
    )

    /** Trim + strip trailing slashes. Compared and stored normalized. */
    fun normalize(url: String): String = url.trim().trimEnd('/')

    /** Split a setFeeAPIs CSV into normalized non-empty URLs. */
    fun parseCsv(csv: String): List<String> =
        csv.split(",").map { normalize(it) }.filter { it.isNotEmpty() }

    /**
     * Injectable store. Prod = private SharedPreferences file
     * `ceremony_api_allowlist` (MODE_PRIVATE, no other writer —
     * grep-verified); tests = in-memory.
     */
    interface Store {
        fun load(): Set<String>
        fun save(urls: Set<String>)
    }

    fun isAllowed(url: String, store: Store): Boolean {
        val normalized = normalize(url)
        if (normalized.isEmpty()) return false
        if (SEEDS.contains(normalized)) return true
        return store.load().contains(normalized)
    }

    /** Merge normalized non-empty URLs into the store. Throws on I/O failure (caller decides). */
    fun persist(urls: List<String>, store: Store) {
        val merged = store.load().toMutableSet()
        var changed = false
        for (url in urls) {
            val normalized = normalize(url)
            if (normalized.isNotEmpty() && merged.add(normalized)) {
                changed = true
            }
        }
        if (changed) {
            store.save(merged)
        }
    }

    enum class Decision {
        /** All URLs allowlisted — apply, persist nothing. */
        APPLY,
        /** Valid config token — apply and persist the new URLs. */
        APPLY_AND_PERSIST,
        /** Unknown URLs, no (valid) token — reject. */
        REJECT,
    }

    /**
     * Pure gate decision. Empty URL list applies vacuously (no
     * host is pointed anywhere; Go keeps its previous behavior).
     */
    fun decide(
        urls: List<String>,
        token: String,
        sessionID: String,
        store: Store,
    ): Decision {
        if (urls.all { isAllowed(it, store) }) {
            return Decision.APPLY
        }
        if (token.isNotEmpty() && sessionID.isNotEmpty() &&
            CeremonyTokens.verify(token, CeremonyTokens.OpClass.CONFIG, sessionID)
        ) {
            return Decision.APPLY_AND_PERSIST
        }
        return Decision.REJECT
    }
}
