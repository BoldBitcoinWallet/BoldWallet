package com.boldwallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

/**
 * F15b-1: Keystore-backed envelope + migration staging protocol on
 * a real device (real Keystore + real ESP). Uses a scratch prefs
 * file, never the production RNES file.
 */
@RunWith(AndroidJUnit4::class)
class EnvelopeInstrumentedTest {

    private val plain =
        """{"tss_backend":"dkls23","pub_key":"03aa","share_b64":"F15B1-DEVICE-SECRET"}"""

    private fun scratchPrefs(name: String) =
        openSecurePrefs(InstrumentationRegistry.getInstrumentation().targetContext, name)

    @Test
    fun testF15b1_DeviceKeyRoundTrip() {
        val env = KeyshareEnvelope.encryptKeyshareJson(plain)
        assertTrue(KeyshareEnvelope.isEnvelope(env))
        assertFalse(env.contains("F15B1-DEVICE-SECRET"))
        assertEquals(plain, KeyshareEnvelope.decryptKeyshareJson(env))
        // Second seal differs (fresh nonce) but opens identically.
        val env2 = KeyshareEnvelope.encryptKeyshareJson(plain)
        assertTrue(env != env2)
        assertEquals(plain, KeyshareEnvelope.decryptKeyshareJson(env2))
    }

    @Test
    fun testF15b1_MigrationPlaintextConverges() {
        val prefs = scratchPrefs("F15B1MigA")
        prefs.edit().clear().commit()
        try {
            prefs.edit().putString("keyshare", plain).commit()
            assertTrue(KeyshareEnvelope.ensureEnveloped(prefs, "keyshare"))
            val after = prefs.getString("keyshare", null)!!
            assertTrue(KeyshareEnvelope.isEnvelope(after))
            assertEquals(plain, KeyshareEnvelope.decryptKeyshareJson(after))
            assertFalse(prefs.contains("keyshare_migrating"))
            // Idempotent re-run: no-op.
            assertFalse(KeyshareEnvelope.ensureEnveloped(prefs, "keyshare"))
        } finally {
            prefs.edit().clear().commit()
        }
    }

    @Test
    fun testF15b1_MigrationCrashRecovery() {
        val prefs = scratchPrefs("F15B1MigB")
        prefs.edit().clear().commit()
        try {
            // Simulate crash after staging write: staging present,
            // key still plaintext.
            prefs.edit().putString("keyshare", plain).commit()
            val staged = KeyshareEnvelope.encryptKeyshareJson(plain)
            prefs.edit().putString("keyshare_migrating", staged).commit()
            assertTrue(KeyshareEnvelope.ensureEnveloped(prefs, "keyshare"))
            val after = prefs.getString("keyshare", null)!!
            assertEquals(plain, KeyshareEnvelope.decryptKeyshareJson(after))
            assertFalse(prefs.contains("keyshare_migrating"))
        } finally {
            prefs.edit().clear().commit()
        }
    }

    @Test
    fun testF15b1_MigrationCorruptFailsClosed() {
        val prefs = scratchPrefs("F15B1MigC")
        prefs.edit().clear().commit()
        try {
            prefs.edit().putString("keyshare", "definitely-not-a-keyshare").commit()
            try {
                KeyshareEnvelope.ensureEnveloped(prefs, "keyshare")
                fail("corrupt value migrated")
            } catch (e: SecureStorageException) {
                assertEquals(SecureStorageException.Kind.CORRUPTED, e.kind)
            }
            // Untouched: no envelope, no staging.
            assertEquals("definitely-not-a-keyshare", prefs.getString("keyshare", null))
            assertFalse(prefs.contains("keyshare_migrating"))
        } finally {
            prefs.edit().clear().commit()
        }
    }

    @Test
    fun testF15b1_MigrationEmptyIsNoop() {
        val prefs = scratchPrefs("F15B1MigD")
        prefs.edit().clear().commit()
        try {
            assertFalse(KeyshareEnvelope.ensureEnveloped(prefs, "keyshare"))
        } finally {
            prefs.edit().clear().commit()
        }
    }
}
