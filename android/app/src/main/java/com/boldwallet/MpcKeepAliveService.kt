package com.boldwallet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/**
 * Short-lived foreground service so in-process MPC (Go) keeps running when the
 * activity is not visible. Progress is updated from TssHook, not JS.
 */
class MpcKeepAliveService : Service() {

    private var wifiLock: WifiManager.WifiLock? = null
    private var wifiMulticast: WifiManager.MulticastLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                applyStartExtras(intent)
                running = true
                ensureChannels()
                acquireLocks()
                setKeepScreenOn(true)
                promoteForeground()
            }
            ACTION_UPDATE -> {
                if (!running) {
                    return START_NOT_STICKY
                }
                val percent = intent.getIntExtra(EXTRA_PERCENT, -1)
                val status = intent.getStringExtra(EXTRA_STATUS)
                if (percent >= 0) {
                    lastPercent = percent.coerceIn(0, 99)
                }
                if (!status.isNullOrBlank()) {
                    lastStatus = status
                }
                notifyOngoing()
            }
            ACTION_STOP -> {
                val outcome = intent.getStringExtra(EXTRA_OUTCOME) ?: "failure"
                val title = intent.getStringExtra(EXTRA_DONE_TITLE).orEmpty()
                val body = intent.getStringExtra(EXTRA_DONE_BODY).orEmpty()
                teardown(outcome, title, body)
            }
            else -> {
                if (running) {
                    promoteForeground()
                }
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        releaseLocks()
        setKeepScreenOn(false)
        running = false
        super.onDestroy()
    }

    private fun applyStartExtras(intent: Intent) {
        lastKind = intent.getStringExtra(EXTRA_KIND) ?: "keygen"
        lastTransport = intent.getStringExtra(EXTRA_TRANSPORT) ?: "nostr"
        lastAppLabel = intent.getStringExtra(EXTRA_APP_LABEL) ?: "Bold Wallet"
        camouflaged = intent.getBooleanExtra(EXTRA_CAMOUFLAGED, false)
        lastTitle = intent.getStringExtra(EXTRA_TITLE) ?: lastAppLabel
        lastStatus = intent.getStringExtra(EXTRA_STATUS) ?: "Working…"
        lastPercent = 0
    }

    private fun promoteForeground() {
        val notification = buildOngoing()
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(
                    ONGOING_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
                )
            } else {
                startForeground(ONGOING_ID, notification)
            }
        } catch (e: Exception) {
            Log.w(TAG, "startForeground failed: ${e.message}")
            notifyOngoing()
        }
    }

    private fun notifyOngoing() {
        notificationManager().notify(ONGOING_ID, buildOngoing())
    }

    private fun buildOngoing(): Notification {
        val percent = lastPercent.coerceIn(0, 99)
        val title = if (camouflaged) lastAppLabel else lastTitle
        val text = if (camouflaged) {
            if (percent > 0) "Working… $percent%" else "Working…"
        } else {
            lastStatus
        }
        return NotificationCompat.Builder(this, CHANNEL_ONGOING)
            .setSmallIcon(R.drawable.ic_mpc_keep_alive)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setProgress(100, percent, percent <= 0)
            .setContentIntent(tapIntent())
            .build()
    }

    private fun teardown(outcome: String, title: String, body: String) {
        running = false
        releaseLocks()
        setKeepScreenOn(false)
        try {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (_: Exception) {
            // ignore
        }
        notificationManager().cancel(ONGOING_ID)
        if (outcome != "abort" && title.isNotBlank()) {
            val done = NotificationCompat.Builder(this, CHANNEL_DONE)
                .setSmallIcon(R.drawable.ic_mpc_keep_alive)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setContentIntent(tapIntent())
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()
            notificationManager().notify(DONE_ID, done)
        }
        stopSelf()
    }

    private fun acquireLocks() {
        releaseLocks()
        if (lastTransport != "lan") {
            return
        }
        try {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            wifiLock = wifi.createWifiLock(
                WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                "boldwallet:mpc-wifi",
            ).also {
                it.setReferenceCounted(false)
                it.acquire()
            }
            wifiMulticast = wifi.createMulticastLock("boldwallet:mpc-mdns").also {
                it.setReferenceCounted(false)
                it.acquire()
            }
        } catch (e: Exception) {
            Log.w(TAG, "wifi locks: ${e.message}")
        }
    }

    private fun releaseLocks() {
        try {
            wifiLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        }
        wifiLock = null
        try {
            wifiMulticast?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        }
        wifiMulticast = null
    }

    private fun setKeepScreenOn(on: Boolean) {
        val activity = MpcKeepAliveModule.currentActivity() ?: return
        activity.runOnUiThread {
            try {
                val flags = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                if (on) {
                    activity.window?.addFlags(flags)
                } else {
                    activity.window?.clearFlags(flags)
                }
            } catch (e: Exception) {
                Log.w(TAG, "keepScreenOn: ${e.message}")
            }
        }
    }

    private fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val nm = notificationManager()
        val ongoing = NotificationChannel(
            CHANNEL_ONGOING,
            "Wallet setup progress",
            NotificationManager.IMPORTANCE_LOW,
        )
        ongoing.setShowBadge(false)
        ongoing.description = "Progress while preparing, setting up, or co-signing"
        val done = NotificationChannel(
            CHANNEL_DONE,
            "Wallet setup results",
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        done.description = "Shown when setup or co-signing finishes or is interrupted"
        nm.createNotificationChannel(ongoing)
        nm.createNotificationChannel(done)
    }

    private fun tapIntent(): PendingIntent {
        val launch = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_NEW_TASK
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getActivity(this, 0, launch, flags)
    }

    private fun notificationManager(): NotificationManager {
        return getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    }

    companion object {
        private const val TAG = "MpcKeepAlive"
        const val ACTION_START = "com.boldwallet.mpc.START"
        const val ACTION_UPDATE = "com.boldwallet.mpc.UPDATE"
        const val ACTION_STOP = "com.boldwallet.mpc.STOP"
        const val EXTRA_KIND = "kind"
        const val EXTRA_TRANSPORT = "transport"
        const val EXTRA_APP_LABEL = "appLabel"
        const val EXTRA_CAMOUFLAGED = "camouflaged"
        const val EXTRA_TITLE = "title"
        const val EXTRA_STATUS = "status"
        const val EXTRA_PERCENT = "percent"
        const val EXTRA_OUTCOME = "outcome"
        const val EXTRA_DONE_TITLE = "doneTitle"
        const val EXTRA_DONE_BODY = "doneBody"
        private const val CHANNEL_ONGOING = "mpc_keep_alive"
        private const val CHANNEL_DONE = "mpc_keep_alive_done"
        private const val ONGOING_ID = 7101
        private const val DONE_ID = 7102

        @Volatile
        var running: Boolean = false
            private set

        @Volatile private var lastKind: String = "keygen"
        @Volatile private var lastTransport: String = "nostr"
        @Volatile private var lastAppLabel: String = "Bold Wallet"
        @Volatile private var camouflaged: Boolean = false
        @Volatile private var lastTitle: String = "Wallet setup"
        @Volatile private var lastStatus: String = "Working…"
        @Volatile private var lastPercent: Int = 0

        fun start(context: Context, extras: Intent) {
            extras.setClass(context, MpcKeepAliveService::class.java)
            extras.action = ACTION_START
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(extras)
            } else {
                context.startService(extras)
            }
        }

        fun update(context: Context, percent: Int, status: String) {
            if (!running) {
                return
            }
            val intent = Intent(context, MpcKeepAliveService::class.java).apply {
                action = ACTION_UPDATE
                putExtra(EXTRA_PERCENT, percent)
                putExtra(EXTRA_STATUS, status)
            }
            context.startService(intent)
        }

        fun stop(context: Context, outcome: String, title: String, body: String) {
            if (!running) {
                return
            }
            val intent = Intent(context, MpcKeepAliveService::class.java).apply {
                action = ACTION_STOP
                putExtra(EXTRA_OUTCOME, outcome)
                putExtra(EXTRA_DONE_TITLE, title)
                putExtra(EXTRA_DONE_BODY, body)
            }
            context.startService(intent)
        }

        /** Called from JNI TssHook path so the notification stays live if JS is paused. */
        fun onTssHook(json: String) {
            if (!running) {
                return
            }
            val mapped = mapTssHook(json, camouflaged) ?: return
            lastPercent = mapped.first
            lastStatus = mapped.second
            val app = MpcKeepAliveModule.applicationContext() ?: return
            update(app, mapped.first, mapped.second)
        }

        internal fun mapTssHook(json: String, camouflaged: Boolean): Pair<Int, String>? {
            val obj = try {
                JSONObject(json)
            } catch (_: Exception) {
                return null
            }
            val type = obj.optString("type")
            if (type == "transport" || type == "relay") {
                return null
            }
            val step = obj.optInt("step", 0)
            val done = obj.optBoolean("done", false)
            val percent = when {
                done || step >= 99 -> 99
                type == "keygen" -> (step * 8).coerceIn(1, 95)
                type == "keysign" || type == "btc_send" || type == "psbt" ->
                    (step * 3).coerceIn(1, 95)
                else -> lastPercent.coerceIn(0, 99)
            }
            val status = when {
                camouflaged && percent > 0 -> "Working… $percent%"
                camouflaged -> "Working…"
                done || step >= 99 -> "Finishing…"
                type == "keygen" -> "Creating your wallet…"
                type == "keysign" || type == "btc_send" || type == "psbt" -> "Co-signing…"
                else -> lastStatus
            }
            return percent to status
        }
    }
}
