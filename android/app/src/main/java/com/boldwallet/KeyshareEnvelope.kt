package com.boldwallet

import android.content.SharedPreferences
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * F15b-1 envelope facade: device-bound AES-256-GCM key from the
 * Android Keystore (TEE) sealing the RNES `keyshare` value, so
 * JS-direct RNES reads yield ciphertext. All failures map to
 * [SecureStorageException] (F3 copy reused).
 *
 * Device-unlock grade (no setUserAuthenticationRequired), same
 * rationale as F3: keyshare reads happen on backgrounded
 * ceremony paths. TEE (no StrongBox dance): the threat
 * addressed here is JS-reads, not hardware extraction — the
 * ESP MasterKey is already StrongBox-first.
 */
object KeyshareEnvelope {
    const val KEY_ALIAS = "BoldWalletKeyshareEnvelope"

    /** RNES key holding the envelope mid-migration (crash recovery). */
    const val STAGING_SUFFIX = "_migrating"

    private const val TAG = "KeyshareEnvelope"

    private val b64encode: (ByteArray) -> String = {
        Base64.encodeToString(it, Base64.NO_WRAP)
    }
    private val b64decode: (String) -> ByteArray = {
        Base64.decode(it, Base64.NO_WRAP)
    }

    fun isEnvelope(value: String): Boolean = AesGcmEnvelope.isEnvelope(value)

    fun encryptKeyshareJson(json: String): String {
        try {
            return AesGcmEnvelope.seal(json.toByteArray(Charsets.UTF_8), envelopeKey(), b64encode)
        } catch (e: Exception) {
            throw mapSecureStorageError(e)
        }
    }

    fun decryptKeyshareJson(envelope: String): String {
        try {
            val bytes = AesGcmEnvelope.open(envelope, envelopeKey(), b64decode)
            return bytes.toString(Charsets.UTF_8)
        } catch (e: IllegalArgumentException) {
            // Malformed envelope: stored value is corrupt — direct
            // the user to backup re-import (CORRUPTED copy).
            throw SecureStorageException(
                SecureStorageException.Kind.CORRUPTED,
                "Secure storage is corrupted. Your keyshare was not saved/read. " +
                    "Please re-import your keyshare backup.",
                e,
            )
        } catch (e: Exception) {
            throw mapSecureStorageError(e)
        }
    }

    /**
     * Migration protocol (§1.5): plaintext `key` → envelope, atomic
     * via a staging key, retry-safe across crashes. All RNES writes
     * use commit() (synchronous). Sanitized logging only (lengths,
     * booleans, step markers — never values).
     *
     * @return true when a migration ran, false when already enveloped
     * or no keyshare stored (fresh install — not an error).
     */
    fun ensureEnveloped(prefs: SharedPreferences, key: String): Boolean {
        val stagingKey = key + STAGING_SUFFIX
        val current = try {
            prefs.getString(key, null)
        } catch (e: Exception) {
            throw mapSecureStorageError(e)
        }
        if (current == null) {
            Log.i(TAG, "ensureEnveloped: no stored keyshare, nothing to do")
            return false
        }
        if (isEnvelope(current)) {
            // Converged already; drop any leftover staging entry.
            if (prefs.contains(stagingKey)) {
                prefs.edit().remove(stagingKey).commit()
                Log.i(TAG, "ensureEnveloped: dropped leftover staging entry")
            }
            return false
        }
        if (!current.contains("\"pub_key\"")) {
            throw SecureStorageException(
                SecureStorageException.Kind.CORRUPTED,
                "Secure storage is corrupted. Your keyshare was not saved/read. " +
                    "Please re-import your keyshare backup.",
            )
        }
        Log.i(TAG, "ensureEnveloped: migrating plaintext len=${current.length}")
        // Resume-or-start: a valid staging entry means a crash after
        // step (2); re-seal otherwise (fresh nonce each attempt).
        val staged: String? = try {
            prefs.getString(stagingKey, null)
        } catch (e: Exception) {
            throw mapSecureStorageError(e)
        }
        val envelope: String
        if (staged != null && isEnvelope(staged) && stagesMatchCurrent(staged, current)) {
            Log.i(TAG, "ensureEnveloped: resuming from valid staging entry")
            envelope = staged
        } else {
            envelope = encryptKeyshareJson(current)
            prefs.edit().putString(stagingKey, envelope).commit()
            // Read-back + decrypt-compare before promote.
            val check = prefs.getString(stagingKey, null)
                ?: throw mapSecureStorageError(
                    IllegalStateException("staging read-back missing"),
                )
            if (decryptKeyshareJson(check) != current) {
                throw mapSecureStorageError(
                    IllegalStateException("staging verify mismatch"),
                )
            }
            Log.i(TAG, "ensureEnveloped: staged len=${envelope.length}, verified")
        }
        // Promote: overwrite key (plaintext gone atomically at the
        // ESP file layer), verify, delete staging.
        prefs.edit().putString(key, envelope).commit()
        val promoted = prefs.getString(key, null)
            ?: throw mapSecureStorageError(IllegalStateException("promote read-back missing"))
        if (!isEnvelope(promoted) || decryptKeyshareJson(promoted) != current) {
            throw mapSecureStorageError(IllegalStateException("promote verify mismatch"))
        }
        prefs.edit().remove(stagingKey).commit()
        Log.i(TAG, "ensureEnveloped: promoted ok")
        return true
    }

    /** True when staging decrypts to exactly the current plaintext. */
    private fun stagesMatchCurrent(staged: String, current: String): Boolean {
        return try {
            decryptKeyshareJson(staged) == current
        } catch (e: Exception) {
            Log.i(TAG, "ensureEnveloped: staging invalid, re-sealing")
            false
        }
    }

    internal fun envelopeKey(): SecretKey {
        try {
            val ks = KeyStore.getInstance("AndroidKeyStore")
            ks.load(null)
            val entry = ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
            if (entry != null) return entry.secretKey
            val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            val spec = android.security.keystore.KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
            gen.init(spec)
            Log.i(TAG, "envelopeKey: generated new device key")
            return gen.generateKey()
        } catch (e: Exception) {
            throw mapSecureStorageError(e)
        }
    }

}
