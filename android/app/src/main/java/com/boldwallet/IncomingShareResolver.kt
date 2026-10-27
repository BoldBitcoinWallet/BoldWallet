package com.boldwallet

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import java.io.File
import java.io.FileInputStream

/**
 * Resolves ACTION_SEND / ACTION_VIEW content:// URIs from any app
 * (Files, Telegram, WhatsApp, Signal, etc.). Provider paths often omit
 * the .share / .psbt extension, so we use DISPLAY_NAME and copy into
 * app cache so JS can classify the file.
 *
 * Chat apps grant a temporary read to the receiving activity only.
 * Call this after that activity is resumed — openInputStream before
 * onResume often yields an empty stream or SecurityException, and a
 * persistable-permission request can revoke a one-shot grant.
 * Never hand JS the raw content:// URI: react-native-fs reads it from
 * the application context, which does not hold the activity grant.
 */
object IncomingShareResolver {
    private const val TAG = "IncomingShare"
    private val extensionRegex = Regex("\\.(share|psbt)(?:[?#].*)?$", RegexOption.IGNORE_CASE)
    private val unsafeFileChars = Regex("[^A-Za-z0-9._-]")

    fun supportedExtension(value: String?): String? {
        if (value.isNullOrBlank()) {
            return null
        }
        return extensionRegex.find(value.trim())?.groupValues?.get(1)?.lowercase()
    }

    fun queryDisplayName(context: Context, uri: Uri): String? {
        if (uri.scheme == "file") {
            return uri.lastPathSegment
        }
        return try {
            context.contentResolver
                .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (!cursor.moveToFirst()) {
                        return@use uri.lastPathSegment
                    }
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) cursor.getString(idx) else uri.lastPathSegment
                }
        } catch (_: Exception) {
            uri.lastPathSegment
        }
    }

    fun decorateUriWithDisplayName(uri: Uri, displayName: String?): String {
        val raw = uri.toString()
        if (supportedExtension(raw) != null) {
            return raw
        }
        val name = displayName ?: return raw
        if (supportedExtension(name) == null) {
            return raw
        }
        val sep = if (raw.contains("?")) "&" else "?"
        return "${raw}${sep}displayName=${Uri.encode(name)}"
    }

    fun cacheFileName(displayName: String?, ext: String): String {
        val raw = displayName?.substringAfterLast('/')?.trim().orEmpty()
        if (raw.isNotEmpty() && supportedExtension(raw) != null) {
            val safe = unsafeFileChars.replace(raw, "_")
            if (safe.isNotEmpty()) {
                return safe
            }
        }
        return "incoming_shared.$ext"
    }

    /**
     * True when [path] is a non-empty file already inside this app's
     * cache or files dir. Re-resolving those URIs must not delete the
     * source (the trampoline forwards the cache path to the live task).
     */
    fun isReusableAppFile(cacheDir: File, filesDir: File, path: String): Boolean {
        val file = File(path)
        if (!file.isFile || file.length() <= 0L) {
            return false
        }
        val canonical = try {
            file.canonicalFile
        } catch (_: Exception) {
            return false
        }
        return listOf(cacheDir, filesDir).any { root ->
            val rootCanonical = try {
                root.canonicalFile
            } catch (_: Exception) {
                return@any false
            }
            canonical.path == rootCanonical.path ||
                canonical.path.startsWith(rootCanonical.path + File.separator)
        }
    }

    fun extractIncomingUrl(intent: Intent?): String? {
        if (intent == null || intent.action != Intent.ACTION_VIEW) {
            return null
        }
        val data: Uri = intent.data ?: return null
        val scheme = data.scheme?.lowercase() ?: return null
        return when (scheme) {
            "bitcoin", "boldwallet" -> data.toString()
            else -> null
        }
    }

    fun shareUrisFromIntent(intent: Intent?): List<Uri> {
        if (intent == null) {
            return emptyList()
        }
        val out = mutableListOf<Uri>()
        fun add(uri: Uri?) {
            if (uri != null && out.none { it.toString() == uri.toString() }) {
                out.add(uri)
            }
        }
        when (intent.action) {
            Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> {
                add(parcelableUri(intent, Intent.EXTRA_STREAM))
                parcelableUriList(intent, Intent.EXTRA_STREAM).forEach { add(it) }
                addClipUris(intent, ::add)
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()
                if (!text.isNullOrBlank() &&
                    (text.startsWith("content://") || text.startsWith("file://"))
                ) {
                    add(Uri.parse(text))
                }
                val data = intent.data
                val scheme = data?.scheme?.lowercase()
                if (scheme == "content" || scheme == "file") {
                    add(data)
                }
            }
            Intent.ACTION_VIEW -> {
                val data = intent.data
                val scheme = data?.scheme?.lowercase()
                if (scheme == "content" || scheme == "file") {
                    add(data)
                }
                addClipUris(intent, ::add)
            }
        }
        return out
    }

    private fun addClipUris(intent: Intent, add: (Uri?) -> Unit) {
        val clip = intent.clipData ?: return
        for (i in 0 until clip.itemCount) {
            add(clip.getItemAt(i)?.uri)
        }
    }

    private fun parcelableUri(intent: Intent, key: String): Uri? {
        return try {
            if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(key, Uri::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(key)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun parcelableUriList(intent: Intent, key: String): List<Uri> {
        return try {
            if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableArrayListExtra(key, Uri::class.java) ?: emptyList()
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableArrayListExtra(key) ?: emptyList()
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun resolveFirstLocalUri(context: Context, uris: List<Uri>): String? {
        for (uri in uris) {
            val local = resolveToLocalUri(context, uri)
            if (local != null) {
                return local
            }
        }
        return null
    }

    /**
     * Copy [uri] into cache and return a file:// URI, or null when the
     * stream cannot be read yet. Does not fall back to content://.
     */
    fun resolveToLocalUri(context: Context, uri: Uri): String? {
        reusableLocalUri(context, uri)?.let { return it }

        val displayName = queryDisplayName(context, uri)
        val ext =
            supportedExtension(uri.toString())
                ?: supportedExtension(displayName)
                ?: supportedExtension(uri.lastPathSegment)
                ?: "bin"
        val dest = File(context.cacheDir, cacheFileName(displayName, ext))
        return try {
            val sourcePath = if (uri.scheme.equals("file", ignoreCase = true)) uri.path else null
            if (
                sourcePath != null &&
                File(sourcePath).canonicalPath == dest.canonicalPath
            ) {
                return reusableLocalUri(context, uri)
            }
            if (dest.exists()) {
                dest.delete()
            }
            var copied = 0L
            copied = copyStream(context, uri, dest)
            if (copied <= 0L) {
                copied = copyFileDescriptor(context, uri, dest)
            }
            if (copied > 0L && dest.isFile && dest.length() > 0L) {
                Uri.fromFile(dest).toString()
            } else {
                if (dest.exists()) {
                    dest.delete()
                }
                null
            }
        } catch (e: Exception) {
            Log.w(TAG, "copy failed for $uri: ${e.message}")
            if (dest.exists() && dest.length() == 0L) {
                dest.delete()
            }
            null
        }
    }

    private fun copyStream(context: Context, uri: Uri, dest: File): Long {
        return try {
            context.contentResolver.openInputStream(uri)?.use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            } ?: 0L
        } catch (e: Exception) {
            Log.w(TAG, "openInputStream failed for $uri: ${e.message}")
            0L
        }
    }

    /** Some providers expose the grant only through a file descriptor. */
    private fun copyFileDescriptor(context: Context, uri: Uri, dest: File): Long {
        return try {
            context.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
                FileInputStream(pfd.fileDescriptor).use { input ->
                    dest.outputStream().use { output -> input.copyTo(output) }
                }
            } ?: 0L
        } catch (e: Exception) {
            Log.w(TAG, "openFileDescriptor failed for $uri: ${e.message}")
            0L
        }
    }

    private fun reusableLocalUri(context: Context, uri: Uri): String? {
        if (!uri.scheme.equals("file", ignoreCase = true)) {
            return null
        }
        val path = uri.path ?: return null
        if (!isReusableAppFile(context.cacheDir, context.filesDir, path)) {
            return null
        }
        return Uri.fromFile(File(path)).toString()
    }
}
