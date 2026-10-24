package com.boldwallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * F11: bridge input validation on a real runtime (real .so + real
 * ART): JNI null/oversize guards, @ReactMethod null rejection, and
 * fetchData fail-closed. Needs an emulator (Small_Phone_API_35).
 */
@RunWith(AndroidJUnit4::class)
class F11BridgeValidationInstrumentedTest {

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

    /** Invoke a private external JNI fun by reflection (bypasses Kotlin null checks). */
    private fun jniString(name: String, vararg args: Any?): String {
        val m = DklsNative.javaClass.declaredMethods.first { it.name == name }
        m.isAccessible = true
        return m.invoke(DklsNative, *args) as String
    }

    @Test
    fun testF11_JniNullStringReturnsTypedError() {
        assertTrue(DklsNative.ensureLoaded())
        val out = jniString("bbmtSha256Jni", null)
        assertTrue("want f11 typed error, got: $out", out.startsWith("error:f11:"))
    }

    @Test
    fun testF11_JniOversizeStringReturnsTypedError() {
        assertTrue(DklsNative.ensureLoaded())
        val big = "z".repeat(17 * 1024 * 1024)
        val out = jniString("bbmtSha256Jni", big)
        assertTrue("want f11 typed error, got ${out.take(64)}", out.startsWith("error:f11:"))
    }

    @Test
    fun testF11_JniValidStringStillWorks() {
        assertTrue(DklsNative.ensureLoaded())
        val out = jniString("bbmtSha256Jni", "abc")
        assertTrue("want sha256 hex, got: $out", out.matches(Regex("[0-9a-f]{64}")))
    }

    @Test
    fun testF11_ReactMethodNullRejectsInvalidArgs() {
        val p = LatchPromise()
        module().fetchData(null, null, null, null, null, p)
        assertTrue(p.latch.await(5, TimeUnit.SECONDS))
        assertEquals("INVALID_ARGS", p.code)
    }

    @Test
    fun testF11_FetchDataUnreachableRejectsFailClosed() {
        assertTrue(DklsNative.ensureLoaded())
        CeremonyTokens.resetForTest { System.currentTimeMillis() }
        val token = CeremonyTokens.mint(CeremonyTokens.OpClass.SIGN, "f11")
        val priv = JSONObject(DklsNative.bbmtGenerateKeyPairNative()).getString("privateKey")
        val p = LatchPromise()
        module().fetchData("http://127.0.0.1:9/x", priv, "payload", token, "f11", p)
        assertTrue("fetchData never settled", p.latch.await(20, TimeUnit.SECONDS))
        assertEquals("FETCH_DATA_ERROR", p.code)
    }
}
