package com.boldwallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * F27: Go errors must reject with typed codes, never resolve as values
 * (txids, addresses, signatures). Forced-error sample across fixed
 * methods, on a real runtime (real .so + real ART).
 * Needs an emulator (Small_Phone_API_35).
 */
@RunWith(AndroidJUnit4::class)
class F27ErrorTextInstrumentedTest {

    private class LatchPromise : Promise {
        val latch = CountDownLatch(1)
        var resolved: Any? = null
        var code: String? = null
        var message: String? = null

        override fun resolve(value: Any?) {
            resolved = value
            latch.countDown()
        }

        override fun reject(code: String, message: String?) {
            this.code = code
            this.message = message
            latch.countDown()
        }

        override fun reject(code: String, throwable: Throwable?) {
            this.code = code
            latch.countDown()
        }

        override fun reject(code: String, message: String?, throwable: Throwable?) {
            this.code = code
            this.message = message
            latch.countDown()
        }

        override fun reject(throwable: Throwable) {
            this.code = "THROWABLE"
            latch.countDown()
        }

        override fun reject(throwable: Throwable, userInfo: WritableMap) {
            this.code = "THROWABLE"
            latch.countDown()
        }

        override fun reject(code: String, userInfo: WritableMap) {
            this.code = code
            latch.countDown()
        }

        override fun reject(code: String, throwable: Throwable?, userInfo: WritableMap) {
            this.code = code
            latch.countDown()
        }

        override fun reject(code: String, message: String?, userInfo: WritableMap) {
            this.code = code
            this.message = message
            latch.countDown()
        }

        override fun reject(
            code: String?,
            message: String?,
            throwable: Throwable?,
            userInfo: WritableMap?,
        ) {
            this.code = code
            this.message = message
            latch.countDown()
        }

        override fun reject(message: String) {
            this.code = "MESSAGE"
            this.message = message
            latch.countDown()
        }
    }

    private fun module(): BBMTLibNativeModule {
        val ctx = BridgeReactContext(
            InstrumentationRegistry.getInstrumentation().targetContext,
        )
        return BBMTLibNativeModule(ctx)
    }

    private fun assertRejects(p: LatchPromise, wantCode: String) {
        assertTrue("timed out", p.latch.await(15, TimeUnit.SECONDS))
        assertNull("resolved error text as value: ${p.resolved}", p.resolved)
        assertEquals(wantCode, p.code)
    }

    @Test
    fun testF27_PostTxBadHexRejects() {
        val p = LatchPromise()
        module().postTx("zz-not-hex", p)
        assertRejects(p, "POST_TX_ERROR")
    }

    @Test
    fun testF27_BtcAddressBadPubkeyRejects() {
        val p = LatchPromise()
        module().btcAddress("zz-not-a-pubkey", "mainnet", "segwit-native", p)
        assertRejects(p, "BTC_ADDRESS_ERROR")
    }

    @Test
    fun testF27_ComputeTxIdBadHexRejects() {
        val p = LatchPromise()
        module().computeTxId("zz-not-hex", p)
        assertRejects(p, "COMPUTE_TXID_ERROR")
    }

    @Test
    fun testF27_HexToNpubBadHexRejects() {
        val p = LatchPromise()
        module().hexToNpub("zz", p)
        assertRejects(p, "HEX_TO_NPUB_ERROR")
    }

    @Test
    fun testF27_ParsePSBTDetailsGarbageRejects() {
        val p = LatchPromise()
        module().parsePSBTDetails("!!!not-base64!!!", p)
        assertRejects(p, "PARSE_PSBT_ERROR")
    }
}
