package com.boldwallet

import java.security.MessageDigest
import java.util.Base64

/**
 * F20: Kotlin mirror of Go tss.PsbtConfirmationDigest —
 * sha256 (lowercase hex) over the canonical decoded PSBT bytes.
 * Canonicalization matches Go canonicalPsbtBase64: strip
 * space/\n/\r/\t, strict base64-decode, require psbt magic.
 * Any deviation returns null and the caller fails closed.
 */
object PsbtDigest {
    fun compute(psbtBase64: String): String? {
        val stripped = psbtBase64.filterNot {
            it == ' ' || it == '\n' || it == '\r' || it == '\t'
        }
        if (stripped.isEmpty()) return null
        val raw = try {
            Base64.getDecoder().decode(stripped)
        } catch (e: IllegalArgumentException) {
            return null
        }
        if (raw.size < 4 ||
            raw[0] != 0x70.toByte() || raw[1] != 0x73.toByte() ||
            raw[2] != 0x62.toByte() || raw[3] != 0x74.toByte()
        ) {
            return null
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(raw)
        return digest.joinToString("") { "%02x".format(it) }
    }
}
