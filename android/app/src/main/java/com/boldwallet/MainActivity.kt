package com.boldwallet

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.lifecycle.Lifecycle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.DeviceEventManagerModule

class MainActivity : ReactActivity() {

    private var pendingShareIntent: Intent? = null
    private var shareCopyAttempts = 0
    private var shareEmitAttempts = 0
    private val shareRetry = Runnable { deliverPendingShare() }
    private val shareEmitRetry = Runnable { emitStoredHandoffIfReady() }

    override fun getMainComponentName(): String = "BoldWallet"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(null)
        // Do not copy the content:// stream here. The sending app's grant
        // is not readable until this activity is resumed, and finishing a
        // non-root instance in onCreate revokes the grant before the copy.
        acceptIncomingIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        acceptIncomingIntent(intent)
        // ShareRelayActivity stores the file before bringing this task forward.
        emitStoredHandoffIfReady()
    }

    override fun onResume() {
        super.onResume()
        shareCopyAttempts = 0
        deliverPendingShare()
        emitStoredHandoffIfReady()
    }

    override fun onDestroy() {
        window?.decorView?.removeCallbacks(shareRetry)
        window?.decorView?.removeCallbacks(shareEmitRetry)
        super.onDestroy()
    }

    private fun acceptIncomingIntent(incoming: Intent?) {
        if (incoming == null) {
            return
        }
        val incomingUrl = IncomingShareResolver.extractIncomingUrl(incoming)
        if (incomingUrl != null) {
            IncomingUrlModule.storePendingUrl(this, incomingUrl)
            emitUrlEventIfReady(incomingUrl)
            return
        }
        if (IncomingShareResolver.shareUrisFromIntent(incoming).isEmpty()) {
            return
        }
        pendingShareIntent = incoming
        shareCopyAttempts = 0
        window?.decorView?.removeCallbacks(shareRetry)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            deliverPendingShare()
        }
    }

    /**
     * Copy while this activity is resumed and still holds the chat-app
     * URI grant. Publish only a non-empty file:// in app cache. A failed
     * read is retried; it is not reported as an import failure.
     */
    private fun deliverPendingShare() {
        val source = pendingShareIntent ?: return
        if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) || isFinishing) {
            return
        }
        val local = IncomingShareResolver.resolveFirstLocalUri(
            this,
            IncomingShareResolver.shareUrisFromIntent(source),
        )
        if (local == null) {
            shareCopyAttempts += 1
            if (shareCopyAttempts <= SHARE_COPY_ATTEMPTS) {
                window?.decorView?.let { decor ->
                    decor.removeCallbacks(shareRetry)
                    decor.postDelayed(shareRetry, SHARE_COPY_RETRY_MS)
                }
            }
            return
        }
        shareCopyAttempts = 0
        pendingShareIntent = null
        window?.decorView?.removeCallbacks(shareRetry)
        KeyshareShareModule.storePendingUri(this, local)
        if (!isTaskRoot) {
            ShareRelayActivity.openWalletTask(this)
            finish()
            return
        }
        emitShareEventIfReady(local)
    }

    /**
     * Publish a file or link that was stored before JS was listening.
     * ShareRelayActivity writes the prefs, then brings this activity forward.
     * Emitting only when the React instance is already up used to drop that handoff.
     */
    private fun emitStoredHandoffIfReady() {
        if (pendingShareIntent != null || isFinishing) {
            return
        }
        val url = IncomingUrlModule.getPendingUrl(this)
        if (!url.isNullOrBlank()) {
            if (emitJsEvent(IncomingUrlModule.EVENT_NAME, url)) {
                return
            }
        }
        val share = KeyshareShareModule.getPendingUri(this)
        if (!share.isNullOrBlank()) {
            if (emitJsEvent(KeyshareShareModule.EVENT_NAME, share)) {
                return
            }
        } else if (url.isNullOrBlank()) {
            shareEmitAttempts = 0
            window?.decorView?.removeCallbacks(shareEmitRetry)
            return
        }
        shareEmitAttempts += 1
        if (shareEmitAttempts <= SHARE_EMIT_ATTEMPTS) {
            window?.decorView?.let { decor ->
                decor.removeCallbacks(shareEmitRetry)
                decor.postDelayed(shareEmitRetry, SHARE_EMIT_RETRY_MS)
            }
        } else {
            Log.w(TAG, "handoff stored but JS was not ready")
        }
    }

    private fun emitShareEventIfReady(uri: String) {
        if (!emitJsEvent(KeyshareShareModule.EVENT_NAME, uri)) {
            shareEmitAttempts = 0
            emitStoredHandoffIfReady()
        }
    }

    private fun emitUrlEventIfReady(url: String) {
        if (!emitJsEvent(IncomingUrlModule.EVENT_NAME, url)) {
            shareEmitAttempts = 0
            emitStoredHandoffIfReady()
        }
    }

    private fun emitJsEvent(eventName: String, payload: String): Boolean {
        val reactContext = reactHost.currentReactContext ?: return false
        return try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, payload)
            shareEmitAttempts = 0
            window?.decorView?.removeCallbacks(shareEmitRetry)
            true
        } catch (e: Exception) {
            Log.w(TAG, "emit $eventName failed: ${e.message}")
            false
        }
    }

    companion object {
        private const val TAG = "IncomingShare"
        private const val SHARE_COPY_ATTEMPTS = 16
        private const val SHARE_COPY_RETRY_MS = 250L
        private const val SHARE_EMIT_ATTEMPTS = 20
        private const val SHARE_EMIT_RETRY_MS = 300L
    }
}
