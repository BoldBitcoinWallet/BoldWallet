package com.boldwallet

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class IncomingUrlModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun getInitialIncomingUrl(promise: Promise) {
        promise.resolve(getPendingUrl(reactContext))
    }

    @ReactMethod
    fun clearPendingIncomingUrl(promise: Promise) {
        clearPendingUrl(reactContext)
        promise.resolve(null)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    companion object {
        const val NAME = "IncomingUrlModule"
        const val PREFS_NAME = "incoming_url_prefs"
        const val PENDING_URL_KEY = "pending_incoming_url"
        const val EVENT_NAME = "incomingUrl"

        fun storePendingUrl(context: Context, url: String) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PENDING_URL_KEY, url)
                .apply()
        }

        fun getPendingUrl(context: Context): String? {
            return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(PENDING_URL_KEY, null)
        }

        fun clearPendingUrl(context: Context) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove(PENDING_URL_KEY)
                .apply()
        }

        fun emitUrlEvent(reactContext: ReactApplicationContext?, url: String) {
            reactContext
                ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(EVENT_NAME, url)
        }
    }
}
