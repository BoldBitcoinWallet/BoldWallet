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
            } catch (e: Exception) {
                ld("mpcSendBTC", "error: ${e.stackTraceToString()}")
                promise.reject(e)
            }
        }.start()
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
    fun publishData(port: String, timeout: String, encKey: String, raw: String,
                    promise: Promise) {
        Thread {
            try {
                val output = Tss.publishData(port, timeout, encKey, raw)
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
    fun listenForPeer(id: String, pubkey: String, port: String, timeout: String, promise: Promise) {
        Thread {
            try {
                val peer = Tss.listenForPeer(id, pubkey, port, timeout)
                ld("listenForPeer", peer)
                promise.resolve(peer)
            } catch (e: Throwable) {
                ld("listenForPeer", "error: ${e.message}")
                promise.resolve("")
            }
        }.start()
    }

    @ReactMethod
    fun discoverPeer(id: String, pubkey: String, localIP: String, remoteIP: String, port: String, timeout: String, promise: Promise) {
        Thread {
            try {
                val peer = Tss.discoverPeer(id, pubkey, localIP, remoteIP, port, timeout)
                ld("discoverPeer", peer)
                promise.resolve(peer)
            } catch (e: Throwable) {
                ld("discoverPeer", "error: ${e.message}")
                promise.resolve("")
            }
        }.start()
    }

    @ReactMethod
    fun getLanIp(peerIP: String, promise: Promise) {
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

            // Prioritize same subnet IP first
            sameSubnetIp?.let {
                ld("getLanIp (Same Subnet)", it)
                promise.resolve(it)
                return
            }

            iphoneHotspotIp?.let {
                ld("getLanIp (iPhone Hotspot)", it)
                promise.resolve(it)
                return
            }

            classCIP?.let {
                ld("getLanIp (Class C)", it)
                promise.resolve(it)
                return
            }

            fallbackIp?.let {
                ld("getLanIp (Fallback)", it)
                promise.resolve(it)
                return
            }

        } catch (e: Exception) {
            e.printStackTrace()
        }

        ld("getLanIp", "")
        promise.resolve("")
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
            } catch (e: Exception) {
                ld("mpcTssSetup", "error: ${e.stackTraceToString()}")
                promise.reject(e)
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
            } catch (e: Exception) {
                ld("preparams", "error: ${e.stackTraceToString()}")
                promise.reject(e)
            }
        }.start()
    }

    @ReactMethod
    fun recoverPubkey(r: String, s: String, v: String, h: String, promise: Promise) {
        try {
            val result = Tss.secP256k1Recover(r, s, v, h)
            ld("recoverPubkey", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("recoverPubkey", "error: ${e.stackTraceToString()}")
            promise.reject(e)
        }
    }

    @ReactMethod
    fun derivePubkey(hexPubkey: String, hexChaincode: String, path: String, promise: Promise) {
        try {
            val result = Tss.getDerivedPubKey(hexPubkey, hexChaincode, path, false)
            ld("derivePubkey", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("derivePubkey", "error: ${e.stackTraceToString()}")
            promise.reject(e)
        }
    }

    @ReactMethod
    fun btcAddress(compressedPubkey: String, network: String, addressType: String,  promise: Promise) {
        try {
            if(addressType == "segwit-native") {
                val segwitNative = Tss.pubToP2WPKH(compressedPubkey, network)
                ld("btcAddress", segwitNative)
                promise.resolve(segwitNative)
            } else if(addressType == "segwit-compatible") {
                val segwitCompatible = Tss.pubToP2SHP2WKH(compressedPubkey, network)
                ld("btcAddress", segwitCompatible)
                promise.resolve(segwitCompatible)
            } else if(addressType == "taproot") {
                val taproot = Tss.pubToP2TR(compressedPubkey, network)
                ld("btcAddress", taproot)
                promise.resolve(taproot)
            } else if(addressType == "legacy") {
                val legacy = Tss.pubToP2KH(compressedPubkey, network)
                ld("btcAddress", legacy)
                promise.resolve(legacy)    
            } else {
                ld("btcAddress", "invalid-address type")
                promise.resolve("")
            }
        } catch (e: Exception) {
            ld("btcAddress", "error: ${e.stackTraceToString()}")
            promise.reject(e)
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
        } catch (e: Exception) {
            ld("sha256", "error: ${e.stackTraceToString()}")
            promise.reject(e)
        }
    }
}
