package com.boldwallet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import javax.crypto.spec.SecretKeySpec

/** F15b-1: pure AES-GCM envelope format/crypto (JVM-safe, no Android deps). */
class AesGcmEnvelopeTest {

    private val key = SecretKeySpec(ByteArray(32) { (it * 7).toByte() }, "AES")
    private val otherKey = SecretKeySpec(ByteArray(32) { (it * 13 + 1).toByte() }, "AES")
    private val enc: (ByteArray) -> String = { java.util.Base64.getEncoder().encodeToString(it) }
    private val dec: (String) -> ByteArray = { java.util.Base64.getDecoder().decode(it) }

    @Test
    fun testF15b1_EnvelopeRoundTrip() {
        val plain = """{"pub_key":"03aa","share_b64":"F15B1-SECRET"}"""
        val env = AesGcmEnvelope.seal(plain.toByteArray(), key, enc)
        assertTrue(AesGcmEnvelope.isEnvelope(env))
        assertFalse(env.contains("F15B1-SECRET"))
        assertEquals(plain, AesGcmEnvelope.open(env, key, dec).toString(Charsets.UTF_8))
    }

    @Test
    fun testF15b1_EnvelopeNonceRandomized() {
        val a = AesGcmEnvelope.seal("x".toByteArray(), key, enc)
        val b = AesGcmEnvelope.seal("x".toByteArray(), key, enc)
        assertNotEquals(a, b)
    }

    @Test
    fun testF15b1_EnvelopeTamperFails() {
        val env = AesGcmEnvelope.seal("secret".toByteArray(), key, enc)
        val parts = env.split(":")
        val badCt = parts[2].dropLast(2) + if (parts[2].takeLast(2) == "AA") "BB" else "AA"
        try {
            AesGcmEnvelope.open("${parts[0]}:${parts[1]}:$badCt", key, dec)
            fail("tampered ciphertext opened")
        } catch (e: IllegalStateException) {
            // expected: GCM auth failure
        }
    }

    @Test
    fun testF15b1_EnvelopeWrongKeyFails() {
        val env = AesGcmEnvelope.seal("secret".toByteArray(), key, enc)
        try {
            AesGcmEnvelope.open(env, otherKey, dec)
            fail("wrong key opened")
        } catch (e: IllegalStateException) {
            // expected
        }
    }

    @Test
    fun testF15b1_ResolveTripwire() {
        assertTrue(AesGcmEnvelope.containsShareSecrets("""{"share_b64":"eA=="}"""))
        assertTrue(AesGcmEnvelope.containsShareSecrets("""{"ecdsa_local_data":{}}"""))
        assertTrue(AesGcmEnvelope.containsShareSecrets("""{"nsec":"abc"}"""))
        assertTrue(AesGcmEnvelope.containsShareSecrets("""{"sessionKeyHex":"00"}"""))
        assertFalse(
            AesGcmEnvelope.containsShareSecrets(
                """{"handle":"ab12","metadata":{"pub_key":"03aa","nostr_npub":"npub1x"}}""",
            ),
        )
    }

    @Test
    fun testF15b1_EnvelopeMalformedFails() {
        // isEnvelope is shape-only (marker + 3 parts); undecodable
        // base64 passes shape but must fail open.
        for (bad in listOf("", "v1:", "v1:onlytwo", "v2:a:b", "v1:::",
            "{\"pub_key\":\"x\"}")) {
            assertFalse("isEnvelope($bad)", AesGcmEnvelope.isEnvelope(bad))
        }
        for (bad in listOf("", "v1:", "v1:onlytwo", "v2:a:b", "v1:::",
            "v1:!!!notbase64!!!:e30=", "{\"pub_key\":\"x\"}")) {
            try {
                AesGcmEnvelope.open(bad, key, dec)
                fail("malformed opened: $bad")
            } catch (e: IllegalArgumentException) {
                // expected
            }
        }
    }
}
