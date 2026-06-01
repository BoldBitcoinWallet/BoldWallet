package com.boldwallet

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "BoldWallet"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(null)
        handleIncomingIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) {
            return
        }
        val incomingUrl = extractIncomingUrl(intent)
        if (incomingUrl != null) {
            IncomingUrlModule.storePendingUrl(this, incomingUrl)
            emitUrlEventIfReady(incomingUrl)
            return
        }
        val fileUri = extractShareFileUri(intent) ?: return
        KeyshareShareModule.storePendingUri(this, fileUri)
        emitShareEventIfReady(fileUri)
    }

    private fun emitShareEventIfReady(uri: String) {
        val reactContext = reactHost.currentReactContext as? ReactApplicationContext
        if (reactContext != null && reactContext.hasActiveReactInstance()) {
            KeyshareShareModule.emitShareEvent(reactContext, uri)
        }
    }

    private fun emitUrlEventIfReady(url: String) {
        val reactContext = reactHost.currentReactContext as? ReactApplicationContext
        if (reactContext != null && reactContext.hasActiveReactInstance()) {
            IncomingUrlModule.emitUrlEvent(reactContext, url)
        }
    }

    private fun extractIncomingUrl(intent: Intent): String? {
        if (intent.action != Intent.ACTION_VIEW) {
            return null
        }
        val data: Uri = intent.data ?: return null
        val scheme = data.scheme?.lowercase() ?: return null
        return when (scheme) {
            "bitcoin", "boldwallet" -> data.toString()
            else -> null
        }
    }

    private fun extractShareFileUri(intent: Intent): String? {
        when (intent.action) {
            Intent.ACTION_SEND -> {
                val streamUri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                if (streamUri != null) {
                    return streamUri.toString()
                }
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                if (!text.isNullOrBlank() && (text.startsWith("content://") || text.startsWith("file://"))) {
                    return text.trim()
                }
            }
            Intent.ACTION_VIEW -> {
                val data = intent.data ?: return null
                val scheme = data.scheme?.lowercase() ?: return null
                if (scheme == "content" || scheme == "file") {
                    return data.toString()
                }
            }
        }
        return null
    }
}
