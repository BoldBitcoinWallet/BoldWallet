package com.boldwallet

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType

class MpcKeepAliveModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        sharedContext = reactContext
    }

    override fun getName(): String = "MpcKeepAliveModule"

    @ReactMethod
    fun start(options: ReadableMap, promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val intent = Intent(ctx, MpcKeepAliveService::class.java)
            intent.putExtra(
                MpcKeepAliveService.EXTRA_KIND,
                options.getString("kind") ?: "keygen",
            )
            intent.putExtra(
                MpcKeepAliveService.EXTRA_TRANSPORT,
                options.getString("transport") ?: "nostr",
            )
            intent.putExtra(
                MpcKeepAliveService.EXTRA_APP_LABEL,
                options.getString("appLabel") ?: "Bold Wallet",
            )
            intent.putExtra(
                MpcKeepAliveService.EXTRA_CAMOUFLAGED,
                if (options.hasKey("camouflaged")) options.getBoolean("camouflaged") else false,
            )
            intent.putExtra(
                MpcKeepAliveService.EXTRA_TITLE,
                options.getString("title") ?: "Wallet setup",
            )
            intent.putExtra(
                MpcKeepAliveService.EXTRA_STATUS,
                options.getString("status") ?: "Working…",
            )
            MpcKeepAliveService.start(ctx, intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun update(options: ReadableMap, promise: Promise) {
        try {
            val percent = readableInt(options, "percent", -1)
            val status = options.getString("status") ?: ""
            MpcKeepAliveService.update(reactApplicationContext, percent, status)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun stop(options: ReadableMap, promise: Promise) {
        try {
            val outcome = options.getString("outcome") ?: "failure"
            val title = options.getString("title") ?: ""
            val body = options.getString("body") ?: ""
            MpcKeepAliveService.stop(reactApplicationContext, outcome, title, body)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun warnBackgrounded(promise: Promise) {
        promise.resolve(false)
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            val pm =
                reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            promise.resolve(
                pm.isIgnoringBatteryOptimizations(reactApplicationContext.packageName),
            )
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val pkg = ctx.packageName
            val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (pm.isIgnoringBatteryOptimizations(pkg)) {
                promise.resolve(true)
                return
            }
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$pkg")
            }
            val activity = getCurrentActivity()
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            try {
                val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactApplicationContext.startActivity(fallback)
                promise.resolve(true)
            } catch (e2: Exception) {
                promise.resolve(false)
            }
        }
    }

    companion object {
        @Volatile
        private var sharedContext: ReactApplicationContext? = null

        fun applicationContext(): Context? = sharedContext?.applicationContext

        fun currentActivity(): Activity? = sharedContext?.currentActivity
    }
}

private fun readableInt(map: ReadableMap, key: String, fallback: Int): Int {
    if (!map.hasKey(key) || map.isNull(key)) {
        return fallback
    }
    return when (map.getType(key)) {
        ReadableType.Number -> map.getDouble(key).toInt()
        else -> fallback
    }
}
