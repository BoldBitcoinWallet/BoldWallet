package com.boldwallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * F3: EncryptedSharedPreferences round-trip on a real Keystore, with an
 * on-disk assertion that no plaintext is ever written.
 */
@RunWith(AndroidJUnit4::class)
class SecurePrefsInstrumentedTest {

    @Test
    fun testF3_RoundTrip_EncryptedAtRest() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val prefs = openSecurePrefs(ctx, "F3TestPrefs")
        try {
            prefs.edit().putString("k", "F3SENTINEL-test-value-42").commit()
            assertEquals("F3SENTINEL-test-value-42", prefs.getString("k", null))

            val file =
                File(ctx.applicationInfo.dataDir, "shared_prefs/F3TestPrefs.xml")
            assertTrue("prefs file missing", file.exists())
            assertFalse(
                "plaintext leaked to disk",
                containsBytes(file.readBytes(), "F3SENTINEL".toByteArray()),
            )
        } finally {
            prefs.edit().clear().commit()
        }
    }

    private fun containsBytes(haystack: ByteArray, needle: ByteArray): Boolean {
        if (needle.isEmpty() || haystack.size < needle.size) return false
        outer@ for (i in 0..haystack.size - needle.size) {
            for (j in needle.indices) {
                if (haystack[i + j] != needle[j]) continue@outer
            }
            return true
        }
        return false
    }
}
