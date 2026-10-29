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
        "https://mempool.space/testnet4/api",
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

    /**
     * F11: URL shape validation for setAPI/setFeeAPIs. https allows any
     * host; http/ws/wss are LAN-only (loopback/link-local/private
     * literals + localhost, never DNS-resolved). Everything else (file:,
     * javascript:, missing scheme/host, blank) is rejected. Runs BEFORE
     * the allowlist/token decision so garbage never prompts nor persists.
     */
    fun isAllowedApiUrlShape(raw: String): Boolean {
        val url = raw.trim()
        if (url.isEmpty()) return false
        val uri = try {
            java.net.URI(url)
        } catch (e: Exception) {
            return false
        }
        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host ?: return false
        if (host.isEmpty()) return false
        if (scheme == "https") return true
        if (scheme == "http" || scheme == "ws" || scheme == "wss") {
            return isLanHost(host)
        }
        return false
    }

    /** Literal-only LAN check. Never resolves DNS. */
    fun isLanHost(host: String): Boolean {
        val h = host.trim().lowercase().removeSuffix(".")
        if (h == "localhost") return true
        val v4 = h.split(".")
        if (v4.size == 4) {
            val octets = v4.map { it.toIntOrNull() }
            if (octets.any { it == null || it !in 0..255 }) return false
            val a = octets[0]!!
            val b = octets[1]!!
            if (a == 127) return true
            if (a == 10) return true
            if (a == 172 && b in 16..31) return true
            if (a == 192 && b == 168) return true
            if (a == 169 && b == 254) return true
            return false
        }
        // URI.host strips IPv6 brackets; tolerate both forms.
        val bare = h.removePrefix("[").removeSuffix("]")
        if (bare == "::1") return true
        if (bare.startsWith("fe80:")) return true
        val first = bare.split(":").firstOrNull() ?: return false
        return first.length in 2..4 && first[0] == 'f' &&
            (first[1] == 'c' || first[1] == 'd') &&
            first.all { it in '0'..'9' || it in 'a'..'f' }
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
