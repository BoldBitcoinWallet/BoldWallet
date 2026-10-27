package com.boldwallet

import java.util.regex.Pattern

/**
 * Detect + repair GG18 keyshares whose `*big.Int` fields were left as
 * JSON strings after a JS quote→parse→stringify round-trip. Go's
 * math/big only accepts bare number tokens.
 *
 * - quoted_oversized_ints: fixable (exact digits preserved)
 * - scientific_float: unrecoverable (IEEE destroyed precision)
 */
object Gg18KeyshareBigIntRepair {
    const val ISSUE_NONE = "none"
    const val ISSUE_QUOTED = "quoted_oversized_ints"
    const val ISSUE_SCI = "scientific_float"
    const val ISSUE_NOT_GG18 = "not_gg18"
    const val ISSUE_EMPTY = "empty"

    private val QUOTED_OVERSIZED =
        Pattern.compile("""([:\[,]\s*)"(-?\d{17,})"""")
    private val BARE_OVERSIZED =
        Pattern.compile("""([:\[,]\s*)(-?\d{17,})(?=\s*[,}\]\]])""")
    private val SCIENTIFIC =
        Pattern.compile("""\d+\.\d+[eE][+\-]?\d+""")

    fun detectIssue(raw: String?): String {
        if (raw.isNullOrBlank()) {
            return ISSUE_EMPTY
        }
        if (!raw.contains("ecdsa_local_data")) {
            return ISSUE_NOT_GG18
        }
        if (SCIENTIFIC.matcher(raw).find() || raw.contains("Infinity")) {
            return ISSUE_SCI
        }
        if (QUOTED_OVERSIZED.matcher(raw).find()) {
            return ISSUE_QUOTED
        }
        return ISSUE_NONE
    }

    fun isFixable(issue: String): Boolean = issue == ISSUE_QUOTED

    fun emitBareOversizedIntegers(raw: String): String {
        if (raw.isEmpty() || detectIssue(raw) != ISSUE_QUOTED) {
            return raw
        }
        return QUOTED_OVERSIZED.matcher(raw).replaceAll("$1$2")
    }

    /**
     * Quote bare >16-digit integers on a temporary copy before passing
     * to org.json.JSONObject so Paillier-scale integers never fail
     * number parsing. Never persist the returned string.
     */
    fun quoteOversizedIntegersForJsonObject(raw: String): String {
        if (raw.isEmpty() || !raw.contains("ecdsa_local_data")) {
            return raw
        }
        return BARE_OVERSIZED.matcher(raw).replaceAll("$1\"$2\"")
    }
}
