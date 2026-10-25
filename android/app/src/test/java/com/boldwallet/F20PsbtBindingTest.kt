package com.boldwallet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** F20: content binding on ceremony tokens + Kotlin/Go digest parity. */
class F20PsbtBindingTest {

    // Shared cross-platform vector (Go TestF20 asserts the same):
    // sha256 of bytes 70 73 62 74 ff 00 ("psbt" magic + ff 00).
    private val vectorDigest =
        "417228a47b1ef375d6726a1e920ba20a24b577f463ccc78f5b51aadf2b068579"

    @Before
    fun setUp() {
        CeremonyTokens.resetForTest()
    }

    @Test
    fun digestMatchesGoVector() {
        assertEquals(vectorDigest, PsbtDigest.compute("cHNidP8A"))
        // Whitespace variants canonicalize identically (Go parity).
        assertEquals(vectorDigest, PsbtDigest.compute("cHN idP8A\n"))
    }

    @Test
    fun digestRejectsGarbage() {
        assertNull(PsbtDigest.compute(""))
        assertNull(PsbtDigest.compute("not-base64!!!"))
        // Valid base64, no psbt magic ("hello").
        assertNull(PsbtDigest.compute("aGVsbG8="))
    }

    @Test
    fun boundTokenAcceptsMatchingDigest() {
        val token = CeremonyTokens.mint(
            CeremonyTokens.OpClass.SIGN, "sess-1", boundDigest = vectorDigest,
        )
        assertTrue(CeremonyTokens.contentBindingOk(token, vectorDigest))
        // Still verifiable afterwards.
        assertTrue(
            CeremonyTokens.verify(token, CeremonyTokens.OpClass.SIGN, "sess-1"),
        )
    }

    @Test
    fun spoofConfirmASignBFailsAndRevokes() {
        val token = CeremonyTokens.mint(
            CeremonyTokens.OpClass.SIGN, "sess-1", boundDigest = vectorDigest,
        )
        assertTrue(
            CeremonyTokens.verify(token, CeremonyTokens.OpClass.SIGN, "sess-1"),
        )
        // Confirm A (vectorDigest), sign B (other digest).
        val other = "0".repeat(64)
        assertFalse(CeremonyTokens.contentBindingOk(token, other))
        // Token revoked: no retry with the right artifact either.
        assertFalse(
            CeremonyTokens.verify(token, CeremonyTokens.OpClass.SIGN, "sess-1"),
        )
        assertEquals(
            CeremonyTokens.State.REVOKED, CeremonyTokens.stateOf(token),
        )
    }

    @Test
    fun unparseablePsbtAtKeysignFailsClosed() {
        val token = CeremonyTokens.mint(
            CeremonyTokens.OpClass.SIGN, "sess-1", boundDigest = vectorDigest,
        )
        assertFalse(CeremonyTokens.contentBindingOk(token, null))
        assertEquals(
            CeremonyTokens.State.REVOKED, CeremonyTokens.stateOf(token),
        )
    }

    @Test
    fun unboundLegacyTokenUnaffected() {
        val token = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "sess-1")
        assertTrue(CeremonyTokens.contentBindingOk(token, "0".repeat(64)))
        assertTrue(CeremonyTokens.contentBindingOk(token, null))
        assertTrue(
            CeremonyTokens.verify(token, CeremonyTokens.OpClass.SIGN, "sess-1"),
        )
    }
}
