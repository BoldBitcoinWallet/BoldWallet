package com.boldwallet

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * F15b-1 at-rest envelope: pure AES-256-GCM seal/open over the RNES
 * `keyshare` value. Pure javax.crypto so JVM unit tests cover it;
 * callers inject the base64 codec (minSdk 24 lacks java.util.Base64,
 * so prod uses android.util.Base64 — see KeyshareEnvelope).
 *
 * Format: `v1:<b64 nonce12>:<b64 ciphertext>`. Strict parse, fail
 * closed on any tamper (GCM auth) or malformed input.
 */
object AesGcmEnvelope {
    const val MARKER = "v1:"
    private const val NONCE_LEN = 12
    private const val TAG_BITS = 128

    fun isEnvelope(s: String): Boolean {
        if (!s.startsWith(MARKER)) return false
        return s.split(":").size == 3
    }

    /**
     * F15b-1 resolve tripwire: true when a value about to cross to
     * JS contains share-material labels. Defense in depth at the
     * exact boundary (label-based; L1 spy tests use known fixtures
     * for label-less values).
     */
    fun containsShareSecrets(s: String): Boolean {
        return s.contains("\"share_b64\"") ||
            s.contains("\"ecdsa_local_data\"") ||
            s.contains("\"nsec\"") ||
            s.contains("\"sessionKeyHex\"")
    }

    fun seal(
        plaintext: ByteArray,
        key: SecretKey,
        b64encode: (ByteArray) -> String,
    ): String {
        val nonce = ByteArray(NONCE_LEN)
        SecureRandom().nextBytes(nonce)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce))
        val ct = cipher.doFinal(plaintext)
        return MARKER + b64encode(nonce) + ":" + b64encode(ct)
    }

    /**
     * @throws IllegalArgumentException on malformed envelope.
     * @throws IllegalStateException on authentication failure.
     */
    fun open(
        envelope: String,
        key: SecretKey,
        b64decode: (String) -> ByteArray,
    ): ByteArray {
        val parts = envelope.split(":")
        if (parts.size != 3 || parts[0] != "v1" || parts[1].isEmpty() || parts[2].isEmpty()) {
            throw IllegalArgumentException("not a v1 envelope")
        }
        val nonce: ByteArray
        val ct: ByteArray
        try {
            nonce = b64decode(parts[1])
            ct = b64decode(parts[2])
        } catch (e: Exception) {
            throw IllegalArgumentException("envelope encoding", e)
        }
        if (nonce.size != NONCE_LEN) {
            throw IllegalArgumentException("envelope nonce length")
        }
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce))
            return cipher.doFinal(ct)
        } catch (e: Exception) {
            throw IllegalStateException("envelope authentication failed", e)
        }
    }
}
