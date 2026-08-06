package com.boldwallet

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONException
import org.json.JSONObject

import java.io.File
import java.net.NetworkInterface
import java.net.Inet4Address
import java.util.Arrays
import java.util.Collections
import java.util.regex.Pattern
import kotlin.text.Charsets

class BBMTLibNativeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        /** Must match [com.emeraldsanto.encryptedstorage.RNEncryptedStorageModule] */
        private const val RNES_SHARED_PREF_FILENAME = "RN_ENCRYPTED_STORAGE_SHARED_PREF"
        private const val KEY_KEYSHARE = "keyshare"

        /** If full [JSONObject] parse fails (huge MPC blob), still read `nsec` for Nostr. */
        private val NSEC_FIELD_REGEX = Pattern.compile("\"nsec\"\\s*:\\s*\"([^\"]*)\"")
    }

    private fun extractNsecStringViaRegex(raw: String): String? {
        val m = NSEC_FIELD_REGEX.matcher(raw)
        return if (m.find()) m.group(1)?.takeIf { it.isNotEmpty() } else null
    }

    private var eventName: String = ""
    private var useLog = true

    init {
        eventName = "BBMT_DROID"
        if (bbmtLibraryPresentInApk()) {
            ensureBbmtRuntime()
        }
    }

    /** Called from JNI (libbbmtmobile) so MPC hooks reach React Native. */
    fun deliverMpcHook(msg: String) {
        sendLogEvent("TssHook", msg)
    }

    /** Called from JNI (BbmtSetGoLogListener) for Go runtime logs. */
    fun deliverGoLog(msg: String) {
        ld("GoLog", msg)
    }

    @Synchronized
    private fun activateMpcHookBridge() {
        if (DklsNative.isLoaded()) {
            DklsNative.setBbmtHookListener(this)
        } else {
            DklsNative.clearBbmtHookListener()
        }
    }

    /** Load libbbmtmobile (single Go runtime for GG18 + DKLs). */
    @Synchronized
    private fun ensureBbmtRuntime(): Boolean {
        if (!DklsNative.ensureLoaded()) {
            return false
        }
        activateMpcHookBridge()
        return true
    }

    private fun rejectBbmtUnavailable(promise: Promise, method: String): Boolean {
        if (ensureBbmtRuntime()) {
            return false
        }
        promise.reject(
            "BBMT_NATIVE_REQUIRED",
            "$method requires libbbmtmobile — run BBMTLib/build-dkls.sh android and rebuild",
            null,
        )
        return true
    }

    private fun bbmtLibraryPresentInApk(): Boolean {
        val dir = reactApplicationContext.applicationInfo.nativeLibraryDir ?: return false
        return File(dir, "libbbmtmobile.so").exists()
    }

    @ReactMethod
    fun ensureDklsLanRuntime(promise: Promise) {
        Thread {
            try {
                if (!ensureBbmtRuntime()) {
                    promise.reject(
                        "DKLS_NATIVE_REQUIRED",
                        "Run BBMTLib/build-dkls.sh android and rebuild the app",
                        null,
                    )
                    return@Thread
                }
                promise.resolve("ok")
            } catch (e: Throwable) {
                promise.reject("DKLS_LAN_RUNTIME", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun addListener(eventName: String) {
        if (bbmtLibraryPresentInApk()) {
            ensureBbmtRuntime()
        }
        activateMpcHookBridge()
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        DklsNative.clearBbmtHookListener()
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

    /**
     * RN always delivers the keyshare as a Java [String] from JS (unavoidable bridge copy).
     * This does not remove that; it adds a native staging path we control: UTF-8 [ByteArray],
     * ephemeral [String] for native MPC, then [Arrays.fill] zero on the buffer.
     */
    private inline fun <T> withZeroedKeyshareUtf8(keyshareFromBridge: String, block: (String) -> T): T {
        val bytes = keyshareFromBridge.toByteArray(Charsets.UTF_8)
        return try {
            block(String(bytes, Charsets.UTF_8))
        } finally {
            Arrays.fill(bytes, 0)
        }
    }

    /** Same file + key as `react-native-encrypted-storage` Android implementation. */
    private fun rnesEncryptedPrefs(): SharedPreferences? {
        return try {
            val ctx = reactApplicationContext
            val masterKey = MasterKey.Builder(ctx)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                ctx,
                RNES_SHARED_PREF_FILENAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            Log.e("BBMTLibNativeModule", "rnesEncryptedPrefs", e)
            reactApplicationContext.getSharedPreferences(RNES_SHARED_PREF_FILENAME, Context.MODE_PRIVATE)
        }
    }

    /** True when RNES has a `keyshare` entry without reading/decrypting the blob value. */
    private fun keyshareExistsInRNES(): Boolean {
        val prefs = rnesEncryptedPrefs() ?: return false
        return prefs.contains(KEY_KEYSHARE)
    }

    private fun loadKeyshareJSONFromRNES(): String? {
        val prefs = rnesEncryptedPrefs() ?: return null
        return prefs.getString(KEY_KEYSHARE, null)
    }

    /**
     * Lightweight wallet presence check for app bootstrap (no keyshare JSON through JS).
     */
    @ReactMethod
    fun hasKeyshareInSecureStorage(promise: Promise) {
        Thread {
            try {
                promise.resolve(keyshareExistsInRNES())
            } catch (e: Exception) {
                promise.reject("KEYSHARE_EXISTS_ERROR", e.message, e)
            }
        }.start()
    }

    /** Summary line only; never logs keyshare contents. */
    private fun logNsecKeyshareDiag(rawLen: Int, obj: JSONObject?, nsecVal: Any?) {
        val keysCsv = obj?.keys()?.asSequence()?.sorted()?.joinToString(",") ?: "(nil)"
        val nsecDesc =
            when {
                nsecVal == null || nsecVal === JSONObject.NULL -> {
                    when {
                        obj == null -> "absent"
                        !obj.has("nsec") -> "absent"
                        else -> "json_null"
                    }
                }
                nsecVal is String -> {
                    val s = nsecVal
                    val mode =
                        when {
                            s.startsWith("nsec1") -> "bech32"
                            s.isNotEmpty() && s.length % 2 == 0 -> "hex_candidate"
                            else -> "other"
                        }
                    "string len=${s.length} mode=$mode"
                }
                else -> "NOT_STRING type=${nsecVal.javaClass.simpleName}"
            }
        ld("nsecFromKeyshare", "diag rawLen=$rawLen keys=[$keysCsv] nsec=$nsecDesc")
    }

    /**
     * One RNES read: party nsec + same raw keyshare JSON for [withZeroedKeyshareUtf8].
     * Aligned with iOS [nsecAndKeyshareJSONFromRNES].
     */
    private fun nsecAndKeyshareJSONFromRNES(): Pair<String, String> {
        val raw =
            loadKeyshareJSONFromRNES()
                ?: run {
                    ld("nsecFromKeyshare", "FAIL: no_encrypted_prefs_blob key=$KEY_KEYSHARE")
                    throw Exception("No keyshare found in secure storage")
                }
        val rawLen = raw.toByteArray(Charsets.UTF_8).size
        var obj: JSONObject? = null
        var parseEx: JSONException? = null
        try {
            obj = JSONObject(raw)
        } catch (e: JSONException) {
            parseEx = e
        }
        val nsecVal: Any? =
            if (obj != null) {
                obj.opt("nsec")
            } else {
                ld(
                    "nsecFromKeyshare",
                    "WARN: full_json_parse_failed rawLen=$rawLen msg=${parseEx?.message}",
                )
                extractNsecStringViaRegex(raw)?.also {
                    ld("nsecFromKeyshare", "recover: nsec from regex len=${it.length}")
                }
                    ?: run {
                        ld(
                            "nsecFromKeyshare",
                            "FAIL: json_parse and no regex nsec rawLen=$rawLen msg=${parseEx?.message}",
                        )
                        throw Exception("Could not parse keyshare JSON (nsec not extractable)")
                    }
            }
        logNsecKeyshareDiag(rawLen, obj, nsecVal)
        val nsecField =
            (nsecVal as? String)?.takeIf { it.isNotEmpty() }
                ?: run {
                    ld(
                        "nsecFromKeyshare",
                        "FAIL: nsec missing empty_or_non_string (see diag above)",
                    )
                    throw Exception("nsec not found in keyshare")
                }
        val partyNsec =
            if (nsecField.startsWith("nsec1")) {
                nsecField
            } else {
                try {
                    hexUtf8BytesToNsecString(nsecField)
                } catch (e: Exception) {
                    ld("nsecFromKeyshare", "FAIL: hex_decode ${e.message}")
                    throw e
                }
            }
        return Pair(partyNsec, raw)
    }

    private fun hexUtf8BytesToNsecString(hex: String): String {
        val s = hex.trim()
        if (s.length % 2 != 0) {
            throw Exception("Invalid nsec hex encoding")
        }
        val bytes = ByteArray(s.length / 2)
        var i = 0
        while (i < s.length) {
            bytes[i / 2] = s.substring(i, i + 2).toInt(16).toByte()
            i += 2
        }
        val out = String(bytes, Charsets.UTF_8)
        if (!out.startsWith("nsec1")) {
            throw Exception("Invalid nsec format in keyshare")
        }
        return out
    }

    override fun getConstants(): MutableMap<String, Any> {
        return mutableMapOf(
            "LOG_EVENT_NAME" to "BBMT_DROID"
        )
    }

    @ReactMethod
    fun disableLogging(tag: String, promise: Promise) {
        useLog = false
        if (ensureBbmtRuntime()) {
            DklsNative.bbmtDisableLogsNative()
        }
        promise.resolve(tag)
    }

    @ReactMethod
    fun setBtcNetwork(network: String, promise: Promise) {
        try {
            if (rejectBbmtUnavailable(promise, "setBtcNetwork")) return
            DklsNative.bbmtSetNetworkNative(network)
            val result = DklsNative.bbmtGetNetworkNative()
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
            if (rejectBbmtUnavailable(promise, "setFeePolicy")) return
            val result = DklsNative.bbmtUseFeePolicyNative(policy)
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
            if (rejectBbmtUnavailable(promise, "totalUTXO")) return
            val result = DklsNative.bbmtTotalUTXONative(address)
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
            if (rejectBbmtUnavailable(promise, "setAPI")) return
            val result = DklsNative.bbmtUseAPINative(network, baseAPI)
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
            if (rejectBbmtUnavailable(promise, "setFeeAPIs")) return
            val result = DklsNative.bbmtUseFeeAPIsNative(urls)
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
                if (rejectBbmtUnavailable(promise, "spendingHash")) return@Thread
                val amt = amountSatoshi.toLong()
                val result = DklsNative.bbmtSpendingHashNative(senderAddress, receiverAddress, amt)
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
                if (rejectBbmtUnavailable(promise, "spendingHashWithUTXOs")) return@Thread
                val result = DklsNative.bbmtSpendingHashWithUTXOsNative(
                    utxosWithPathsJSON, receiverAddress, amountSatoshi,
                )
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
                if (rejectBbmtUnavailable(promise, "estimateFees")) return@Thread
                val amt = amountSatoshi.toLong()
                val result = DklsNative.bbmtEstimateFeesNative(senderAddress, receiverAddress, amt)
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
                if (rejectBbmtUnavailable(promise, "estimateFeeWithUTXOs")) return@Thread
                val result = DklsNative.bbmtEstimateFeeWithUTXOsNative(
                    utxosWithPathsJSON,
                    receiverAddress,
                    amountSatoshi,
                    changeAddress,
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
    fun postTx(rawTxHex: String, promise: Promise) {
        Thread {
            try {
                if (rejectBbmtUnavailable(promise, "postTx")) return@Thread
                val txid = DklsNative.bbmtPostTxNative(rawTxHex)
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
            if (rejectBbmtUnavailable(promise, "computeTxId")) return
            val txid = DklsNative.bbmtComputeTxIdNative(rawTxHex)
            promise.resolve(txid)
        } catch (e: Throwable) {
            promise.reject("COMPUTE_TXID_ERROR", "Failed to compute txid: ${e.message}", e)
        }
    }

    @ReactMethod
    fun cancelMpcSession(sessionID: String, promise: Promise) {
        try {
            if (rejectBbmtUnavailable(promise, "cancelMpcSession")) return
            val out = DklsNative.bbmtCancelMpcSessionNative(sessionID)
            promise.resolve(out)
        } catch (e: Throwable) {
            promise.reject("CANCEL_MPC_ERROR", "Failed to cancel MPC session: ${e.message}", e)
        }
    }

    @ReactMethod
    fun cancelNostrMpc(promise: Promise) {
        try {
            if (rejectBbmtUnavailable(promise, "cancelNostrMpc")) return
            val out = DklsNative.bbmtCancelNostrMpcNative()
            promise.resolve(out)
        } catch (e: Throwable) {
            promise.reject("CANCEL_NOSTR_MPC_ERROR", "Failed to cancel Nostr MPC: ${e.message}", e)
        }
    }

    @ReactMethod
    fun runRelay(port: String, promise: Promise) {
        try {
            if (rejectBbmtUnavailable(promise, "runRelay")) return
            val result = DklsNative.bbmtRunRelayNative(port)
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
            if (rejectBbmtUnavailable(promise, "stopRelay")) return
            val result = DklsNative.bbmtStopRelayNative()
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
                if (rejectBbmtUnavailable(promise, "publishData")) return@Thread
                val output = DklsNative.bbmtPublishDataNative(port, timeout, encKey, raw, mode)
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
                if (rejectBbmtUnavailable(promise, "fetchData")) return@Thread
                val raw = DklsNative.bbmtFetchDataNative(url, decKey, payload)
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
                if (rejectBbmtUnavailable(promise, "listenForPeers")) return@Thread
                val peer = DklsNative.bbmtListenForPeersNative(id, pubkey, port, timeout, mode)
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
                if (rejectBbmtUnavailable(promise, "discoverPeers")) return@Thread
                val peer = DklsNative.bbmtDiscoverPeersNative(
                    id, pubkey, localIP, remoteIP, port, timeout, mode,
                )
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
            if (rejectBbmtUnavailable(promise, "nostrKeypair")) return
            val result = DklsNative.bbmtNostrKeypairNative()
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
                if (rejectBbmtUnavailable(promise, "hexToNpub")) return@Thread
                val result = DklsNative.bbmtHexToNpubNative(hexKey)
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
                if (rejectBbmtUnavailable(promise, "nostrMpcTssSetup")) return@Thread
                val result = DklsNative.bbmtNostrJoinKeygenNative(
                    relaysCSV,
                    partyNsec,
                    partiesNpubsCSV,
                    sessionID,
                    sessionKey,
                    chaincode,
                    ppmFile,
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
                if (rejectBbmtUnavailable(promise, "nostrJoinKeysign")) return@Thread
                val result = withZeroedKeyshareUtf8(keyshareJSON) { ks ->
                    DklsNative.bbmtNostrJoinKeysignNative(
                        relaysCSV,
                        partyNsec,
                        partiesNpubsCSV,
                        sessionID,
                        sessionKey,
                        ks,
                        derivationPath,
                        message,
                    )
                }
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
                if (rejectBbmtUnavailable(promise, "mpcTssSetup")) return@Thread
                val result = DklsNative.bbmtJoinKeygenNative(
                    ppmFile,
                    partyID,
                    partiesCSV,
                    encKey,
                    decKey,
                    sessionID,
                    server,
                    chaincode,
                    sessionKey,
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
                if (rejectBbmtUnavailable(promise, "preparams")) return@Thread
                val result = DklsNative.bbmtLocalPreParamsNative(partyID, timeout.toLong())
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
            if (rejectBbmtUnavailable(promise, "recoverPubkey")) return
            val result = DklsNative.bbmtSecP256k1RecoverNative(r, s, v, h)
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
            if (rejectBbmtUnavailable(promise, "derivePubkey")) return
            val result = DklsNative.bbmtGetDerivedPubKeyNative(hexPubkey, hexChaincode, path, false)
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
            if (rejectBbmtUnavailable(promise, "encodeXpub")) return
            val result = DklsNative.bbmtEncodeXpubNative(hexPubkey, hexChaincode, network)
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
            if (rejectBbmtUnavailable(promise, "getOutputDescriptor")) return
            val result = DklsNative.bbmtGetOutputDescriptorNative(hexPubkey, hexChaincode, network, addressType)
            ld("getOutputDescriptor", result)
            promise.resolve(result)
        } catch (e: Throwable) {
            ld("getOutputDescriptor", "error: ${e.stackTraceToString()}")
            promise.reject("GET_OUTPUT_DESCRIPTOR_ERROR", "Failed to get output descriptor: ${e.message}", e)
        }
    }

    @ReactMethod
    fun appendOutputDescriptorChecksum(descriptorBody: String, promise: Promise) {
        try {
            if (rejectBbmtUnavailable(promise, "appendOutputDescriptorChecksum")) return
            val result = DklsNative.bbmtAppendOutputDescriptorChecksumNative(descriptorBody)
            ld("appendOutputDescriptorChecksum", result)
            promise.resolve(result)
        } catch (e: Throwable) {
            ld("appendOutputDescriptorChecksum", "error: ${e.stackTraceToString()}")
            promise.reject(
                "APPEND_DESCRIPTOR_CHECKSUM_ERROR",
                "Failed to append descriptor checksum: ${e.message}",
                e,
            )
        }
    }

    @ReactMethod
    fun btcAddress(compressedPubkey: String, network: String, addressType: String,  promise: Promise) {
        var resolved = false
        try {
            if (rejectBbmtUnavailable(promise, "btcAddress")) return
            val result = when(addressType) {
                "segwit-native" -> DklsNative.bbmtPubToP2WPKHNative(compressedPubkey, network)
                "segwit-compatible" -> DklsNative.bbmtPubToP2SHP2WKHNative(compressedPubkey, network)
                "taproot" -> DklsNative.bbmtPubToP2TRNative(compressedPubkey, network)
                "legacy" -> DklsNative.bbmtPubToP2KHNative(compressedPubkey, network)
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
        Thread {
            try {
                if (rejectBbmtUnavailable(promise, "eciesKeypair")) return@Thread
                val result = DklsNative.bbmtGenerateKeyPairNative()
                if (result.startsWith("error:")) {
                    promise.reject(
                        "ECIES_KEYPAIR",
                        result.removePrefix("error:"),
                        null,
                    )
                    return@Thread
                }
                ld("eciesKeypair", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("eciesKeypair", "error: ${e.stackTraceToString()}")
                promise.reject("ECIES_KEYPAIR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun aesEncrypt(data: String, key: String, promise: Promise) {
        try {
            if (rejectBbmtUnavailable(promise, "aesEncrypt")) return
            val result = DklsNative.bbmtAesEncryptNative(data, key)
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
            if (rejectBbmtUnavailable(promise, "aesDecrypt")) return
            val result = DklsNative.bbmtAesDecryptNative(data, key)
            ld("aesDecrypt", result)
            promise.resolve(result)
        } catch (e: Exception) {
            ld("aesDecrypt", "error: ${e.stackTraceToString()}")
            promise.resolve(e.message)
        }
    }

    @ReactMethod
    fun aesEncryptStoredKeyshare(key: String, promise: Promise) {
        Thread {
            try {
                val data = loadKeyshareJSONFromRNES()
                if (data == null) {
                    promise.reject("NO_KEYSHARE", "No keyshare found in secure storage", null)
                    return@Thread
                }
                if (rejectBbmtUnavailable(promise, "aesEncryptStoredKeyshare")) return@Thread
                val result = withZeroedKeyshareUtf8(data) { ks ->
                    DklsNative.bbmtAesEncryptNative(ks, key)
                }
                ld("aesEncryptStoredKeyshare", result)
                promise.resolve(result)
            } catch (e: Exception) {
                ld("aesEncryptStoredKeyshare", "error: ${e.stackTraceToString()}")
                promise.resolve(e.message)
            }
        }.start()
    }

    @ReactMethod
    fun sha256(msg: String, promise: Promise) {
        try {
            if (rejectBbmtUnavailable(promise, "sha256")) return
            val result = DklsNative.bbmtSha256Native(msg)
            ld("sha256", result)
            promise.resolve(result)
        } catch (e: Throwable) {
            ld("sha256", "error: ${e.stackTraceToString()}")
            promise.reject("SHA256_ERROR", "Failed to compute SHA256: ${e.message}", e)
        }
    }

    @ReactMethod
    fun mpcSignPSBT(
        server: String,
        partyID: String,
        partiesCSV: String,
        sessionID: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        psbtBase64: String,
        promise: Promise
    ) {
        Thread {
            try {
                val keyshare = loadKeyshareJSONFromRNES()
                if (keyshare == null) {
                    promise.reject("NO_KEYSHARE", "No keyshare found in secure storage", null)
                    return@Thread
                }
                if (rejectBbmtUnavailable(promise, "mpcSignPSBT")) return@Thread
                val result = withZeroedKeyshareUtf8(keyshare) { ks ->
                    DklsNative.bbmtMpcSignPSBTNative(
                        server,
                        partyID,
                        partiesCSV,
                        sessionID,
                        sessionKey,
                        encKey,
                        decKey,
                        ks,
                        psbtBase64,
                    )
                }
                ld("mpcSignPSBT", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("mpcSignPSBT", "error: ${e.stackTraceToString()}")
                promise.reject("MPC_SIGN_PSBT_ERROR", "Failed to sign PSBT: ${e.message}", e)
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
                val keyshare = loadKeyshareJSONFromRNES()
                if (keyshare == null) {
                    promise.reject("NO_KEYSHARE", "No keyshare found in secure storage", null)
                    return@Thread
                }
                if (rejectBbmtUnavailable(promise, "mpcSendBTCWithUTXOs")) return@Thread
                val result = withZeroedKeyshareUtf8(keyshare) { ks ->
                    DklsNative.bbmtMpcSendBTCWithUTXOsNative(
                        server,
                        partyID,
                        partiesCSV,
                        sessionID,
                        sessionKey,
                        encKey,
                        decKey,
                        ks,
                        publicKey,
                        receiverAddress,
                        amountSatoshi,
                        feeSatoshi,
                        utxosWithPathsJSON,
                        changeAddress,
                    )
                }
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
        partiesNpubsCSV: String,
        npubsSorted: String,
        balanceSats: String,
        receiverAddress: String,
        amountSatoshi: String,
        estimatedFee: String,
        utxosWithPathsJSON: String,
        changeAddress: String,
        initiatorNpubHint: String,
        promise: Promise
    ) {
        Thread {
            try {
                val (partyNsec, keyshareJSON) = nsecAndKeyshareJSONFromRNES()
                if (rejectBbmtUnavailable(promise, "nostrMpcSendBTC")) return@Thread
                ld(
                    "nostrMpcSendBTC",
                    "parties=${partiesNpubsCSV} npubsSorted=${npubsSorted} utxosJsonLen=${utxosWithPathsJSON.length} receiver=${receiverAddress} amount=${amountSatoshi} fee=${estimatedFee}"
                )
                val result = withZeroedKeyshareUtf8(keyshareJSON) { ks ->
                    DklsNative.bbmtNostrMpcSendBTCWithUTXOsNative(
                        relaysCSV,
                        partyNsec,
                        partiesNpubsCSV,
                        npubsSorted,
                        balanceSats,
                        ks,
                        receiverAddress,
                        amountSatoshi,
                        estimatedFee,
                        utxosWithPathsJSON,
                        changeAddress ?: "",
                        initiatorNpubHint,
                    )
                }
                ld("nostrMpcSendBTC", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("nostrMpcSendBTC", "error: ${e.stackTraceToString()}")
                promise.reject("NOSTR_MPC_SEND_BTC_ERROR", "Failed to send BTC via Nostr: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun nostrMpcSignPSBT(
        relaysCSV: String,
        partiesNpubsCSV: String,
        npubsSorted: String,
        psbtBase64: String,
        initiatorNpubHint: String,
        promise: Promise
    ) {
        Thread {
            try {
                val (partyNsec, keyshareJSON) = nsecAndKeyshareJSONFromRNES()
                if (rejectBbmtUnavailable(promise, "nostrMpcSignPSBT")) return@Thread
                ld(
                    "nostrMpcSignPSBT",
                    "parties=${partiesNpubsCSV} npubsSorted=${npubsSorted} psbtBase64Len=${psbtBase64.length}"
                )
                val result = withZeroedKeyshareUtf8(keyshareJSON) { ks ->
                    DklsNative.bbmtNostrMpcSignPSBTNative(
                        relaysCSV,
                        partyNsec,
                        partiesNpubsCSV,
                        npubsSorted,
                        ks,
                        psbtBase64,
                        initiatorNpubHint,
                    )
                }
                ld("nostrMpcSignPSBT", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("nostrMpcSignPSBT", "error: ${e.stackTraceToString()}")
                promise.reject("NOSTR_MPC_SIGN_PSBT_ERROR", "Failed to sign PSBT via Nostr: ${e.message}", e)
            }
        }.start()
    }

    /**
     * Reads keyshare from RNES in native, parses JSON, returns minimal fields for Nostr UI/prep only.
     * The full MPC JSON string is never exposed to JavaScript.
     */
    @ReactMethod
    fun getKeyshareNostrPrepJSON(promise: Promise) {
        Thread {
            try {
                val raw = loadKeyshareJSONFromRNES()
                if (raw == null) {
                    promise.reject("NO_KEYSHARE", "No keyshare found in secure storage", null)
                    return@Thread
                }
                val obj = JSONObject(raw)
                val out = JSONObject()
                val keys = arrayOf(
                    "pub_key",
                    "chain_code_hex",
                    "keygen_committee_keys",
                    "local_party_key",
                    "nostr_npub",
                )
                for (k in keys) {
                    if (obj.has(k)) {
                        out.put(k, obj.get(k))
                    }
                }
                promise.resolve(out.toString())
            } catch (e: Exception) {
                promise.reject("KEYSHARE_PREP_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun dklsHelloDkg(promise: Promise) {
        Thread {
            try {
                // Single runtime: libbbmtmobile loaded in module init when present in APK.
                val result = if (bbmtLibraryPresentInApk()) {
                    "dkls23 ok (native library present)"
                } else {
                    "DKLS: run BBMTLib/build-dkls.sh android and rebuild (libbbmtmobile.so missing)"
                }
                promise.resolve(result)
            } catch (e: Throwable) {
                promise.reject("DKLS_HELLO_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun dklsMpcTssSetup(
        server: String,
        partyID: String,
        partiesCSV: String,
        sessionID: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        chaincode: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!ensureBbmtRuntime()) {
                    promise.reject(
                        "DKLS_NATIVE_REQUIRED",
                        "Run BBMTLib/build-dkls.sh android and rebuild the app",
                        null,
                    )
                    return@Thread
                }
                val result = DklsNative.lanJoinKeygenNative(
                    partyID,
                    partiesCSV,
                    sessionID,
                    server,
                    chaincode,
                    sessionKey,
                    encKey,
                    decKey,
                )
                promise.resolve(result)
            } catch (e: Throwable) {
                promise.reject("DKLS_MPC_SETUP_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun dklsNostrMpcTssSetup(
        relaysCSV: String,
        partyNsec: String,
        partiesNpubsCSV: String,
        sessionID: String,
        sessionKey: String,
        chaincode: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!ensureBbmtRuntime()) {
                    promise.reject(
                        "DKLS_NATIVE_REQUIRED",
                        "Run BBMTLib/build-dkls.sh android and rebuild the app (libbbmtmobile missing)",
                        null,
                    )
                    return@Thread
                }
                val result = DklsNative.nostrJoinKeygenNative(
                    relaysCSV,
                    partyNsec,
                    partiesNpubsCSV,
                    sessionID,
                    sessionKey,
                    chaincode,
                )
                promise.resolve(result)
            } catch (e: Throwable) {
                promise.reject("DKLS_NOSTR_KEYGEN_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun dklsCancelMpcSession(sessionID: String, promise: Promise) {
        Thread {
            try {
                if (rejectBbmtUnavailable(promise, "dklsCancelMpcSession")) return@Thread
                DklsNative.cancelMpcSessionNative(sessionID)
                promise.resolve(null)
            } catch (e: Throwable) {
                promise.reject("DKLS_CANCEL_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun dklsCancelNostrMpc(promise: Promise) {
        Thread {
            try {
                if (rejectBbmtUnavailable(promise, "dklsCancelNostrMpc")) return@Thread
                DklsNative.cancelNostrMpcNative()
                promise.resolve(null)
            } catch (e: Throwable) {
                promise.reject("DKLS_CANCEL_NOSTR_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun dklsMpcSignPSBT(
        server: String,
        partyID: String,
        partiesCSV: String,
        sessionID: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        psbtBase64: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!ensureBbmtRuntime()) {
                    promise.reject("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh android", null)
                    return@Thread
                }
                val keyshare = loadKeyshareJSONFromRNES()
                    ?: run {
                        promise.reject("NO_KEYSHARE", "No keyshare found in secure storage", null)
                        return@Thread
                    }
                val result = withZeroedKeyshareUtf8(keyshare) { ks ->
                    DklsNative.mpcSignPsbtNative(
                        server, partyID, partiesCSV, sessionID, sessionKey,
                        encKey, decKey, ks, psbtBase64,
                    )
                }
                promise.resolve(result)
            } catch (e: Throwable) {
                promise.reject("DKLS_PSBT_LAN", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun dklsMpcSendBTCWithUTXOs(
        server: String,
        partyID: String,
        partiesCSV: String,
        sessionID: String,
        sessionKey: String,
        encKey: String,
        decKey: String,
        btcPub: String,
        toAddress: String,
        satoshiAmount: String,
        satoshiFees: String,
        utxosWithPathsJSON: String,
        changeAddress: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!ensureBbmtRuntime()) {
                    promise.reject("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh android", null)
                    return@Thread
                }
                val keyshare = loadKeyshareJSONFromRNES()
                    ?: run {
                        promise.reject("NO_KEYSHARE", "No keyshare found in secure storage", null)
                        return@Thread
                    }
                val result = withZeroedKeyshareUtf8(keyshare) { ks ->
                    DklsNative.mpcSendBtcWithUtxosNative(
                        server, partyID, partiesCSV, sessionID, sessionKey,
                        encKey, decKey, ks, btcPub, toAddress,
                        satoshiAmount, satoshiFees, utxosWithPathsJSON, changeAddress,
                    )
                }
                promise.resolve(result)
            } catch (e: Throwable) {
                promise.reject("DKLS_SEND_LAN", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun dklsNostrMpcSendBTC(
        relaysCSV: String,
        partiesNpubsCSV: String,
        npubsSorted: String,
        balanceSats: String,
        toAddress: String,
        satoshiAmount: String,
        satoshiFees: String,
        utxosWithPathsJSON: String,
        changeAddress: String,
        initiatorNpubHint: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!ensureBbmtRuntime()) {
                    promise.reject("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh android", null)
                    return@Thread
                }
                val (partyNsec, keyshareJSON) = nsecAndKeyshareJSONFromRNES()
                val result = withZeroedKeyshareUtf8(keyshareJSON) { ks ->
                    DklsNative.nostrMpcSendBtcWithUtxosNative(
                        relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, balanceSats, ks,
                        toAddress, satoshiAmount, satoshiFees, utxosWithPathsJSON, changeAddress,
                        initiatorNpubHint,
                    )
                }
                promise.resolve(result)
            } catch (e: Throwable) {
                promise.reject("DKLS_SEND_NOSTR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun dklsNostrMpcSignPSBT(
        relaysCSV: String,
        partiesNpubsCSV: String,
        npubsSorted: String,
        psbtBase64: String,
        initiatorNpubHint: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!ensureBbmtRuntime()) {
                    promise.reject("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh android", null)
                    return@Thread
                }
                val (partyNsec, keyshareJSON) = nsecAndKeyshareJSONFromRNES()
                val result = withZeroedKeyshareUtf8(keyshareJSON) { ks ->
                    DklsNative.nostrMpcSignPsbtNative(
                        relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, ks, psbtBase64,
                        initiatorNpubHint,
                    )
                }
                promise.resolve(result)
            } catch (e: Throwable) {
                promise.reject("DKLS_PSBT_NOSTR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun parsePSBTDetails(psbtBase64: String, promise: Promise) {
        Thread {
            try {
                if (rejectBbmtUnavailable(promise, "parsePSBTDetails")) return@Thread
                val result = DklsNative.bbmtParsePSBTDetailsNative(psbtBase64)
                ld("parsePSBTDetails", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("parsePSBTDetails", "error: ${e.stackTraceToString()}")
                promise.reject("PARSE_PSBT_ERROR", "Failed to parse PSBT: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun psbtIdentityHash(psbtBase64: String, promise: Promise) {
        Thread {
            try {
                if (rejectBbmtUnavailable(promise, "psbtIdentityHash")) return@Thread
                val result = DklsNative.bbmtPsbtIdentityHashNative(psbtBase64)
                ld("psbtIdentityHash", result.take(16) + "…")
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("psbtIdentityHash", "error: ${e.stackTraceToString()}")
                promise.reject("PSBT_IDENTITY_ERROR", "Failed to hash PSBT: ${e.message}", e)
            }
        }.start()
    }
}
