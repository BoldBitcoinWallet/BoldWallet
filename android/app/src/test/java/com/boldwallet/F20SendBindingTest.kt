package com.boldwallet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** F20 Phase 1b: canonical send-payment binding. */
class F20SendBindingTest {

    @Before
    fun setUp() {
        CeremonyTokens.resetForTest()
    }

    @Test
    fun digestDeterministicAndFieldSensitive() {
        val d = SendBinding.digest("tb1qdest", "1000", "10", "tb1qchange")
        // Shared cross-platform vector (Swift harness asserts the same).
        assertEquals(
            "fb135146c69b71bf5584dcf2b8f0facbcf98f796596d67804bb2a3528b7a410a", d,
        )
        assertEquals(d, SendBinding.digest("tb1qdest", "1000", "10", "tb1qchange"))
        // Whitespace-trimmed canonicalization.
        assertEquals(d, SendBinding.digest(" tb1qdest ", " 1000", "10 ", "tb1qchange"))
        // Every field is bound.
        assertTrue(d != SendBinding.digest("tb1qother", "1000", "10", "tb1qchange"))
        assertTrue(d != SendBinding.digest("tb1qdest", "2000", "10", "tb1qchange"))
        assertTrue(d != SendBinding.digest("tb1qdest", "1000", "11", "tb1qchange"))
        assertTrue(d != SendBinding.digest("tb1qdest", "1000", "10", "tb1qother"))
        assertEquals(64, d.length)
    }

    @Test
    fun bannerFromAddressPrefix() {
        assertTrue(SendBinding.isTestnetAddress("tb1qxyz"))
        assertTrue(SendBinding.isTestnetAddress("mNxyz"))
        assertTrue(SendBinding.isTestnetAddress("2Nxyz"))
        assertFalse(SendBinding.isTestnetAddress("bc1qxyz"))
        assertFalse(SendBinding.isTestnetAddress("1Axyz"))
        assertFalse(SendBinding.isTestnetAddress("3Jxyz"))
    }

    @Test
    fun confirmPaymentA_SignPaymentB_FailsAndRevokes() {
        val bound = SendBinding.digest("tb1qdest", "1000", "10", "tb1qchange")
        val token = CeremonyTokens.mint(
            CeremonyTokens.OpClass.SIGN, "sess-send", boundDigest = bound,
        )
        assertTrue(
            CeremonyTokens.verify(token, CeremonyTokens.OpClass.SIGN, "sess-send"),
        )
        // Same payment → ok.
        assertTrue(
            CeremonyTokens.contentBindingOk(
                token, SendBinding.digest("tb1qdest", "1000", "10", "tb1qchange"),
            ),
        )
        // Swapped destination after confirmation → fail + revoke.
        assertFalse(
            CeremonyTokens.contentBindingOk(
                token, SendBinding.digest("tb1qevil", "1000", "10", "tb1qchange"),
            ),
        )
        assertFalse(
            CeremonyTokens.verify(token, CeremonyTokens.OpClass.SIGN, "sess-send"),
        )
        assertEquals(CeremonyTokens.State.REVOKED, CeremonyTokens.stateOf(token))
    }

    @Test
    fun inflatedFeeAfterConfirmationFails() {
        val bound = SendBinding.digest("tb1qdest", "1000", "10", "tb1qchange")
        val token = CeremonyTokens.mint(
            CeremonyTokens.OpClass.SIGN, "sess-send", boundDigest = bound,
        )
        assertFalse(
            CeremonyTokens.contentBindingOk(
                token, SendBinding.digest("tb1qdest", "1000", "99999", "tb1qchange"),
            ),
        )
    }

    @Test
    fun unboundSignTokenRejectedForSendAndRevokes() {
        val token = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "sess-send")
        assertFalse(
            CeremonyTokens.contentBindingOk(
                token, SendBinding.digest("tb1qdest", "1000", "10", "tb1qchange"),
            ),
        )
        assertEquals(CeremonyTokens.State.REVOKED, CeremonyTokens.stateOf(token))
    }
}
