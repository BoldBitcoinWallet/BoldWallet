package com.boldwallet

import android.util.Log

/**
 * JNI bridge to libbbmtmobile.so (BBMTLib/build-dkls.sh android).
 * Single Go runtime: Bbmt* (GG18 + shared helpers) and Dkls* (DKLs MPC).
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

    fun cancelMpcSessionNative(sessionID: String): String = loaded {
        unwrap(cancelMpcSessionJni(sessionID))
    }

    fun cancelNostrMpcNative(): String = loaded {
        unwrap(cancelNostrMpcJni())
    }

    fun setBbmtHookListener(module: BBMTLibNativeModule) {
        if (!ensureLoaded()) {
            return
        }
        setBbmtHookListenerJni(module)
    }

    fun clearBbmtHookListener() {
        if (!loaded) {
            return
        }
        clearBbmtHookListenerJni()
    }

    fun bbmtGenerateKeyPairNative(): String = loaded { bbmtGenerateKeyPairJni() }

    fun bbmtSha256Native(msg: String): String = loaded { bbmtSha256Jni(msg) }

    fun bbmtFetchDataNative(url: String, decKey: String, payload: String): String =
        loaded { bbmtFetchDataJni(url, decKey, payload) }

    fun bbmtPublishDataNative(
        port: String,
        timeout: String,
        encKey: String,
        data: String,
        mode: String,
    ): String = loaded { bbmtPublishDataJni(port, timeout, encKey, data, mode) }

    fun bbmtListenForPeersNative(
        id: String,
        pubkey: String,
        port: String,
        timeout: String,
        mode: String,
    ): String = loaded { bbmtListenForPeersJni(id, pubkey, port, timeout, mode) }

    fun bbmtDiscoverPeersNative(
        id: String,
        pubkey: String,
        localIP: String,
        remoteIP: String,
        port: String,
        timeout: String,
        mode: String,
    ): String = loaded {
        bbmtDiscoverPeersJni(id, pubkey, localIP, remoteIP, port, timeout, mode)
    }

    fun bbmtRunRelayNative(port: String): String = loaded { bbmtRunRelayJni(port) }

    fun bbmtStopRelayNative(): String = loaded { bbmtStopRelayJni() }

    fun bbmtSetNetworkNative(network: String): String = loaded { bbmtSetNetworkJni(network) }
    fun bbmtGetNetworkNative(): String = loaded { bbmtGetNetworkJni() }
    fun bbmtUseFeePolicyNative(policy: String): String = loaded { bbmtUseFeePolicyJni(policy) }
    fun bbmtUseAPINative(network: String, base: String): String = loaded { bbmtUseAPIJni(network, base) }
    fun bbmtUseFeeAPIsNative(urls: String): String = loaded { bbmtUseFeeAPIsJni(urls) }
    fun bbmtTotalUTXONative(address: String): String = loaded { bbmtTotalUTXOJni(address) }
    fun bbmtSpendingHashNative(sender: String, receiver: String, amount: Long): String =
        loaded { bbmtSpendingHashJni(sender, receiver, amount) }
    fun bbmtSpendingHashWithUTXOsNative(utxos: String, receiver: String, amount: String): String =
        loaded { bbmtSpendingHashWithUTXOsJni(utxos, receiver, amount) }
    fun bbmtEstimateFeesNative(sender: String, receiver: String, amount: Long): String =
        loaded { bbmtEstimateFeesJni(sender, receiver, amount) }
    fun bbmtEstimateFeeWithUTXOsNative(
        utxos: String, receiver: String, amount: String, change: String,
    ): String = loaded { bbmtEstimateFeeWithUTXOsJni(utxos, receiver, amount, change) }
    fun bbmtPostTxNative(rawTx: String): String = loaded { bbmtPostTxJni(rawTx) }
    fun bbmtComputeTxIdNative(rawTx: String): String = loaded { bbmtComputeTxIdJni(rawTx) }
    fun bbmtAesEncryptNative(data: String, key: String): String = loaded { bbmtAesEncryptJni(data, key) }
    fun bbmtAesDecryptNative(data: String, key: String): String = loaded { bbmtAesDecryptJni(data, key) }
    fun bbmtSecP256k1RecoverNative(r: String, s: String, v: String, h: String): String =
        loaded { bbmtSecP256k1RecoverJni(r, s, v, h) }
    fun bbmtGetDerivedPubKeyNative(hexPub: String, hexChain: String, path: String, isEdDSA: Boolean): String =
        loaded { bbmtGetDerivedPubKeyJni(hexPub, hexChain, path, if (isEdDSA) 1 else 0) }
    fun bbmtEncodeXpubNative(hexPub: String, hexChain: String, network: String): String =
        loaded { bbmtEncodeXpubJni(hexPub, hexChain, network) }
    fun bbmtGetOutputDescriptorNative(
        hexPub: String, hexChain: String, network: String, addressType: String,
    ): String = loaded { bbmtGetOutputDescriptorJni(hexPub, hexChain, network, addressType) }
    fun bbmtAppendOutputDescriptorChecksumNative(descriptor: String): String =
        loaded { bbmtAppendOutputDescriptorChecksumJni(descriptor) }
    fun bbmtPubToP2WPKHNative(pub: String, network: String): String = loaded { bbmtPubToP2WPKHJni(pub, network) }
    fun bbmtPubToP2SHP2WKHNative(pub: String, network: String): String =
        loaded { bbmtPubToP2SHP2WKHJni(pub, network) }
    fun bbmtPubToP2TRNative(pub: String, network: String): String = loaded { bbmtPubToP2TRJni(pub, network) }
    fun bbmtPubToP2KHNative(pub: String, network: String): String = loaded { bbmtPubToP2KHJni(pub, network) }
    fun bbmtLocalPreParamsNative(ppmFile: String, timeoutMinutes: Long): String =
        loaded { bbmtLocalPreParamsJni(ppmFile, timeoutMinutes) }
    fun bbmtJoinKeygenNative(
        ppmPath: String, key: String, parties: String, encKey: String, decKey: String,
        session: String, server: String, chaincode: String, sessionKey: String,
    ): String = loaded {
        unwrap(
            bbmtJoinKeygenJni(
                ppmPath, key, parties, encKey, decKey, session, server, chaincode, sessionKey,
            ),
        )
    }
    fun bbmtNostrKeypairNative(): String = loaded { bbmtNostrKeypairJni() }
    fun bbmtHexToNpubNative(hexKey: String): String = loaded { bbmtHexToNpubJni(hexKey) }
    fun bbmtNostrJoinKeygenNative(
        relays: String, nsec: String, peers: String, session: String,
        sessionKey: String, chaincode: String, ppmPath: String,
    ): String = loaded {
        unwrap(bbmtNostrJoinKeygenJni(relays, nsec, peers, session, sessionKey, chaincode, ppmPath))
    }
    fun bbmtNostrJoinKeysignNative(
        relays: String, nsec: String, peers: String, session: String, sessionKey: String,
        keyshare: String, derivePath: String, message: String,
    ): String = loaded {
        unwrap(
            bbmtNostrJoinKeysignJni(
                relays, nsec, peers, session, sessionKey, keyshare, derivePath, message,
            ),
        )
    }
    fun bbmtMpcSignPSBTNative(
        server: String, key: String, parties: String, session: String, sessionKey: String,
        encKey: String, decKey: String, keyshare: String, psbt: String,
    ): String = loaded {
        unwrap(
            bbmtMpcSignPSBTJni(
                server, key, parties, session, sessionKey, encKey, decKey, keyshare, psbt,
            ),
        )
    }
    fun bbmtMpcSendBTCWithUTXOsNative(
        server: String, key: String, parties: String, session: String, sessionKey: String,
        encKey: String, decKey: String, keyshare: String, btcPub: String, receiver: String,
        amount: String, fees: String, utxos: String, change: String,
    ): String = loaded {
        unwrap(
            bbmtMpcSendBTCWithUTXOsJni(
                server, key, parties, session, sessionKey, encKey, decKey, keyshare, btcPub,
                receiver, amount, fees, utxos, change,
            ),
        )
    }
    fun bbmtNostrMpcSendBTCWithUTXOsNative(
        relays: String, nsec: String, parties: String, npubsSorted: String, balance: String,
        keyshare: String, receiver: String, amount: String, fees: String, utxos: String, change: String,
    ): String = loaded {
        unwrap(
            bbmtNostrMpcSendBTCWithUTXOsJni(
                relays, nsec, parties, npubsSorted, balance, keyshare,
                receiver, amount, fees, utxos, change,
            ),
        )
    }
    fun bbmtNostrMpcSignPSBTNative(
        relays: String, nsec: String, parties: String, npubsSorted: String, keyshare: String, psbt: String,
    ): String = loaded {
        unwrap(bbmtNostrMpcSignPSBTJni(relays, nsec, parties, npubsSorted, keyshare, psbt))
    }
    fun bbmtCancelMpcSessionNative(sessionID: String): String = loaded {
        unwrap(bbmtCancelMpcSessionJni(sessionID))
    }
    fun bbmtCancelNostrMpcNative(): String = loaded {
        unwrap(bbmtCancelNostrMpcJni())
    }
    fun bbmtDisableLogsNative() {
        if (!loaded) return
        bbmtDisableLogsJni()
    }
    fun bbmtParsePSBTDetailsNative(psbt: String): String = loaded { bbmtParsePSBTDetailsJni(psbt) }

    fun bbmtPsbtIdentityHashNative(psbt: String): String = loaded { unwrap(bbmtPsbtIdentityHashJni(psbt)) }

    private external fun helloDkgJni(): String
    private external fun bbmtGenerateKeyPairJni(): String
    private external fun bbmtSha256Jni(msg: String): String
    private external fun bbmtFetchDataJni(url: String, decKey: String, payload: String): String
    private external fun bbmtPublishDataJni(
        port: String,
        timeout: String,
        encKey: String,
        data: String,
        mode: String,
    ): String
    private external fun bbmtListenForPeersJni(
        id: String,
        pubkey: String,
        port: String,
        timeout: String,
        mode: String,
    ): String
    private external fun bbmtDiscoverPeersJni(
        id: String,
        pubkey: String,
        localIP: String,
        remoteIP: String,
        port: String,
        timeout: String,
        mode: String,
    ): String
    private external fun bbmtRunRelayJni(port: String): String
    private external fun bbmtStopRelayJni(): String
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
    private external fun setBbmtHookListenerJni(module: BBMTLibNativeModule)
    private external fun clearBbmtHookListenerJni()
    private external fun bbmtSetNetworkJni(network: String): String
    private external fun bbmtGetNetworkJni(): String
    private external fun bbmtUseFeePolicyJni(policy: String): String
    private external fun bbmtUseAPIJni(network: String, base: String): String
    private external fun bbmtUseFeeAPIsJni(urls: String): String
    private external fun bbmtTotalUTXOJni(address: String): String
    private external fun bbmtSpendingHashJni(sender: String, receiver: String, amount: Long): String
    private external fun bbmtSpendingHashWithUTXOsJni(utxos: String, receiver: String, amount: String): String
    private external fun bbmtEstimateFeesJni(sender: String, receiver: String, amount: Long): String
    private external fun bbmtEstimateFeeWithUTXOsJni(
        utxos: String, receiver: String, amount: String, change: String,
    ): String
    private external fun bbmtPostTxJni(rawTx: String): String
    private external fun bbmtComputeTxIdJni(rawTx: String): String
    private external fun bbmtAesEncryptJni(data: String, key: String): String
    private external fun bbmtAesDecryptJni(data: String, key: String): String
    private external fun bbmtSecP256k1RecoverJni(r: String, s: String, v: String, h: String): String
    private external fun bbmtGetDerivedPubKeyJni(hexPub: String, hexChain: String, path: String, isEdDSA: Int): String
    private external fun bbmtEncodeXpubJni(hexPub: String, hexChain: String, network: String): String
    private external fun bbmtGetOutputDescriptorJni(
        hexPub: String, hexChain: String, network: String, addressType: String,
    ): String
    private external fun bbmtAppendOutputDescriptorChecksumJni(descriptor: String): String
    private external fun bbmtPubToP2WPKHJni(pub: String, network: String): String
    private external fun bbmtPubToP2SHP2WKHJni(pub: String, network: String): String
    private external fun bbmtPubToP2TRJni(pub: String, network: String): String
    private external fun bbmtPubToP2KHJni(pub: String, network: String): String
    private external fun bbmtLocalPreParamsJni(ppmFile: String, timeoutMinutes: Long): String
    private external fun bbmtJoinKeygenJni(
        ppmPath: String, key: String, parties: String, encKey: String, decKey: String,
        session: String, server: String, chaincode: String, sessionKey: String,
    ): String
    private external fun bbmtNostrKeypairJni(): String
    private external fun bbmtHexToNpubJni(hexKey: String): String
    private external fun bbmtNostrJoinKeygenJni(
        relays: String, nsec: String, peers: String, session: String,
        sessionKey: String, chaincode: String, ppmPath: String,
    ): String
    private external fun bbmtNostrJoinKeysignJni(
        relays: String, nsec: String, peers: String, session: String, sessionKey: String,
        keyshare: String, derivePath: String, message: String,
    ): String
    private external fun bbmtMpcSignPSBTJni(
        server: String, key: String, parties: String, session: String, sessionKey: String,
        encKey: String, decKey: String, keyshare: String, psbt: String,
    ): String
    private external fun bbmtMpcSendBTCWithUTXOsJni(
        server: String, key: String, parties: String, session: String, sessionKey: String,
        encKey: String, decKey: String, keyshare: String, btcPub: String, receiver: String,
        amount: String, fees: String, utxos: String, change: String,
    ): String
    private external fun bbmtNostrMpcSendBTCWithUTXOsJni(
        relays: String, nsec: String, parties: String, npubsSorted: String, balance: String,
        keyshare: String, receiver: String, amount: String, fees: String, utxos: String, change: String,
    ): String
    private external fun bbmtNostrMpcSignPSBTJni(
        relays: String, nsec: String, parties: String, npubsSorted: String, keyshare: String, psbt: String,
    ): String
    private external fun bbmtCancelMpcSessionJni(sessionID: String): String
    private external fun bbmtCancelNostrMpcJni(): String
    private external fun bbmtDisableLogsJni()
    private external fun bbmtParsePSBTDetailsJni(psbt: String): String
    private external fun bbmtPsbtIdentityHashJni(psbt: String): String
}
