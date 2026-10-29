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

    @Test
    fun testF11_UrlShapeAccepts() {
        val good = listOf(
            "https://mempool.space/api",
            "https://example.com:8443/api",
            "HTTPS://upper.example/api",
            "  https://mempool.space/api  ",
            "http://127.0.0.1:3002/api",
            "http://localhost:3002/api",
            "http://10.0.2.15/api",
            "http://192.168.1.10:3002/api",
            "http://172.16.0.9/api",
            "http://169.254.10.20/api",
            "http://user:pass@192.168.1.10:3002/api",
            "http://[::1]:3002/api",
            "ws://127.0.0.1:8080/x",
            "wss://10.1.2.3/api",
        )
        for (u in good) {
            assertTrue("accept: $u", CeremonyApiAllowlist.isAllowedApiUrlShape(u))
        }
    }

    @Test
    fun testF11_UrlShapeRejects() {
        val bad = listOf(
            "",
            "   ",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ftp://example.com/api",
            "mempool.space/api",
            "https://",
            "http://",
            "http:///api",
            "http://example.com/api",
            "http://8.8.8.8/api",
            "http://172.32.0.1/api",
            "http://[::1/api",
            "ws://example.com/x",
            "wss://example.com/api",
            "gopher://localhost/api",
        )
        for (u in bad) {
            assertFalse("reject: $u", CeremonyApiAllowlist.isAllowedApiUrlShape(u))
        }
    }

    @Test
    fun testF11_LanHostLiterals() {
        assertTrue(CeremonyApiAllowlist.isLanHost("localhost"))
        assertTrue(CeremonyApiAllowlist.isLanHost("127.0.0.1"))
        assertTrue(CeremonyApiAllowlist.isLanHost("10.9.9.9"))
        assertTrue(CeremonyApiAllowlist.isLanHost("172.16.0.1"))
        assertTrue(CeremonyApiAllowlist.isLanHost("172.31.255.255"))
        assertTrue(CeremonyApiAllowlist.isLanHost("192.168.0.1"))
        assertTrue(CeremonyApiAllowlist.isLanHost("169.254.0.2"))
        assertTrue(CeremonyApiAllowlist.isLanHost("::1"))
        assertTrue(CeremonyApiAllowlist.isLanHost("fe80::1"))
        assertTrue(CeremonyApiAllowlist.isLanHost("fd00::1"))
        assertFalse(CeremonyApiAllowlist.isLanHost("example.com"))
        assertFalse(CeremonyApiAllowlist.isLanHost("8.8.8.8"))
        assertFalse(CeremonyApiAllowlist.isLanHost("172.32.0.1"))
        assertFalse(CeremonyApiAllowlist.isLanHost("192.167.0.1"))
        assertFalse(CeremonyApiAllowlist.isLanHost("1.2.3.4.5"))
        assertFalse(CeremonyApiAllowlist.isLanHost("999.1.1.1"))
        assertFalse(CeremonyApiAllowlist.isLanHost("2001:db8::1"))
    }
}
