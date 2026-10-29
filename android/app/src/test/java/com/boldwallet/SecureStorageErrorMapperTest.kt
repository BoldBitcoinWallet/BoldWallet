package com.boldwallet

import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.StrongBoxUnavailableException
import android.security.keystore.UserNotAuthenticatedException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyStoreException
import java.security.UnrecoverableKeyException

/** F3: every ESP/MasterKey failure mode maps to a typed, user-mappable error. */
class SecureStorageErrorMapperTest {

    @Test
    fun testF3_Invalidated() {
        val mapped = mapSecureStorageError(KeyPermanentlyInvalidatedException())
        assertEquals(SecureStorageException.Kind.INVALIDATED, mapped.kind)
        assertTrue(mapped.message!!.startsWith("[SECURE_STORAGE_INVALIDATED]"))
        assertTrue(mapped.message!!.contains("was not saved/read"))
    }

    @Test
    fun testF3_Locked() {
        val mapped = mapSecureStorageError(UserNotAuthenticatedException())
        assertEquals(SecureStorageException.Kind.LOCKED, mapped.kind)
        assertTrue(mapped.message!!.startsWith("[SECURE_STORAGE_LOCKED]"))
    }

    @Test
    fun testF3_Corrupted() {
        val fromUnrecoverable = mapSecureStorageError(UnrecoverableKeyException())
        assertEquals(SecureStorageException.Kind.CORRUPTED, fromUnrecoverable.kind)
        val fromKeyStore = mapSecureStorageError(KeyStoreException("ks"))
        assertEquals(SecureStorageException.Kind.CORRUPTED, fromKeyStore.kind)
    }

    @Test
    fun testF3_GenericUnavailable() {
        val mapped = mapSecureStorageError(RuntimeException("boom"))
        assertEquals(SecureStorageException.Kind.UNAVAILABLE, mapped.kind)
        assertTrue(mapped.message!!.startsWith("[SECURE_STORAGE_UNAVAILABLE]"))
    }

    @Test
    fun testF3_Passthrough() {
        val original =
            SecureStorageException(SecureStorageException.Kind.LOCKED, "x")
        assertSame(original, mapSecureStorageError(original))
    }

    @Test
    fun testF3_StrongBoxDetection() {
        assertTrue(isStrongBoxUnavailable(StrongBoxUnavailableException()))
        assertTrue(
            isStrongBoxUnavailable(
                RuntimeException("wrap", StrongBoxUnavailableException()),
            ),
        )
        assertFalse(isStrongBoxUnavailable(RuntimeException("other")))
        assertFalse(isStrongBoxUnavailable(KeyPermanentlyInvalidatedException()))
    }
}
