package com.boldwallet

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log

/**
 * Receives ACTION_SEND / ACTION_VIEW from Telegram, WhatsApp, and other apps.
 *
 * The home screen is an activity-alias with launchMode singleTask. A share
 * aimed at MainActivity brings that existing task forward and drops the new
 * intent, so the showcase stays up and no import starts. This relay is the
 * share target: it copies the grant into app cache, then opens the launcher
 * alias that already owns the task.
 */
class ShareRelayActivity : Activity() {

    private var attempts = 0
    private var handedOff = false
    private val retry = Runnable { deliver() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
    }

    override fun onResume() {
        super.onResume()
        attempts = 0
        deliver()
    }

    override fun onDestroy() {
        window?.decorView?.removeCallbacks(retry)
        super.onDestroy()
    }

    private fun deliver() {
        if (handedOff || isFinishing) {
            return
        }
        val incoming = intent
        val url = IncomingShareResolver.extractIncomingUrl(incoming)
        if (url != null) {
            IncomingUrlModule.storePendingUrl(this, url)
            openWalletAndFinish()
            return
        }
        val uris = IncomingShareResolver.shareUrisFromIntent(incoming)
        if (uris.isEmpty()) {
            openWalletAndFinish()
            return
        }
        val local = IncomingShareResolver.resolveFirstLocalUri(this, uris)
        if (local == null) {
            attempts += 1
            if (attempts <= COPY_ATTEMPTS) {
                window?.decorView?.let { decor ->
                    decor.removeCallbacks(retry)
                    decor.postDelayed(retry, COPY_RETRY_MS)
                }
                return
            }
            Log.w(TAG, "share copy failed; opening wallet without a file")
            openWalletAndFinish()
            return
        }
        KeyshareShareModule.storePendingUri(this, local)
        openWalletAndFinish()
    }

    private fun openWalletAndFinish() {
        if (handedOff) {
            return
        }
        handedOff = true
        window?.decorView?.removeCallbacks(retry)
        openWalletTask(this)
        finish()
    }

    companion object {
        private const val TAG = "IncomingShare"
        private const val COPY_ATTEMPTS = 16
        private const val COPY_RETRY_MS = 250L

        fun openWalletTask(context: Context) {
            val launch = Intent(Intent.ACTION_MAIN)
            launch.component = ComponentName(
                context,
                IconChangerModule.enabledLauncherClass(context),
            )
            launch.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP,
            )
            context.startActivity(launch)
        }
    }
}
