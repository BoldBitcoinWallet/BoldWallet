package com.boldwallet

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.StrongBoxUnavailableException
import android.security.keystore.UserNotAuthenticatedException
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStoreException
import java.security.UnrecoverableKeyException

/**
 * F3: typed secure-storage failures. The message always carries a stable
 * `[SECURE_STORAGE_<KIND>]` prefix so the JS layer can map it to user-facing
 * copy regardless of which promise-reject shape a call site uses.
 */
class SecureStorageException(
    val kind: Kind,
    detail: String,
    cause: Throwable? = null,
) : Exception("[SECURE_STORAGE_${kind.name}] $detail", cause) {
    enum class Kind {
        /** Biometric enrollment changed or screen lock removed. */
        INVALIDATED,

        /** Device locked; authentication required. */
        LOCKED,

        /** Keystore entry corrupt or unrecoverable. */
        CORRUPTED,

        /** Any other Keystore/ESP failure. Never a plaintext fallback. */
        UNAVAILABLE,
    }
}

/** Maps every MasterKey/ESP failure mode to a typed error. Never returns null. */
internal fun mapSecureStorageError(e: Throwable): SecureStorageException =
    when (e) {
        is SecureStorageException -> e
        is KeyPermanentlyInvalidatedException ->
            SecureStorageException(
                SecureStorageException.Kind.INVALIDATED,
                "Device lock changed; secure storage must be re-created. Your keyshare was not saved/read.",
                e,
            )
        is UserNotAuthenticatedException ->
            SecureStorageException(
                SecureStorageException.Kind.LOCKED,
                "Device must be unlocked. Your keyshare was not saved/read.",
                e,
            )
        is UnrecoverableKeyException, is KeyStoreException ->
            SecureStorageException(
                SecureStorageException.Kind.CORRUPTED,
                "Secure storage is corrupted. Your keyshare was not saved/read.",
                e,
            )
        else ->
            SecureStorageException(
                SecureStorageException.Kind.UNAVAILABLE,
                "Secure storage unavailable. Your keyshare was not saved/read.",
                e,
            )
    }

/**
 * Opens EncryptedSharedPreferences with StrongBox-first policy (API 28+),
 * TEE fallback, and fail-closed semantics. Throws [SecureStorageException]
 * on every failure path — there is intentionally no plaintext fallback.
 *
 * NOTE on `setUserAuthenticationRequired`: deliberately NOT set. The keyshare
 * is read on flows that run while backgrounded (ceremony progress, resume),
 * where per-read authentication would fail spuriously. Device-unlock-grade
 * binding (Keystore keys unusable while locked) plus StrongBox/TEE hardware
 * backing is the enforced bar; per-ceremony biometric unlock belongs with
 * native-held shares (F15b).
 */
internal fun openSecurePrefs(
    context: Context,
    fileName: String,
): SharedPreferences {
    if (Build.VERSION.SDK_INT >= 28) {
        try {
            return openEsp(context, fileName, strongBox = true)
        } catch (e: Exception) {
            // Only StrongBox absence falls through to TEE; every other
            // failure (invalidated, locked, corrupted) throws immediately.
            if (!isStrongBoxUnavailable(e)) throw mapSecureStorageError(e)
            Log.w("SecureStorage", "StrongBox unavailable, using TEE", e)
        }
    }
    try {
        return openEsp(context, fileName, strongBox = false)
    } catch (e: Exception) {
        throw mapSecureStorageError(e)
    }
}

private fun openEsp(
    context: Context,
    fileName: String,
    strongBox: Boolean,
): SharedPreferences {
    val masterKey =
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .apply { if (strongBox) setRequestStrongBoxBacked(true) }
            .build()
    return EncryptedSharedPreferences.create(
        context,
        fileName,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
}

internal fun isStrongBoxUnavailable(e: Throwable): Boolean {
    var cur: Throwable? = e
    while (cur != null) {
        if (cur is StrongBoxUnavailableException) return true
        cur = cur.cause
    }
    return false
}
