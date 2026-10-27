package com.boldwallet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class IncomingShareResolverTest {
    @Test
    fun cacheFileNameKeepsShareExtension() {
        assertEquals("wallet.share", IncomingShareResolver.cacheFileName("wallet.share", "bin"))
        assertEquals(
            "incoming_shared.bin",
            IncomingShareResolver.cacheFileName("photo.jpg", "bin"),
        )
        assertEquals("incoming_shared.share", IncomingShareResolver.cacheFileName(null, "share"))
    }

    @Test
    fun reusableAppFileRequiresNonEmptyFileInsideAppDirs() {
        val root = Files.createTempDirectory("share-resolver").toFile()
        val cache = File(root, "cache").apply { mkdirs() }
        val files = File(root, "files").apply { mkdirs() }
        val share = File(cache, "wallet.share")
        share.writeText("BW2$" + "abc")
        assertTrue(IncomingShareResolver.isReusableAppFile(cache, files, share.path))

        val outside = File(root, "outside.share")
        outside.writeText("BW2$" + "abc")
        assertFalse(IncomingShareResolver.isReusableAppFile(cache, files, outside.path))

        val empty = File(cache, "empty.share")
        empty.writeBytes(ByteArray(0))
        assertFalse(IncomingShareResolver.isReusableAppFile(cache, files, empty.path))
        assertFalse(IncomingShareResolver.isReusableAppFile(cache, files, File(cache, "missing.share").path))
    }
}
