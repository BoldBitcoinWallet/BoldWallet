package com.boldwallet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** 3b-1: ceremony-token state machine, binding, expiry, revocation. */
class CeremonyTokensTest {

    private var now: Long = 1_700_000_000_000L

    @Before
    fun setUp() {
        CeremonyTokens.resetForTest { now }
        var counter = 0
        CeremonyTokens.randomTokenId = { "tok%028d".format(++counter) }
    }

    @Test
    fun testF15b2_MintStartsMinted_VerifyActivates() {
        val t = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "s1")
        assertEquals(CeremonyTokens.State.MINTED, CeremonyTokens.stateOf(t))
        assertTrue(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
        assertEquals(CeremonyTokens.State.ACTIVE, CeremonyTokens.stateOf(t))
        assertEquals(1, CeremonyTokens.useCountOf(t))
        // Multi-use within the ceremony: stays ACTIVE.
        assertTrue(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
        assertEquals(CeremonyTokens.State.ACTIVE, CeremonyTokens.stateOf(t))
        assertEquals(2, CeremonyTokens.useCountOf(t))
    }

    @Test
    fun testF15b2_ClassBinding_NoCrossReplay() {
        val t = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "s1")
        assertFalse(CeremonyTokens.verify(t, CeremonyTokens.OpClass.EXPORT, "s1"))
        assertFalse(CeremonyTokens.verify(t, CeremonyTokens.OpClass.KEYGEN, "s1"))
        // Failed verify does not transition or consume.
        assertEquals(CeremonyTokens.State.MINTED, CeremonyTokens.stateOf(t))
        assertEquals(0, CeremonyTokens.useCountOf(t))
        // Right class still works afterwards.
        assertTrue(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
    }

    @Test
    fun testF15b2_SessionBinding() {
        val t = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "s1")
        assertFalse(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s2"))
        assertEquals(CeremonyTokens.State.MINTED, CeremonyTokens.stateOf(t))
        assertTrue(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
    }

    @Test
    fun testF15b2_UnknownTokenFails() {
        assertFalse(
            CeremonyTokens.verify("tok0000000000000000000000000099", CeremonyTokens.OpClass.SIGN, "s1"),
        )
        assertNull(CeremonyTokens.stateOf("nope"))
    }

    @Test
    fun testF15b2_ExpiryLazilyTerminal() {
        val t = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "s1")
        // Unstarted token past TTL: fails, goes EXPIRED, stays failed.
        now += CeremonyTokens.TTL_MS + 1
        assertFalse(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
        assertEquals(CeremonyTokens.State.EXPIRED, CeremonyTokens.stateOf(t))
        assertFalse(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
    }

    @Test
    fun testF15b2_TtlBoundsStartNotDuration() {
        val t = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "s1")
        assertTrue(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
        // Started ceremony survives past TTL — never dies mid-sign.
        now += CeremonyTokens.TTL_MS + 1
        assertTrue(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
        assertEquals(CeremonyTokens.State.ACTIVE, CeremonyTokens.stateOf(t))
        // …but class/session binding still enforced when active.
        assertFalse(CeremonyTokens.verify(t, CeremonyTokens.OpClass.EXPORT, "s1"))
        assertFalse(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s2"))
        // …and completion still retires.
        CeremonyTokens.complete(t)
        assertFalse(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
    }

    @Test
    fun testF15b2_CompleteRetiresToUsed() {
        val t = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "s1")
        assertTrue(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
        CeremonyTokens.complete(t)
        assertEquals(CeremonyTokens.State.USED, CeremonyTokens.stateOf(t))
        assertFalse(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
        // Idempotent.
        CeremonyTokens.complete(t)
        assertEquals(CeremonyTokens.State.USED, CeremonyTokens.stateOf(t))
    }

    @Test
    fun testF15b2_ReleaseRevokes() {
        val t = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "s1")
        CeremonyTokens.release(t)
        assertEquals(CeremonyTokens.State.REVOKED, CeremonyTokens.stateOf(t))
        assertFalse(CeremonyTokens.verify(t, CeremonyTokens.OpClass.SIGN, "s1"))
        CeremonyTokens.release(t) // idempotent
        assertEquals(CeremonyTokens.State.REVOKED, CeremonyTokens.stateOf(t))
    }

    @Test
    fun testF15b2_CancelRevokesSession() {
        // Two live tokens, two sessions (mint supersedes, so build
        // the overlap via direct second mint AFTER capturing state).
        val a = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "sA")
        // New ceremony start revokes the prior session's token.
        val b = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "sB")
        assertEquals(CeremonyTokens.State.REVOKED, CeremonyTokens.stateOf(a))
        assertEquals(CeremonyTokens.State.MINTED, CeremonyTokens.stateOf(b))
        // Cancel revokes the live session.
        CeremonyTokens.revokeSession("sB")
        assertEquals(CeremonyTokens.State.REVOKED, CeremonyTokens.stateOf(b))
        assertFalse(CeremonyTokens.verify(b, CeremonyTokens.OpClass.SIGN, "sB"))
    }

    @Test
    fun testF15b2_SameSessionRemintSupersedes() {
        val first = CeremonyTokens.mint(CeremonyTokens.OpClass.CONFIG, "s1")
        val second = CeremonyTokens.mint(CeremonyTokens.OpClass.CONFIG, "s1")
        assertEquals(CeremonyTokens.State.REVOKED, CeremonyTokens.stateOf(first))
        assertTrue(
            CeremonyTokens.verify(second, CeremonyTokens.OpClass.CONFIG, "s1"),
        )
        assertFalse(
            CeremonyTokens.verify(first, CeremonyTokens.OpClass.CONFIG, "s1"),
        )
    }

    @Test
    fun testF15b2_MintRequiresSession() {
        try {
            CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "")
            throw AssertionError("empty session minted")
        } catch (e: IllegalArgumentException) {
            // expected
        }
    }

    @Test
    fun testF15b2_SingleCall_AcceptsRightClass_AnySession() {
        val t = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "nostr-single-call")
        assertTrue(CeremonyTokens.verifySingleCall(t, CeremonyTokens.OpClass.SIGN))
        assertEquals(CeremonyTokens.State.ACTIVE, CeremonyTokens.stateOf(t))
    }

    @Test
    fun testF15b2_SingleCall_KeygenClassRoundTrip() {
        // 3b-2b B20/B21: keypair generators mint keygen, verify keygen.
        val t = CeremonyTokens.mint(CeremonyTokens.OpClass.KEYGEN, "pairing-1")
        assertTrue(CeremonyTokens.verifySingleCall(t, CeremonyTokens.OpClass.KEYGEN))
        assertFalse(CeremonyTokens.verifySingleCall(t, CeremonyTokens.OpClass.SIGN))
    }

    @Test
    fun testF15b2_SingleCall_RejectsWrongClass() {
        val t = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "s1")
        assertFalse(CeremonyTokens.verifySingleCall(t, CeremonyTokens.OpClass.EXPORT))
        assertFalse(CeremonyTokens.verifySingleCall(t, CeremonyTokens.OpClass.KEYGEN))
        // Failed checks do not activate.
        assertEquals(CeremonyTokens.State.MINTED, CeremonyTokens.stateOf(t))
    }

    @Test
    fun testF15b2_SingleCall_RejectsUnknownRevokedExpired() {
        assertFalse(
            CeremonyTokens.verifySingleCall(
                "tok0000000000000000000000000099",
                CeremonyTokens.OpClass.SIGN,
            ),
        )
        val revoked = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "s1")
        CeremonyTokens.release(revoked)
        assertFalse(CeremonyTokens.verifySingleCall(revoked, CeremonyTokens.OpClass.SIGN))
        val stale = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "s2")
        now += CeremonyTokens.TTL_MS + 1
        assertFalse(CeremonyTokens.verifySingleCall(stale, CeremonyTokens.OpClass.SIGN))
        assertEquals(CeremonyTokens.State.EXPIRED, CeremonyTokens.stateOf(stale))
    }

    @Test
    fun testF15b2_OpClassWireParsing() {
        assertEquals(
            CeremonyTokens.OpClass.SIGN,
            CeremonyTokens.OpClass.parse("sign"),
        )
        assertEquals(
            CeremonyTokens.OpClass.KEYGEN,
            CeremonyTokens.OpClass.parse("keygen"),
        )
        assertNull(CeremonyTokens.OpClass.parse("Sign"))
        assertNull(CeremonyTokens.OpClass.parse("admin"))
        assertNull(CeremonyTokens.OpClass.parse(""))
        // No TRANSPORT class: transport rides the parent token.
        assertNull(CeremonyTokens.OpClass.parse("transport"))
    }

}
