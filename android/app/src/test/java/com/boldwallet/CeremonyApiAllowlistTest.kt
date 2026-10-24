package com.boldwallet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** 3b-2d B15/B16: allowlist-or-token gate decision. */
class CeremonyApiAllowlistTest {

    private var now: Long = 1_700_000_000_000L

    private class MemStore : CeremonyApiAllowlist.Store {
        var urls: Set<String> = emptySet()
        override fun load(): Set<String> = urls
        override fun save(urls: Set<String>) {
            this.urls = urls.toSet()
        }
    }

    private lateinit var store: MemStore

    @Before
    fun setUp() {
        CeremonyTokens.resetForTest { now }
        var counter = 0
        CeremonyTokens.randomTokenId = { "cfg%029d".format(++counter) }
        store = MemStore()
    }

    @Test
    fun testF10bridge_SeedsMatchJsDefaults() {
        assertTrue(CeremonyApiAllowlist.SEEDS.contains("https://mempool.space/api"))
        assertTrue(CeremonyApiAllowlist.SEEDS.contains("https://mempool.space/testnet4/api"))
    }

    @Test
    fun testF10bridge_NormalizeAndParseCsv() {
        assertEquals("https://h/api", CeremonyApiAllowlist.normalize("  https://h/api// "))
        assertEquals(
            listOf("https://a/api", "https://b/api"),
            CeremonyApiAllowlist.parseCsv(" https://a/api/, ,https://b/api "),
        )
        assertEquals(emptyList<String>(), CeremonyApiAllowlist.parseCsv(" , "))
    }

    @Test
    fun testF10bridge_SeededUrlAppliesWithoutToken() {
        assertEquals(
            CeremonyApiAllowlist.Decision.APPLY,
            CeremonyApiAllowlist.decide(
                listOf("https://mempool.space/api"),
                "",
                "",
                store,
            ),
        )
        // Trailing-slash variant normalizes to the seed.
        assertEquals(
            CeremonyApiAllowlist.Decision.APPLY,
            CeremonyApiAllowlist.decide(
                listOf("https://mempool.space/api/"),
                "",
                "",
                store,
            ),
        )
    }

    @Test
    fun testF10bridge_UnknownUrlRejectsWithoutToken() {
        assertEquals(
            CeremonyApiAllowlist.Decision.REJECT,
            CeremonyApiAllowlist.decide(
                listOf("https://evil.example/api"),
                "",
                "",
                store,
            ),
        )
        assertTrue(store.urls.isEmpty())
    }

    @Test
    fun testF10bridge_ConfigTokenPersistsThenAppliesSilently() {
        val token = CeremonyTokens.mint(CeremonyTokens.OpClass.CONFIG, "cfg-1")
        assertEquals(
            CeremonyApiAllowlist.Decision.APPLY_AND_PERSIST,
            CeremonyApiAllowlist.decide(
                listOf("https://custom.example/api"),
                token,
                "cfg-1",
                store,
            ),
        )
        CeremonyApiAllowlist.persist(listOf("https://custom.example/api"), store)
        // Second use: silent, no token.
        assertEquals(
            CeremonyApiAllowlist.Decision.APPLY,
            CeremonyApiAllowlist.decide(
                listOf("https://custom.example/api"),
                "",
                "",
                store,
            ),
        )
    }

    @Test
    fun testF10bridge_WrongClassTokenRejects() {
        val sign = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "cfg-1")
        // Minting the sign token first, then a second mint would
        // supersede — so verify the sign token directly: config
        // gate must not accept it.
        assertEquals(
            CeremonyApiAllowlist.Decision.REJECT,
            CeremonyApiAllowlist.decide(
                listOf("https://custom.example/api"),
                sign,
                "cfg-1",
                store,
            ),
        )
    }

    @Test
    fun testF10bridge_WrongSessionTokenRejects() {
        val token = CeremonyTokens.mint(CeremonyTokens.OpClass.CONFIG, "cfg-1")
        assertEquals(
            CeremonyApiAllowlist.Decision.REJECT,
            CeremonyApiAllowlist.decide(
                listOf("https://custom.example/api"),
                token,
                "cfg-2",
                store,
            ),
        )
    }

    @Test
    fun testF10bridge_FeeCsvRequiresAllAllowed() {
        // One unknown host in the set forces the token path.
        assertEquals(
            CeremonyApiAllowlist.Decision.REJECT,
            CeremonyApiAllowlist.decide(
                listOf("https://mempool.space/api", "https://new.example/api"),
                "",
                "",
                store,
            ),
        )
        val token = CeremonyTokens.mint(CeremonyTokens.OpClass.CONFIG, "cfg-1")
        assertEquals(
            CeremonyApiAllowlist.Decision.APPLY_AND_PERSIST,
            CeremonyApiAllowlist.decide(
                listOf("https://mempool.space/api", "https://new.example/api"),
                token,
                "cfg-1",
                store,
            ),
        )
    }

    @Test
    fun testF10bridge_EmptyListAppliesVacuously() {
        assertEquals(
            CeremonyApiAllowlist.Decision.APPLY,
            CeremonyApiAllowlist.decide(emptyList(), "", "", store),
        )
    }
}
