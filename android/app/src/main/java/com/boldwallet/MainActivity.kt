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
        if (!isTaskRoot) {
            forwardIntentToExistingTask(intent)
            finish()
            return
        }
        handleIncomingIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun forwardIntentToExistingTask(source: Intent?) {
        if (source == null) {
            return
        }
        val forwarded = Intent(source)
        forwarded.setClass(this, MainActivity::class.java)
        forwarded.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP,
        )
        startActivity(forwarded)
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
        val uri = shareUriFromIntent(intent) ?: return null
        return IncomingShareResolver.resolveToLocalUri(this, uri)
    }

    @Suppress("DEPRECATION")
    private fun shareUriFromIntent(intent: Intent): Uri? {
        when (intent.action) {
            Intent.ACTION_SEND -> {
                intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.let { return it }
                intent.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.uri?.let { return it }
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()
                if (!text.isNullOrBlank() &&
                    (text.startsWith("content://") || text.startsWith("file://"))
                ) {
                    return Uri.parse(text)
                }
            }
            Intent.ACTION_VIEW -> {
                val data = intent.data ?: return null
                val scheme = data.scheme?.lowercase() ?: return null
                if (scheme == "content" || scheme == "file") {
                    return data
                }
            }
        }
        return null
    }
}
