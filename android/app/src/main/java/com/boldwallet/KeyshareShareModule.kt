package com.boldwallet

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class KeyshareShareModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun getInitialSharedKeyshareUri(promise: Promise) {
        promise.resolve(getPendingUri(reactContext))
    }

    @ReactMethod
    fun clearPendingSharedKeyshare(promise: Promise) {
        clearPendingUri(reactContext)
        promise.resolve(null)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN NativeEventEmitter on Android.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN NativeEventEmitter on Android.
    }

    companion object {
        const val NAME = "KeyshareShareModule"
        const val PREFS_NAME = "keyshare_share_prefs"
        const val PENDING_URI_KEY = "pending_keyshare_uri"
        const val EVENT_NAME = "keyshareSharedFile"

        fun storePendingUri(context: Context, uri: String) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PENDING_URI_KEY, uri)
                .apply()
        }

        fun getPendingUri(context: Context): String? {
            return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(PENDING_URI_KEY, null)
        }

        fun clearPendingUri(context: Context) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove(PENDING_URI_KEY)
                .apply()
        }

        fun emitShareEvent(reactContext: ReactApplicationContext?, uri: String) {
            reactContext
                ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(EVENT_NAME, uri)
        }
    }
}
