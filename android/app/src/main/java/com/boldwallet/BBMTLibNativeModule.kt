package com.boldwallet

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import tss.GoLogListener
import tss.HookListener

import tss.Tss

import java.net.NetworkInterface
import java.net.Inet4Address
import java.util.Collections

class BBMTLibNativeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), GoLogListener, HookListener {

    private var eventName: String = ""
    private var useLog = true

    init {
        eventName = "BBMT_DROID"
    }

    override fun onMessage(msg: String?) {
        msg?.let {
            sendLogEvent("TssHook", msg)
        }
        onGoLog(msg)
    }

    override fun onGoLog(msg: String?) {
        msg?.let { ld("GoLog", it) }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        Tss.setEventListener(this)
        Tss.setHookListener(this)
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        Tss.setEventListener(null)
    }

    private fun sendLogEvent(tag: String, msg: String) {
        try {
            val params = Arguments.createMap()
            params.putString("tag", tag)
            params.putString("message", msg)
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        } catch (_: Throwable) {

        }
    }

    override fun getName(): String {
        return "BBMTLibNativeModule"
    }

    private fun ld(tag: String, debug: String) {
        if(useLog) {
            sendLogEvent(tag, debug)
            Log.d(tag, debug)
        }
    }

    override fun getConstants(): MutableMap<String, Any> {
        return mutableMapOf(
            "LOG_EVENT_NAME" to "BBMT_DROID"
        )
    }

    @ReactMethod
    fun disableLogging(tag: String, promise: Promise) {
        useLog = false
        Tss.disableLogs()
        promise.resolve(tag)
    }

    @ReactMethod
    fun setBtcNetwork(network: String, promise: Promise) {
        try {
            Tss.setNetwork(network)
            val result = Tss.getNetwork()
            ld("setBtcNetwork", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("setBtcNetwork", "error: ${e.stackTraceToString()}")
            promise.reject(e)
        }
    }

    @ReactMethod
    fun setFeePolicy(policy: String, promise: Promise) {
        try {
            val result = Tss.useFeePolicy(policy)
            ld("setFeePolicy", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("setFeePolicy", "error: ${e.stackTraceToString()}")
            promise.reject(e)
        }
    }

    @ReactMethod
    fun totalUTXO(address: String, promise: Promise) {
        try {
            val result = Tss.totalUTXO(address)
            ld("totalUTXO", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("totalUTXO", "error: ${e.stackTraceToString()}")
            promise.reject(e)
        }
    }


    @ReactMethod
    fun setAPI(network: String, baseAPI: String, promise: Promise) {
        try {
            val result = Tss.useAPI(network, baseAPI)
            ld("setAPI", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("setAPI", "error: ${e.stackTraceToString()}")
            promise.reject(e)
        }
    }
    
    @ReactMethod
    fun setFeeAPIs(urls: String, promise: Promise) {
        try {
            val result = Tss.useFeeAPIs(urls)
            ld("setFeeAPIs", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("setFeeAPIs", "error: ${e.stackTraceToString()}")
            promise.reject(e)
        }
    }

    @ReactMethod
    fun spendingHash(senderAddress: String, receiverAddress: String, amountSatoshi: String, promise: Promise) {
        Thread {
            try {
                val amt = amountSatoshi.toLong()
                val result =
                    Tss.spendingHash(senderAddress, receiverAddress, amt)
                ld("spendingHash", result)
                promise.resolve(result)
            } catch (e: Exception) {
                ld("spendingHash", "error: ${e.stackTraceToString()}")
                promise.reject(e)
            }
        }.start()
    }

    @ReactMethod
    fun spendingHashWithUTXOs(utxosWithPathsJSON: String, receiverAddress: String, amountSatoshi: String, promise: Promise) {
        Thread {
            try {
                val result = Tss.spendingHashWithUTXOs(utxosWithPathsJSON, receiverAddress, amountSatoshi)
                ld("spendingHashWithUTXOs", result)
                promise.resolve(result)
            } catch (e: Exception) {
                ld("spendingHashWithUTXOs", "error: ${e.stackTraceToString()}")
                promise.reject(e)
            }
        }.start()
    }

    @ReactMethod
    fun estimateFees(senderAddress: String, receiverAddress: String, amountSatoshi: String, promise: Promise) {
        Thread {
            try {
                val amt = amountSatoshi.toLong()
                val result =
                    Tss.estimateFees(senderAddress, receiverAddress, amt)
                ld("estimateFee", result)
                promise.resolve(result)
            } catch (e: Exception) {
                ld("estimateFee", "error: ${e.stackTraceToString()}")
                promise.reject(e)
            }
        }.start()
    }

    @ReactMethod
    fun estimateFeeWithUTXOs(
        utxosWithPathsJSON: String,
        receiverAddress: String,
        amountSatoshi: String,
        changeAddress: String,
        promise: Promise
    ) {
        Thread {
            try {
                val result = Tss.estimateFeeWithUTXOs(
                    utxosWithPathsJSON,
                    receiverAddress,
                    amountSatoshi,
                    changeAddress
                )
                ld("estimateFeeWithUTXOs", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("estimateFeeWithUTXOs", "error: ${e.stackTraceToString()}")
                promise.reject(e)
            }
        }.start()
    }

    @ReactMethod
    fun mpcSendBTC(
        // tss
        server: String,
        partyID: String,
        partiesCSV: String,
        sessionID: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        keyshare: String,
        derivation: String,
        // btc
        publicKey: String,
        senderAddress: String,
        receiverAddress: String,
        amountSatoshi: String,
        feeSatoshi: String,
        promise: Promise) {
        Thread {
            try {
                val result = Tss.mpcSendBTC(server,
                    partyID,
                    partiesCSV,
                    sessionID,
                    sessionKey,
                    encKey,
                    decKey,
                    keyshare,
                    derivation,
                    publicKey,
                    senderAddress,
                    receiverAddress,
                    amountSatoshi.toLong(),
                    feeSatoshi.toLong())
                ld("mpcSendBTC", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("mpcSendBTC", "error: ${e.stackTraceToString()}")
                promise.reject("MPC_SEND_BTC_ERROR", "Failed to send BTC: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun mpcSendBTCWithUTXOs(
        server: String,
        partyID: String,
        partiesCSV: String,
        sessionID: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        keyshare: String,
        publicKey: String,
        receiverAddress: String,
        amountSatoshi: String,
        feeSatoshi: String,
        utxosWithPathsJSON: String,
        changeAddress: String,
        promise: Promise
    ) {
        Thread {
            try {
                val result = Tss.mpcSendBTCWithUTXOs(
                    server,
                    partyID,
                    partiesCSV,
                    sessionID,
                    sessionKey,
                    encKey,
                    decKey,
                    keyshare,
                    publicKey,
                    receiverAddress,
                    amountSatoshi,
                    feeSatoshi,
                    utxosWithPathsJSON,
                    changeAddress
                )
                ld("mpcSendBTCWithUTXOs", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("mpcSendBTCWithUTXOs", "error: ${e.stackTraceToString()}")
                promise.reject("MPC_SEND_BTC_ERROR", "Failed to send BTC: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun nostrMpcSendBTC(
        relaysCSV: String,
        partyNsec: String,
        partiesNpubsCSV: String,
        npubsSorted: String,
        balanceSats: String,
        keyshareJSON: String,
        derivePath: String,
        publicKey: String,
        senderAddress: String,
        receiverAddress: String,
        amountSatoshi: String,
        estimatedFee: String,
        changeAddress: String,
        promise: Promise
    ) {
        Thread {
            try {
                val result = Tss.nostrMpcSendBTC(
                    relaysCSV,
                    partyNsec,
                    partiesNpubsCSV,
                    npubsSorted,
                    balanceSats,
                    keyshareJSON,
                    derivePath,
                    publicKey,
                    senderAddress,
                    receiverAddress,
                    amountSatoshi.toLong(),
                    estimatedFee.toLong(),
                    changeAddress ?: ""
                )
                ld("nostrMpcSendBTC", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("nostrMpcSendBTC", "error: ${e.stackTraceToString()}")
                promise.reject("NOSTR_MPC_SEND_BTC_ERROR", "Failed to send BTC via Nostr: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun nostrMpcSendBTCWithUTXOs(
        relaysCSV: String,
        partyNsec: String,
        partiesNpubsCSV: String,
        npubsSorted: String,
        balanceSats: String,
        keyshareJSON: String,
        receiverAddress: String,
        amountSatoshi: String,
        estimatedFee: String,
        utxosWithPathsJSON: String,
        changeAddress: String,
        promise: Promise
    ) {
        Thread {
            try {
                val result = Tss.nostrMpcSendBTCWithUTXOs(
                    relaysCSV,
                    partyNsec,
                    partiesNpubsCSV,
                    npubsSorted,
                    balanceSats,
                    keyshareJSON,
                    receiverAddress,
                    amountSatoshi,
                    estimatedFee,
                    utxosWithPathsJSON,
                    changeAddress ?: ""
                )
                ld("nostrMpcSendBTCWithUTXOs", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("nostrMpcSendBTCWithUTXOs", "error: ${e.stackTraceToString()}")
                promise.reject("NOSTR_MPC_SEND_BTC_ERROR", "Failed to send BTC via Nostr: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun postTx(rawTxHex: String, promise: Promise) {
        Thread {
            try {
                val txid = Tss.postTx(rawTxHex)
                ld("postTx", txid)
                promise.resolve(txid)
            } catch (e: Throwable) {
                ld("postTx", "error: ${e.stackTraceToString()}")
                promise.reject("POST_TX_ERROR", "Failed to broadcast: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun computeTxId(rawTxHex: String, promise: Promise) {
        try {
            val txid = Tss.computeTxId(rawTxHex)
            promise.resolve(txid)
        } catch (e: Throwable) {
            promise.reject("COMPUTE_TXID_ERROR", "Failed to compute txid: ${e.message}", e)
        }
    }

    @ReactMethod
    fun cancelMpcSession(sessionID: String, promise: Promise) {
        try {
            val out = Tss.cancelMpcSession(sessionID)
            promise.resolve(out)
        } catch (e: Throwable) {
            promise.reject("CANCEL_MPC_ERROR", "Failed to cancel MPC session: ${e.message}", e)
        }
    }

    @ReactMethod
    fun cancelNostrMpc(promise: Promise) {
        try {
            val out = Tss.cancelNostrMpc()
            promise.resolve(out)
        } catch (e: Throwable) {
            promise.reject("CANCEL_NOSTR_MPC_ERROR", "Failed to cancel Nostr MPC: ${e.message}", e)
        }
    }

    @ReactMethod
    fun runRelay(port: String, promise: Promise) {
        try {
            val result = Tss.runRelay(port)
            ld("runRelay",result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("runRelay", "error: ${e.stackTraceToString()}")
            promise.reject(e)
        }
    }

    @ReactMethod
    fun stopRelay(tag: String, promise: Promise) {
        try {
            val result = Tss.stopRelay()
            ld("stopRelay","$tag:$result")
            promise.resolve(result)
        } catch (e: Exception) {
            ld("stopRelay", "error: ${e.stackTraceToString()}")
            promise.resolve(tag)
        }
    }

    @ReactMethod
    fun publishData(port: String, timeout: String, encKey: String, raw: String, mode: String,
                    promise: Promise) {
        Thread {
            try {
                val output = Tss.publishData(port, timeout, encKey, raw, mode)
                ld("publishData", output)
                promise.resolve(output)
            } catch (e: Throwable) {
                ld("publishData", "error: ${e.message}")
                promise.resolve("")
            }
        }.start()
    }

    @ReactMethod
    fun fetchData(url: String, decKey: String, payload: String, promise: Promise) {
        Thread {
            try {
                val raw = Tss.fetchData(url, decKey, payload)
                ld("fetchData", raw)
                promise.resolve(raw)
            } catch (e: Throwable) {
                ld("fetchData", "error: ${e.message}")
                promise.resolve("")
            }
        }.start()
    }

    @ReactMethod
    fun listenForPeers(id: String, pubkey: String, port: String, timeout: String, mode: String, promise: Promise) {
        Thread {
            try {
                val peer = Tss.listenForPeers(id, pubkey, port, timeout, mode)
                ld("listenForPeers", peer)
                promise.resolve(peer)
            } catch (e: Throwable) {
                ld("listenForPeers", "error: ${e.message}")
                promise.resolve("")
            }
        }.start()
    }

    @ReactMethod
    fun discoverPeers(id: String, pubkey: String, localIP: String, remoteIP: String, port: String, timeout: String, mode: String, promise: Promise) {
        Thread {
            try {
                val peer = Tss.discoverPeers(id, pubkey, localIP, remoteIP, port, timeout, mode)
                ld("discoverPeers", peer)
                promise.resolve(peer)
            } catch (e: Throwable) {
                ld("discoverPeers", "error: ${e.message}")
                promise.resolve("")
            }
        }.start()
    }

    @ReactMethod
    fun getLanIp(peerIP: String, promise: Promise) {
        var resolved = false
        try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            var fallbackIp: String? = null
            var iphoneHotspotIp: String? = null
            var classCIP: String? = null
            var sameSubnetIp: String? = null

            // Only check subnet if peerIP is not empty and is valid IPv4
            val checkSubnet = peerIP.isNotEmpty() && peerIP.matches(Regex("^\\d+\\.\\d+\\.\\d+\\.\\d+$"))

            for (networkInterface in interfaces) {
                val addresses = networkInterface.inetAddresses
                for (inetAddress in Collections.list(addresses)) {
                    if (!inetAddress.isLoopbackAddress && inetAddress is Inet4Address) {
                        val ip = inetAddress.hostAddress
                        if (ip != null) {
                            // Check if this IP is in the same subnet as peerIP
                            if (checkSubnet && isSameSubnet(ip, peerIP)) {
                                sameSubnetIp = ip
                                break
                            }
                            if (isClassC(ip)) {
                                classCIP = ip
                            }
                            else if (ip.startsWith("172.20.10.")) {
                                iphoneHotspotIp = ip
                            }
                            else {
                                fallbackIp = ip
                            }
                        }
                    }
                }
            }

            // Determine which IP to return (prioritized order)
            val resultIp = sameSubnetIp ?: iphoneHotspotIp ?: classCIP ?: fallbackIp
            val result = resultIp ?: ""
            
            // Log the result type
            when {
                sameSubnetIp != null -> ld("getLanIp (Same Subnet)", result)
                iphoneHotspotIp != null -> ld("getLanIp (iPhone Hotspot)", result)
                classCIP != null -> ld("getLanIp (Class C)", result)
                fallbackIp != null -> ld("getLanIp (Fallback)", result)
                else -> ld("getLanIp", result)
            }
            
            // Resolve promise only once
            if (!resolved) {
                resolved = true
                promise.resolve(result)
            }
        } catch (e: Exception) {
            e.printStackTrace()
            ld("getLanIp", "error: ${e.message}")
            // Only resolve if promise hasn't been resolved yet
            if (!resolved) {
                resolved = true
                promise.resolve("")
            }
        }
    }

    // Helper function to check if two IPs are in the same subnet
    private fun isSameSubnet(ip1: String, ip2: String): Boolean {
        try {
            val parts1 = ip1.split(".")
            val parts2 = ip2.split(".")

            // Assuming a typical /24 subnet mask (255.255.255.0)
            // Compare first 3 octets
            return parts1[0] == parts2[0] &&
                    parts1[1] == parts2[1] &&
                    parts1[2] == parts2[2]
        } catch (e: Exception) {
            return false
        }
    }
    
    private fun isClassC(ip: String): Boolean {
        val parts = ip.split(".").mapNotNull { it.toIntOrNull() }
        return parts.size == 4 && parts[0] in 192..223
    }
    
    @ReactMethod
    fun nostrKeypair(promise: Promise) {
        try {
            val result = Tss.nostrKeypair()
            ld("nostrKeypair", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("nostrKeypair", "error: ${e.stackTraceToString()}")
            promise.resolve(e.message)
        }
    }

    @ReactMethod
    fun hexToNpub(hexKey: String, promise: Promise) {
        Thread {
            try {
                val result = Tss.hexToNpub(hexKey)
                ld("hexToNpub", result)
                promise.resolve(result)
            } catch (e: Exception) {
                ld("hexToNpub", "error: ${e.stackTraceToString()}")
                promise.resolve(e.message)
            }
        }.start()
    }

    @ReactMethod
    fun nostrMpcTssSetup(
        relaysCSV: String,
        partyNsec: String,
        partiesNpubsCSV: String,
        sessionID: String,
        sessionKey: String,
        chaincode: String,
        ppmFile: String,
        promise: Promise
    ) {
        Thread {
            try {
                val result = Tss.nostrJoinKeygen(
                    relaysCSV,
                    partyNsec,
                    partiesNpubsCSV,
                    sessionID,
                    sessionKey,
                    chaincode,
                    ppmFile
                )
                ld("nostrMpcTssSetup", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("nostrMpcTssSetup", "error: ${e.stackTraceToString()}")
                promise.reject("NOSTR_MPC_TSS_SETUP_ERROR", "Failed to setup TSS via Nostr: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun nostrJoinKeysign(
        relaysCSV: String,
        partyNsec: String,
        partiesNpubsCSV: String,
        sessionID: String,
        sessionKey: String,
        keyshareJSON: String,
        derivationPath: String,
        message: String,
        promise: Promise
    ) {
        Thread {
            try {
                val result = Tss.nostrJoinKeysign(
                    relaysCSV,
                    partyNsec,
                    partiesNpubsCSV,
                    sessionID,
                    sessionKey,
                    keyshareJSON,
                    derivationPath,
                    message
                )
                ld("nostrJoinKeysign", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("nostrJoinKeysign", "error: ${e.stackTraceToString()}")
                promise.reject("NOSTR_JOIN_KEYSIGN_ERROR", "Failed to join keysign via Nostr: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun mpcTssSetup(
        server: String,
        partyID: String,
        ppmFile: String,
        partiesCSV: String,
        sessionID: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        chaincode: String,
        promise: Promise
    ) {
        Thread {
            try {
                val result = Tss.joinKeygen(
                    ppmFile,
                    partyID,
                    partiesCSV,
                    encKey,
                    decKey,
                    sessionID,
                    server,
                    chaincode,
                    sessionKey
                )
                ld("mpcTssSetup", result.toString())
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("mpcTssSetup", "error: ${e.stackTraceToString()}")
                promise.reject("MPC_TSS_SETUP_ERROR", "Failed to setup TSS: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun preparams(partyID: String, timeout: String, promise: Promise) {
        Thread {
            try {
                val result = Tss.localPreParams(partyID, timeout.toLong())
                ld("preparams", result.toString())
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("preparams", "error: ${e.stackTraceToString()}")
                promise.reject("PREPARAMS_ERROR", "Failed to generate pre-params: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun recoverPubkey(r: String, s: String, v: String, h: String, promise: Promise) {
        try {
            val result = Tss.secP256k1Recover(r, s, v, h)
            ld("recoverPubkey", result)
            promise.resolve(result)
        } catch (e: Throwable) {
            ld("recoverPubkey", "error: ${e.stackTraceToString()}")
            promise.reject("RECOVER_PUBKEY_ERROR", "Failed to recover pubkey: ${e.message}", e)
        }
    }

    @ReactMethod
    fun derivePubkey(hexPubkey: String, hexChaincode: String, path: String, promise: Promise) {
        try {
            val result = Tss.getDerivedPubKey(hexPubkey, hexChaincode, path, false)
            ld("derivePubkey", result)
            promise.resolve(result)
        } catch (e: Throwable) {
            ld("derivePubkey", "error: ${e.stackTraceToString()}")
            promise.reject("DERIVE_PUBKEY_ERROR", "Failed to derive pubkey: ${e.message}", e)
        }
    }

    @ReactMethod
    fun encodeXpub(hexPubkey: String, hexChaincode: String, network: String, promise: Promise) {
        try {
            val result = Tss.encodeXpub(hexPubkey, hexChaincode, network)
            ld("encodeXpub", result)
            promise.resolve(result)
        } catch (e: Throwable) {
            ld("encodeXpub", "error: ${e.stackTraceToString()}")
            promise.reject("ENCODE_XPUB_ERROR", "Failed to encode xpub: ${e.message}", e)
        }
    }

    @ReactMethod
    fun getOutputDescriptor(hexPubkey: String, hexChaincode: String, network: String, addressType: String, promise: Promise) {
        try {
            val result = Tss.getOutputDescriptor(hexPubkey, hexChaincode, network, addressType)
            ld("getOutputDescriptor", result)
            promise.resolve(result)
        } catch (e: Throwable) {
            ld("getOutputDescriptor", "error: ${e.stackTraceToString()}")
            promise.reject("GET_OUTPUT_DESCRIPTOR_ERROR", "Failed to get output descriptor: ${e.message}", e)
        }
    }

    @ReactMethod
    fun btcAddress(compressedPubkey: String, network: String, addressType: String,  promise: Promise) {
        var resolved = false
        try {
            val result = when(addressType) {
                "segwit-native" -> Tss.pubToP2WPKH(compressedPubkey, network)
                "segwit-compatible" -> Tss.pubToP2SHP2WKH(compressedPubkey, network)
                "taproot" -> Tss.pubToP2TR(compressedPubkey, network)
                "legacy" -> Tss.pubToP2KH(compressedPubkey, network)
                else -> {
                    ld("btcAddress", "invalid-address type")
                    ""
                }
            }
            ld("btcAddress", result)
            if (!resolved) {
                resolved = true
                promise.resolve(result)
            }
        } catch (e: Throwable) {
            ld("btcAddress", "error: ${e.stackTraceToString()}")
            if (!resolved) {
                resolved = true
                promise.reject("BTC_ADDRESS_ERROR", "Failed to generate BTC address: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun eciesKeypair(promise: Promise) {
        try {
            val result = Tss.generateKeyPair()
            ld("eciesKeypair", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("eciesKeypair", "error: ${e.stackTraceToString()}")
            promise.resolve(e.message)
        }
    }

    @ReactMethod
    fun aesEncrypt(data: String, key: String, promise: Promise) {
        try {
            val result = Tss.aesEncrypt(data, key)
            ld("aesEncrypt", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("aesEncrypt", "error: ${e.stackTraceToString()}")
            promise.resolve(e.message)
        }
    }

    @ReactMethod
    fun aesDecrypt(data: String, key: String, promise: Promise) {
        try {
            val result = Tss.aesDecrypt(data, key)
            ld("aesDecrypt", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("aesDecrypt", "error: ${e.stackTraceToString()}")
            promise.resolve(e.message)
        }
    }

    @ReactMethod
    fun sha256(msg: String, promise: Promise) {
        try {
            val result = Tss.sha256(msg)
            ld("sha256", result)
            promise.resolve(result)
        } catch (e: Throwable) {
            ld("sha256", "error: ${e.stackTraceToString()}")
            promise.reject("SHA256_ERROR", "Failed to compute SHA256: ${e.message}", e)
        }
    }

    @ReactMethod
    fun mpcSignPSBT(
        // tss
        server: String,
        partyID: String,
        partiesCSV: String,
        sessionID: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        keyshare: String,
        // psbt
        psbtBase64: String,
        promise: Promise
    ) {
        Thread {
            try {
                val result = Tss.mpcSignPSBT(
                    server,
                    partyID,
                    partiesCSV,
                    sessionID,
                    sessionKey,
                    encKey,
                    decKey,
                    keyshare,
                    psbtBase64
                )
                ld("mpcSignPSBT signed:", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("mpcSignPSBT", "error: ${e.stackTraceToString()}")
                promise.reject("MPC_SIGN_PSBT_ERROR", "Failed to sign PSBT: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun nostrMpcSignPSBT(
        relaysCSV: String,
        partyNsec: String,
        partiesNpubsCSV: String,
        npubsSorted: String,
        keyshareJSON: String,
        psbtBase64: String,
        promise: Promise
    ) {
        Thread {
            try {
                val result = Tss.nostrMpcSignPSBT(
                    relaysCSV,
                    partyNsec,
                    partiesNpubsCSV,
                    npubsSorted,
                    keyshareJSON,
                    psbtBase64
                )
                ld("nostrMpcSignPSBT", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("nostrMpcSignPSBT", "error: ${e.stackTraceToString()}")
                promise.reject("NOSTR_MPC_SIGN_PSBT_ERROR", "Failed to sign PSBT via Nostr: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun parsePSBTDetails(psbtBase64: String, promise: Promise) {
        Thread {
            try {
                val result = Tss.parsePSBTDetails(psbtBase64)
                ld("parsePSBTDetails", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("parsePSBTDetails", "error: ${e.stackTraceToString()}")
                promise.reject("PARSE_PSBT_ERROR", "Failed to parse PSBT: ${e.message}", e)
            }
        }.start()
    }
}
