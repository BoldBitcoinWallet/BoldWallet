package com.boldwallet

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File

/**
 * Resolves ACTION_SEND / ACTION_VIEW content:// URIs from any app
 * (Files, Telegram, WhatsApp, Signal, etc.). Provider paths often omit
 * the .share / .psbt extension, so we use DISPLAY_NAME and copy to cache
 * so JS can classify the file.
 *
 * Chat apps grant read permission only to the activity that received the
 * intent — copy immediately; do not require a known extension.
 */
object IncomingShareResolver {
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

    fun resolveToLocalUri(context: Context, uri: Uri): String? {
        val displayName = queryDisplayName(context, uri)
        val ext =
            supportedExtension(uri.toString())
                ?: supportedExtension(displayName)
                ?: supportedExtension(uri.lastPathSegment)
                ?: "bin"

        try {
            context.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        } catch (_: Exception) {
            // Provider may only grant a one-shot read; copy still works from the activity.
        }

        val dest = File(context.cacheDir, cacheFileName(displayName, ext))
        return try {
            if (dest.exists()) {
                dest.delete()
            }
            context.contentResolver.openInputStream(uri)?.use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            }
            if (dest.exists() && dest.length() > 0L) {
                Uri.fromFile(dest).toString()
            } else {
                fallbackUri(uri, displayName)
            }
        } catch (_: Exception) {
            fallbackUri(uri, displayName)
        }
    }

    private fun fallbackUri(uri: Uri, displayName: String?): String? {
        val decorated = decorateUriWithDisplayName(uri, displayName)
        // Still hand the URI to JS even without .share/.psbt so the import
        // path can peek bytes instead of silently dropping the share.
        return decorated.ifBlank { null }
    }
}
