package com.boldwallet

import android.util.Log

/**
 * JNI bridge to libbbmtmobile.so (BBMTLib/build-dkls.sh android, package ./bbmtmobile).
 * Exposes Dkls* only; GG18 continues to use gomobile tss.aar (Tss.*).
 */
object DklsNative {
    private const val TAG = "DklsNative"

    @Volatile
    private var loaded = false

    @Synchronized
    fun ensureLoaded(): Boolean {
        if (loaded) return true
        return try {
            System.loadLibrary("bbmtmobile")
            System.loadLibrary("dkls_jni")
            loaded = true
            Log.i(TAG, "libbbmtmobile + dkls_jni loaded")
            true
        } catch (e: UnsatisfiedLinkError) {
            Log.w(TAG, "DKLS native libs not available: ${e.message}")
            false
        }
    }

    fun isLoaded(): Boolean = loaded

    private fun unwrap(result: String): String {
        if (result.startsWith("error:")) {
            throw IllegalStateException(result.removePrefix("error:"))
        }
        return result
    }

    fun helloDkgNative(): String {
        check(loaded) { "libbbmtmobile not loaded" }
        return helloDkgJni()
    }

    private inline fun <T> loaded(block: () -> T): T {
        check(loaded) { "libbbmtmobile not loaded" }
        return block()
    }

    fun lanJoinKeygenNative(
        key: String,
        parties: String,
        session: String,
        server: String,
        chaincode: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
    ): String = loaded {
        unwrap(lanJoinKeygenJni(key, parties, session, server, chaincode, sessionKey, encKey, decKey))
    }

    fun nostrJoinKeygenNative(
        relays: String,
        nsec: String,
        peers: String,
        session: String,
        sessionKey: String,
        chaincode: String,
    ): String = loaded {
        unwrap(nostrJoinKeygenJni(relays, nsec, peers, session, sessionKey, chaincode))
    }

    fun mpcSignPsbtNative(
        server: String,
        key: String,
        parties: String,
        session: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        keyshare: String,
        psbt: String,
    ): String = loaded {
        unwrap(mpcSignPsbtJni(server, key, parties, session, sessionKey, encKey, decKey, keyshare, psbt))
    }

    fun nostrMpcSignPsbtNative(
        relays: String,
        nsec: String,
        parties: String,
        npubsSorted: String,
        keyshare: String,
        psbt: String,
    ): String = loaded {
        unwrap(nostrMpcSignPsbtJni(relays, nsec, parties, npubsSorted, keyshare, psbt))
    }

    fun mpcSendBtcWithUtxosNative(
        server: String,
        key: String,
        parties: String,
        session: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        keyshare: String,
        btcPub: String,
        toAddress: String,
        amount: String,
        fees: String,
        utxos: String,
        change: String,
    ): String = loaded {
        unwrap(
            mpcSendBtcWithUtxosJni(
                server, key, parties, session, sessionKey, encKey, decKey, keyshare,
                btcPub, toAddress, amount, fees, utxos, change,
            ),
        )
    }

    fun nostrMpcSendBtcWithUtxosNative(
        relays: String,
        nsec: String,
        parties: String,
        npubsSorted: String,
        balance: String,
        keyshare: String,
        toAddress: String,
        amount: String,
        fees: String,
        utxos: String,
        change: String,
    ): String = loaded {
        unwrap(
            nostrMpcSendBtcWithUtxosJni(
                relays, nsec, parties, npubsSorted, balance, keyshare,
                toAddress, amount, fees, utxos, change,
            ),
        )
    }

    fun cancelMpcSessionNative(sessionID: String): String {
        check(loaded) { "libbbmtmobile not loaded" }
        return cancelMpcSessionJni(sessionID)
    }

    fun cancelNostrMpcNative(): String {
        check(loaded) { "libbbmtmobile not loaded" }
        return cancelNostrMpcJni()
    }

    private external fun helloDkgJni(): String
    private external fun lanJoinKeygenJni(
        key: String,
        parties: String,
        session: String,
        server: String,
        chaincode: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
    ): String
    private external fun nostrJoinKeygenJni(
        relays: String,
        nsec: String,
        peers: String,
        session: String,
        sessionKey: String,
        chaincode: String,
    ): String
    private external fun nostrJoinKeysignJni(
        relays: String,
        nsec: String,
        peers: String,
        session: String,
        sessionKey: String,
        keyshare: String,
        message: String,
    ): String
    private external fun mpcSignPsbtJni(
        server: String,
        key: String,
        parties: String,
        session: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        keyshare: String,
        psbt: String,
    ): String
    private external fun nostrMpcSignPsbtJni(
        relays: String,
        nsec: String,
        parties: String,
        npubsSorted: String,
        keyshare: String,
        psbt: String,
    ): String
    private external fun mpcSendBtcWithUtxosJni(
        server: String,
        key: String,
        parties: String,
        session: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        keyshare: String,
        btcPub: String,
        toAddress: String,
        amount: String,
        fees: String,
        utxos: String,
        change: String,
    ): String
    private external fun nostrMpcSendBtcWithUtxosJni(
        relays: String,
        nsec: String,
        parties: String,
        npubsSorted: String,
        balance: String,
        keyshare: String,
        toAddress: String,
        amount: String,
        fees: String,
        utxos: String,
        change: String,
    ): String
    private external fun cancelMpcSessionJni(sessionID: String): String
    private external fun cancelNostrMpcJni(): String
}
