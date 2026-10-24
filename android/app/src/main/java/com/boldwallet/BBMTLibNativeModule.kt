package com.boldwallet

import android.app.KeyguardManager
import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
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
        MpcKeepAliveService.onTssHook(msg)
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
     * Same file + key as `react-native-encrypted-storage` Android implementation.
     * F3: fail-closed via [openSecurePrefs] — throws [SecureStorageException]
     * on every failure. The old plaintext-SharedPreferences fallback is gone.
     */
    private fun rnesEncryptedPrefs(): SharedPreferences =
        openSecurePrefs(reactApplicationContext, RNES_SHARED_PREF_FILENAME)

    /** True when RNES has a `keyshare` entry without reading/decrypting the blob value. */
    private fun keyshareExistsInRNES(): Boolean {
        return rnesEncryptedPrefs().contains(KEY_KEYSHARE)
    }

    /**
     * Null means "no entry", never "storage broken": storage failures throw
     * [SecureStorageException] (stable `[SECURE_STORAGE_<KIND>]` message
     * prefix) and propagate to the caller's promise rejection.
     *
     * F15b-1: de-envelopes the RNES value. Pre-migration plaintext
     * self-heals inline (migration is idempotent; steady-state
     * reads pay only the isEnvelope check).
     */
    private fun loadKeyshareJSONFromRNES(): String? {
        val prefs = rnesEncryptedPrefs()
        val raw = prefs.getString(KEY_KEYSHARE, null) ?: return null
        if (!KeyshareEnvelope.isEnvelope(raw)) {
            KeyshareEnvelope.ensureEnveloped(prefs, KEY_KEYSHARE)
            val migrated = prefs.getString(KEY_KEYSHARE, null) ?: return null
            if (!KeyshareEnvelope.isEnvelope(migrated)) return null
            return KeyshareEnvelope.decryptKeyshareJson(migrated)
        }
        return KeyshareEnvelope.decryptKeyshareJson(raw)
    }

    /**
     * F15b-1 resolve guard: throws when a value about to resolve to
     * JS contains share-material labels. Called inside the
     * surrounding try/catch so violations become rejections, never
     * resolutions.
     */
    private fun guardJsSafeResolve(value: String, method: String) {
        if (AesGcmEnvelope.containsShareSecrets(value)) {
            ld(method, "REFUSED to resolve share bytes to JS")
            throw IllegalStateException("Refusing to expose keyshare secrets to JS")
        }
    }

    /** F15b-1: staged DKG/import results must carry a handle ID. */
    private fun guardStagedShape(value: String, method: String) {
        guardJsSafeResolve(value, method)
        if (!value.contains("\"handle\"")) {
            ld(method, "REFUSED malformed staged result (no handle)")
            throw IllegalStateException("Keyshare staging failed")
        }
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
     * One RNES read: party nsec + same raw keyshare JSON for native MPC calls.
     * NOTE (F15): the strings returned here are the irreducible bridge copies
     * (RN String -> JNI chars -> Go string). Do not add staging copies; full
     * elimination needs native-held shares (F15b).
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


    /**
     * 3b-2d B15/B16: native-held API allowlist store. Private
     * prefs file with NO other writer (grep-verified) — JS can
     * add hosts only through the gated methods with a token.
     */
    private val apiAllowlistStore = object : CeremonyApiAllowlist.Store {
        override fun load(): Set<String> {
            val prefs = reactApplicationContext.getSharedPreferences(
                "ceremony_api_allowlist",
                Context.MODE_PRIVATE,
            )
            return prefs.getStringSet("urls", emptySet())?.toSet() ?: emptySet()
        }

        override fun save(urls: Set<String>) {
            reactApplicationContext.getSharedPreferences(
                "ceremony_api_allowlist",
                Context.MODE_PRIVATE,
            ).edit().putStringSet("urls", urls.toSet()).apply()
        }
    }

    /**
     * 3b-2d: allowlist-or-token gate. Returns true when the call
     * may proceed (persisting newly approved URLs best-effort —
     * a persist failure still applies this use since the user
     * approved it; the next launch simply prompts again).
     */
    private fun gateApiUrls(
        urls: List<String>,
        ceremonyToken: String,
        ceremonySessionID: String,
        promise: Promise,
        method: String,
    ): Boolean {
        return when (
            CeremonyApiAllowlist.decide(urls, ceremonyToken, ceremonySessionID, apiAllowlistStore)
        ) {
            CeremonyApiAllowlist.Decision.REJECT -> {
                rejectCeremonyUnauthorized(promise)
                false
            }
            CeremonyApiAllowlist.Decision.APPLY_AND_PERSIST -> {
                try {
                    CeremonyApiAllowlist.persist(urls, apiAllowlistStore)
                } catch (e: Exception) {
                    ld(method, "allowlist persist failed, applying anyway: ${e.message}")
                }
                true
            }
            CeremonyApiAllowlist.Decision.APPLY -> true
        }
    }

    @ReactMethod
    fun setAPI(
        network: String,
        baseAPI: String,
        ceremonyToken: String,
        ceremonySessionID: String,
        promise: Promise,
    ) {
        try {
            if (!gateApiUrls(listOf(baseAPI), ceremonyToken, ceremonySessionID, promise, "setAPI")) return
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
    fun setFeeAPIs(
        urls: String,
        ceremonyToken: String,
        ceremonySessionID: String,
        promise: Promise,
    ) {
        try {
            val parsed = CeremonyApiAllowlist.parseCsv(urls)
            if (!gateApiUrls(parsed, ceremonyToken, ceremonySessionID, promise, "setFeeAPIs")) return
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
                    ceremonyToken: String, ceremonySessionID: String,
                    promise: Promise) {
        Thread {
            try {
                // 3b-2c B13: rides the handshake ceremony token (sign|keygen).
                if (!CeremonyTokens.verifyTransport(ceremonyToken, ceremonySessionID)) {
                    rejectCeremonyUnauthorized(promise)
                    return@Thread
                }
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
    fun fetchData(url: String, decKey: String, payload: String,
                  ceremonyToken: String, ceremonySessionID: String,
                  promise: Promise) {
        Thread {
            try {
                // 3b-2c B14: rides the handshake ceremony token (sign|keygen).
                if (!CeremonyTokens.verifyTransport(ceremonyToken, ceremonySessionID)) {
                    rejectCeremonyUnauthorized(promise)
                    return@Thread
                }
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
    fun nostrKeypair(ceremonyToken: String, promise: Promise) {
        try {
            // 3b-2b B20: single-call keygen ceremony (no MPC session yet).
            if (!CeremonyTokens.verifySingleCall(ceremonyToken, CeremonyTokens.OpClass.KEYGEN)) {
                rejectCeremonyUnauthorized(promise)
                return
            }
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

    // F19: GG18 setup output stays plaintext in Wave 3 (protocol-
    // variant decision deferred). DKLs twins stage natively.
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
                val result = DklsNative.bbmtNostrJoinKeysignNative(
                    relaysCSV,
                    partyNsec,
                    partiesNpubsCSV,
                    sessionID,
                    sessionKey,
                    keyshareJSON,
                    derivationPath,
                    message,
                )
                ld("nostrJoinKeysign", result)
                promise.resolve(result)
            } catch (e: Throwable) {
                ld("nostrJoinKeysign", "error: ${e.stackTraceToString()}")
                promise.reject("NOSTR_JOIN_KEYSIGN_ERROR", "Failed to join keysign via Nostr: ${e.message}", e)
            }
        }.start()
    }

    // F19: GG18 setup output stays plaintext in Wave 3 (protocol-
    // variant decision deferred). DKLs twins stage natively.
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
    fun eciesKeypair(ceremonyToken: String, promise: Promise) {
        Thread {
            try {
                // 3b-2b B21: single-call keygen ceremony (no MPC session yet).
                if (!CeremonyTokens.verifySingleCall(ceremonyToken, CeremonyTokens.OpClass.KEYGEN)) {
                    rejectCeremonyUnauthorized(promise)
                    return@Thread
                }
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

    // F10 (3a): dead oracle methods aesEncrypt / aesDecrypt /
    // aesEncryptStoredKeyshare REMOVED (zero callers repo-wide, no
    // WebView/eval/reflection path; Go BbmtAes* stays for native use).

    /**
     * F1: versioned backup export. KDF (Argon2id) + AEAD (AES-GCM) run in Go;
     * JS passes the password, never a derived key. Emits v2 format only.
     */
    @ReactMethod
    fun backupEncryptStoredKeyshare(password: String, promise: Promise) {
        Thread {
            try {
                val data = loadKeyshareJSONFromRNES()
                if (data == null) {
                    promise.reject("NO_KEYSHARE", "No keyshare found in secure storage", null)
                    return@Thread
                }
                if (rejectBbmtUnavailable(promise, "backupEncryptStoredKeyshare")) return@Thread
                val result = DklsNative.bbmtBackupEncryptNative(data, password)
                if (result.startsWith("error:")) {
                    promise.reject("BACKUP_ENCRYPT_ERROR", result.removePrefix("error:"), null)
                    return@Thread
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("BACKUP_ENCRYPT_ERROR", e.message, e)
            }
        }.start()
    }

    /**
     * F1: versioned backup import. Returns {"format":"v2"|"legacy","plaintext":"..."}.
     * Legacy (CBC, no MAC) is import-only; callers must warn and prompt re-export.
     */
    // F15b-1 (A5): backupDecrypt REMOVED — plaintext-to-JS import
    // replaced by importBackupToStagedHandle (A6).
    /**
     * F15b-1 (A6): versioned backup import that stages natively.
     * Resolves {handle, metadata, legacy} — never plaintext. Error
     * TEXT preserves B1 semantics for the JS mapping (format vs
     * wrong-password). Replaces backupDecrypt (removed with its
     * caller rewrite).
     */
    @ReactMethod
    fun importBackupToStagedHandle(
        blob: String,
        password: String,
        ceremonyToken: String,
        ceremonySessionID: String,
        promise: Promise,
    ) {
        Thread {
            try {
                // 3b-2e B17: strict import ceremony (owner-shared stage+persist).
                if (!CeremonyTokens.verify(ceremonyToken, CeremonyTokens.OpClass.IMPORT, ceremonySessionID)) {
                    rejectCeremonyUnauthorized(promise)
                    return@Thread
                }
                if (rejectBbmtUnavailable(promise, "importBackupToStagedHandle")) return@Thread
                val result = DklsNative.bbmtImportBackupStagedNative(blob, password)
                if (result.startsWith("error:")) {
                    promise.reject("BACKUP_IMPORT_ERROR", result.removePrefix("error:"), null)
                    return@Thread
                }
                guardStagedShape(result, "importBackupToStagedHandle")
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("BACKUP_IMPORT_ERROR", e.message, e)
            }
        }.start()
    }

    /**
     * F15b-1 (A7): persist a staged handle to enveloped RNES.
     * Resolves post-finalize metadata for the JS SQLite mirror.
     * Staged entry is destroyed only after a VERIFIED write, so
     * failed persists are retryable with the same handle.
     */
    @ReactMethod
    fun persistStoredKeyshare(
        handle: String,
        nsec: String,
        npub: String,
        ceremonyToken: String,
        ceremonySessionID: String,
        promise: Promise,
    ) {
        Thread {
            try {
                // 3b-2e B18: strict import ceremony (shared with stage, or
                // the setup-commit flow's own save ceremony).
                if (!CeremonyTokens.verify(ceremonyToken, CeremonyTokens.OpClass.IMPORT, ceremonySessionID)) {
                    rejectCeremonyUnauthorized(promise)
                    return@Thread
                }
                if (rejectBbmtUnavailable(promise, "persistStoredKeyshare")) return@Thread
                val json = DklsNative.bbmtFinalizeStagedForPersistNative(handle, nsec, npub)
                if (json.startsWith("error:")) {
                    promise.reject("PERSIST_ERROR", json.removePrefix("error:"), null)
                    return@Thread
                }
                val prefs = rnesEncryptedPrefs()
                val envelope = KeyshareEnvelope.encryptKeyshareJson(json)
                prefs.edit().putString(KEY_KEYSHARE, envelope).commit()
                val check = prefs.getString(KEY_KEYSHARE, null)
                if (check == null || KeyshareEnvelope.decryptKeyshareJson(check) != json) {
                    promise.reject("PERSIST_ERROR", "Secure write verification failed. Retry setup without force-closing the app.", null)
                    return@Thread
                }
                val metadata = DklsNative.bbmtProjectMetadataNative(json)
                if (metadata.startsWith("error:")) {
                    promise.reject("PERSIST_ERROR", metadata.removePrefix("error:"), null)
                    return@Thread
                }
                val destroyed = DklsNative.bbmtDestroyStagedNative(handle)
                if (destroyed.startsWith("error:")) {
                    ld("persistStoredKeyshare", "staged destroy failed (non-fatal): $destroyed")
                }
                guardJsSafeResolve(metadata, "persistStoredKeyshare")
                promise.resolve(metadata)
            } catch (e: SecureStorageException) {
                promise.reject("PERSIST_ERROR", e.message, e)
            } catch (e: Exception) {
                promise.reject("PERSIST_ERROR", e.message, e)
            }
        }.start()
    }

    /**
     * F15b-1 (A8): §3 superset metadata for descriptors, chaincode,
     * labels, legacy detection. Never share bytes (tripwire).
     */
    @ReactMethod
    fun getKeyshareMetadataJSON(promise: Promise) {
        Thread {
            try {
                val raw = loadKeyshareJSONFromRNES()
                if (raw == null) {
                    promise.reject("NO_KEYSHARE", "No keyshare found in secure storage", null)
                    return@Thread
                }
                if (rejectBbmtUnavailable(promise, "getKeyshareMetadataJSON")) return@Thread
                val metadata = DklsNative.bbmtProjectMetadataNative(raw)
                if (metadata.startsWith("error:")) {
                    promise.reject("KEYSHARE_META_ERROR", metadata.removePrefix("error:"), null)
                    return@Thread
                }
                guardJsSafeResolve(metadata, "getKeyshareMetadataJSON")
                promise.resolve(metadata)
            } catch (e: SecureStorageException) {
                promise.reject("KEYSHARE_META_ERROR", e.message, e)
            } catch (e: Exception) {
                promise.reject("KEYSHARE_META_ERROR", e.message, e)
            }
        }.start()
    }

    /**
     * F15b-1 (A9): redacted structure for the dev tree view
     * (secret leaves replaced, shape preserved).
     */
    @ReactMethod
    fun getKeyshareStructureRedacted(promise: Promise) {
        Thread {
            try {
                val raw = loadKeyshareJSONFromRNES()
                if (raw == null) {
                    promise.reject("NO_KEYSHARE", "No keyshare found in secure storage", null)
                    return@Thread
                }
                if (rejectBbmtUnavailable(promise, "getKeyshareStructureRedacted")) return@Thread
                val redacted = DklsNative.bbmtRedactedStructureNative(raw)
                if (redacted.startsWith("error:")) {
                    promise.reject("KEYSHARE_STRUCT_ERROR", redacted.removePrefix("error:"), null)
                    return@Thread
                }
                guardJsSafeResolve(redacted, "getKeyshareStructureRedacted")
                promise.resolve(redacted)
            } catch (e: SecureStorageException) {
                promise.reject("KEYSHARE_STRUCT_ERROR", e.message, e)
            } catch (e: Exception) {
                promise.reject("KEYSHARE_STRUCT_ERROR", e.message, e)
            }
        }.start()
    }

    /**
     * F15b-1 (A10): wipe staged Go entries. No RNES touch (delete
     * flows clear RNES separately). Always safe to call.
     */
    @ReactMethod
    fun destroyKeyshareHandles(promise: Promise) {
        Thread {
            try {
                if (rejectBbmtUnavailable(promise, "destroyKeyshareHandles")) return@Thread
                val result = DklsNative.bbmtDestroyAllStagedNative()
                if (result.startsWith("error:")) {
                    promise.reject("DESTROY_HANDLES_ERROR", result.removePrefix("error:"), null)
                    return@Thread
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("DESTROY_HANDLES_ERROR", e.message, e)
            }
        }.start()
    }

    /**
     * 3b-1 ceremony mint, per-ceremony methods ONLY. There is
     * deliberately NO generic "request token for class X" bridge
     * method: each entry point below hardcodes its op class and
     * its prompt copy, so JS can neither choose the class nor
     * spoof the action label. Transport rides the parent
     * ceremony token (sign|keygen) — no transport mint exists.
     */
    /**
     * 3b-2a: shared gate rejection. Every gated method verifies its
     * token FIRST (before runtime checks or storage reads) so an
     * unauthorized caller learns nothing except auth-required.
     */
    private fun rejectCeremonyUnauthorized(promise: Promise) {
        promise.reject(
            "CEREMONY_AUTH_REQUIRED",
            "Ceremony authorization required for this call",
            null,
        )
    }

    @ReactMethod
    fun requestSignCeremonyToken(sessionID: String, promise: Promise) {
        promptAndMint(
            CeremonyTokens.OpClass.SIGN, sessionID,
            "Authenticate to sign", "Approve the signing ceremony", promise,
        )
    }

    @ReactMethod
    fun requestKeygenCeremonyToken(sessionID: String, promise: Promise) {
        promptAndMint(
            CeremonyTokens.OpClass.KEYGEN, sessionID,
            "Authenticate to generate keys", "Approve the wallet setup ceremony", promise,
        )
    }

    @ReactMethod
    fun requestExportCeremonyToken(sessionID: String, promise: Promise) {
        promptAndMint(
            CeremonyTokens.OpClass.EXPORT, sessionID,
            "Authenticate to export backup", "Approve the backup export", promise,
        )
    }

    @ReactMethod
    fun requestImportCeremonyToken(sessionID: String, promise: Promise) {
        promptAndMint(
            CeremonyTokens.OpClass.IMPORT, sessionID,
            "Authenticate to import backup", "Approve the backup import", promise,
        )
    }

    @ReactMethod
    fun requestConfigCeremonyToken(sessionID: String, promise: Promise) {
        promptAndMint(
            CeremonyTokens.OpClass.CONFIG, sessionID,
            "Authenticate to change settings", "Approve the network settings change", promise,
        )
    }

    /**
     * Shared mint worker. PRIVATE — not a bridge method, not
     * JS-reachable. OS-visible auth FIRST (BiometricPrompt,
     * biometric-or-device-credential), mint ONLY on success. No
     * screen lock → CEREMONY_AUTH_NO_LOCK refuse (Q3). Every
     * other failure → CEREMONY_AUTH_REQUIRED (no reason oracle).
     * Mint itself enforces single-live-session.
     */
    private fun promptAndMint(
        opClass: CeremonyTokens.OpClass,
        sessionID: String,
        title: String,
        subtitle: String,
        promise: Promise,
    ) {
        if (sessionID.isEmpty()) {
            promise.reject(
                "CEREMONY_AUTH_REQUIRED",
                "Confirm to continue — authenticate in the prompt.",
                null,
            )
            return
        }
        val ctx = reactApplicationContext
        val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        if (km == null || !km.isDeviceSecure) {
            promise.reject(
                "CEREMONY_AUTH_NO_LOCK",
                "Set a device screen lock to continue.",
                null,
            )
            return
        }
        val activity = ctx.currentActivity as? FragmentActivity
        if (activity == null) {
            promise.reject(
                "CEREMONY_AUTH_REQUIRED",
                "Confirm to continue — authenticate in the prompt.",
                null,
            )
            return
        }
        activity.runOnUiThread {
            try {
                val executor = ContextCompat.getMainExecutor(activity)
                val callback = object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(
                        result: BiometricPrompt.AuthenticationResult,
                    ) {
                        try {
                            promise.resolve(CeremonyTokens.mint(opClass, sessionID))
                        } catch (e: Exception) {
                            promise.reject(
                                "CEREMONY_AUTH_REQUIRED",
                                "Confirm to continue — authenticate in the prompt.",
                                e,
                            )
                        }
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        // User cancel, lockout, HW failure: never mint.
                        promise.reject(
                            "CEREMONY_AUTH_REQUIRED",
                            "Confirm to continue — authenticate in the prompt.",
                            null,
                        )
                    }

                    override fun onAuthenticationFailed() {
                        // Single bad biometric — retryable, do not settle.
                    }
                }
                val infoBuilder = BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setAllowedAuthenticators(
                        BiometricManager.Authenticators.BIOMETRIC_STRONG or
                            BiometricManager.Authenticators.DEVICE_CREDENTIAL,
                    )
                // NOTE: no negative button — forbidden with DEVICE_CREDENTIAL.
                BiometricPrompt(activity, executor, callback).authenticate(infoBuilder.build())
            } catch (e: Exception) {
                promise.reject(
                    "CEREMONY_AUTH_REQUIRED",
                    "Confirm to continue — authenticate in the prompt.",
                    e,
                )
            }
        }
    }

    /** 3b-1: retire a token after ceremony success (-> USED). */
    @ReactMethod
    fun completeCeremonyToken(token: String, promise: Promise) {
        try {
            CeremonyTokens.complete(token)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CEREMONY_TOKEN_ERROR", e.message, e)
        }
    }

    /** 3b-1: revoke a token on teardown (-> REVOKED). Idempotent. */
    @ReactMethod
    fun releaseCeremonyToken(token: String, promise: Promise) {
        try {
            CeremonyTokens.release(token)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CEREMONY_TOKEN_ERROR", e.message, e)
        }
    }

    // NOTE: NO debug test mint here. The prompt-bypassing mint
    // lives in src/debug (CeremonyTestModule) + Swift #if DEBUG —
    // absent from release binaries. Guardrailed in jest.

    /**
     * F15b-1 migration bootstrap (§1.5 step 7): idempotent
     * plaintext → envelope migration. Resolves {migrated:bool}.
     * Storage failures reject with [SECURE_STORAGE_*] copy.
     */
    @ReactMethod
    fun ensureKeyshareEnveloped(promise: Promise) {
        Thread {
            try {
                val prefs = rnesEncryptedPrefs()
                val migrated = KeyshareEnvelope.ensureEnveloped(prefs, KEY_KEYSHARE)
                val out = Arguments.createMap()
                out.putBoolean("migrated", migrated)
                promise.resolve(out)
            } catch (e: SecureStorageException) {
                promise.reject("MIGRATION_ERROR", e.message, e)
            } catch (e: Exception) {
                promise.reject("MIGRATION_ERROR", mapSecureStorageError(e).message, e)
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
    fun secureRandom(length: Int, promise: Promise) {
        try {
            if (rejectBbmtUnavailable(promise, "secureRandom")) return
            if (length <= 0) {
                promise.reject("SECURE_RANDOM_ERROR", "length must be positive", null)
                return
            }
            val result = DklsNative.bbmtSecureRandomNative(length)
            if (result.startsWith("error:")) {
                promise.reject(
                    "SECURE_RANDOM_ERROR",
                    result.removePrefix("error:"),
                    null,
                )
                return
            }
            ld("secureRandom", "len=$length")
            promise.resolve(result)
        } catch (e: Throwable) {
            ld("secureRandom", "error: ${e.stackTraceToString()}")
            promise.reject("SECURE_RANDOM_ERROR", "Failed to generate random: ${e.message}", e)
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
                val result = DklsNative.bbmtMpcSignPSBTNative(
                    server,
                    partyID,
                    partiesCSV,
                    sessionID,
                    sessionKey,
                    encKey,
                    decKey,
                    keyshare,
                    psbtBase64,
                )
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
                val result = DklsNative.bbmtMpcSendBTCWithUTXOsNative(
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
                    changeAddress,
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
        partiesNpubsCSV: String,
        npubsSorted: String,
        balanceSats: String,
        receiverAddress: String,
        amountSatoshi: String,
        estimatedFee: String,
        utxosWithPathsJSON: String,
        changeAddress: String,
        promise: Promise
    ) {
        Thread {
            try {
                val (partyNsec, keyshareJSON) = nsecAndKeyshareJSONFromRNES()
                if (rejectBbmtUnavailable(promise, "nostrMpcSendBTC")) return@Thread
                val result = DklsNative.bbmtNostrMpcSendBTCWithUTXOsNative(
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
                    changeAddress ?: "",
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
    fun nostrMpcSignPSBT(
        relaysCSV: String,
        partiesNpubsCSV: String,
        npubsSorted: String,
        psbtBase64: String,
        promise: Promise
    ) {
        Thread {
            try {
                val (partyNsec, keyshareJSON) = nsecAndKeyshareJSONFromRNES()
                if (rejectBbmtUnavailable(promise, "nostrMpcSignPSBT")) return@Thread
                val result = DklsNative.bbmtNostrMpcSignPSBTNative(
                    relaysCSV,
                    partyNsec,
                    partiesNpubsCSV,
                    npubsSorted,
                    keyshareJSON,
                    psbtBase64,
                )
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
        ceremonyToken: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!CeremonyTokens.verify(ceremonyToken, CeremonyTokens.OpClass.KEYGEN, sessionID)) {
                    rejectCeremonyUnauthorized(promise)
                    return@Thread
                }
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
                guardStagedShape(result, "dklsMpcTssSetup")
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
        ceremonyToken: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!CeremonyTokens.verify(ceremonyToken, CeremonyTokens.OpClass.KEYGEN, sessionID)) {
                    rejectCeremonyUnauthorized(promise)
                    return@Thread
                }
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
                guardStagedShape(result, "dklsNostrMpcTssSetup")
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
        ceremonyToken: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!CeremonyTokens.verify(ceremonyToken, CeremonyTokens.OpClass.SIGN, sessionID)) {
                    rejectCeremonyUnauthorized(promise)
                    return@Thread
                }
                if (!ensureBbmtRuntime()) {
                    promise.reject("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh android", null)
                    return@Thread
                }
                val keyshare = loadKeyshareJSONFromRNES()
                    ?: run {
                        promise.reject("NO_KEYSHARE", "No keyshare found in secure storage", null)
                        return@Thread
                    }
                val result = DklsNative.mpcSignPsbtNative(
                    server, partyID, partiesCSV, sessionID, sessionKey,
                    encKey, decKey, keyshare, psbtBase64,
                )
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
        ceremonyToken: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!CeremonyTokens.verify(ceremonyToken, CeremonyTokens.OpClass.SIGN, sessionID)) {
                    rejectCeremonyUnauthorized(promise)
                    return@Thread
                }
                if (!ensureBbmtRuntime()) {
                    promise.reject("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh android", null)
                    return@Thread
                }
                val keyshare = loadKeyshareJSONFromRNES()
                    ?: run {
                        promise.reject("NO_KEYSHARE", "No keyshare found in secure storage", null)
                        return@Thread
                    }
                val result = DklsNative.mpcSendBtcWithUtxosNative(
                    server, partyID, partiesCSV, sessionID, sessionKey,
                    encKey, decKey, keyshare, btcPub, toAddress,
                    satoshiAmount, satoshiFees, utxosWithPathsJSON, changeAddress,
                )
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
        ceremonyToken: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!CeremonyTokens.verifySingleCall(ceremonyToken, CeremonyTokens.OpClass.SIGN)) {
                    rejectCeremonyUnauthorized(promise)
                    return@Thread
                }
                if (!ensureBbmtRuntime()) {
                    promise.reject("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh android", null)
                    return@Thread
                }
                val (partyNsec, keyshareJSON) = nsecAndKeyshareJSONFromRNES()
                val result = DklsNative.nostrMpcSendBtcWithUtxosNative(
                    relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, balanceSats, keyshareJSON,
                    toAddress, satoshiAmount, satoshiFees, utxosWithPathsJSON, changeAddress,
                )
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
        ceremonyToken: String,
        promise: Promise,
    ) {
        Thread {
            try {
                if (!CeremonyTokens.verifySingleCall(ceremonyToken, CeremonyTokens.OpClass.SIGN)) {
                    rejectCeremonyUnauthorized(promise)
                    return@Thread
                }
                if (!ensureBbmtRuntime()) {
                    promise.reject("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh android", null)
                    return@Thread
                }
                val (partyNsec, keyshareJSON) = nsecAndKeyshareJSONFromRNES()
                val result = DklsNative.nostrMpcSignPsbtNative(
                    relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, keyshareJSON, psbtBase64,
                )
                promise.resolve(result)
            } catch (e: Throwable) {
                promise.reject("DKLS_PSBT_NOSTR", e.message, e)
            }
        }.start()
    }

    /** Returns device entropy source metadata as a JSON string.
     *  Always resolves — assessment is informational, not gating. */
    @ReactMethod
    fun getDeviceEntropyMetadata(promise: Promise) {
        try {
            val platform = "android"
            val osVersion = android.os.Build.VERSION.RELEASE
            val deviceModel = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}"

            val cryptoFramework = "Android Keystore / Conscrypt (java.security.SecureRandom)"
            val rngSource = "/dev/urandom → Linux kernel CSPRNG (SHA-1 DRBG reseeded from entropy pool)"

            // Check StrongBox availability (API 28+)
            var hasStrongBox = false
            val hwRng: String = try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                    hasStrongBox = reactApplicationContext
                        .packageManager
                        .hasSystemFeature(android.content.pm.PackageManager.FEATURE_STRONGBOX_KEYSTORE)
                    if (hasStrongBox) "StrongBox Keymaster (available)" else "StrongBox Keymaster (unavailable)"
                } else {
                    "StrongBox Keymaster (API < 28 — not supported)"
                }
            } catch (_: Throwable) {
                "StrongBox Keymaster (check failed)"
            }

            // Attempt to read /proc/sys/kernel/random/entropy_avail
            val entropyAvailBits: Int? = try {
                val entropyFile = java.io.File("/proc/sys/kernel/random/entropy_avail")
                if (entropyFile.exists() && entropyFile.canRead()) entropyFile.readText().trim().toIntOrNull()
                else null
            } catch (_: Throwable) { null }

            val entropyPoolHealth: String = if (entropyAvailBits != null)
                "Kernel entropy pool — entropy_avail: $entropyAvailBits"
            else
                "Kernel CSPRNG — entropy pool (entropy_avail not readable)"

            // On modern kernels entropy_avail is unreadable once the CRNG is seeded (always strong).
            // StrongBox (hardware SE) upgrades a borderline entropy reading to Strong.
            val rngAssessment: String = when {
                entropyAvailBits == null  -> "Strong"   // unreadable = CRNG fully seeded
                entropyAvailBits >= 256   -> "Strong"
                entropyAvailBits >= 128   -> if (hasStrongBox) "Strong" else "Weak"
                else                      -> "Weak"
            }

            val metadata = org.json.JSONObject().apply {
                put("platform", platform)
                put("os_version", osVersion)
                put("device_model", deviceModel)
                put("crypto_framework", cryptoFramework)
                put("rng_source", rngSource)
                put("hardware_rng", hwRng)
                put("entropy_pool_health", entropyPoolHealth)
                put("rng_assessment", rngAssessment)
            }

            ld("getDeviceEntropyMetadata", "resolved rng_assessment=$rngAssessment")
            promise.resolve(metadata.toString())
        } catch (e: Throwable) {
            ld("getDeviceEntropyMetadata", "error: ${e.stackTraceToString()}")
            promise.reject("METADATA_ERROR", "Failed to read entropy metadata: ${e.message}", e)
        }
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
