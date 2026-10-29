package com.boldwallet

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * DEBUG-ONLY ceremony test mint. Lives in the debug source set:
 * compiled into debug builds, ABSENT from release binaries
 * (mirrors Swift #if DEBUG strip). Registered reflectively from
 * MainApplication so release compiles without it. Exposes ONE
 * prompt-bypassing mint for instrumented/unit tests; production
 * JS must never reference this module — guardrailed in jest.
 */
class CeremonyTestModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CeremonyTestModule"

    @ReactMethod
    fun requestCeremonyTokenTest(op: String, sessionID: String, promise: Promise) {
        val opClass = CeremonyTokens.OpClass.parse(op)
        if (opClass == null || sessionID.isEmpty()) {
            promise.reject(
                "CEREMONY_AUTH_REQUIRED",
                "Confirm to continue — authenticate in the prompt.",
                null,
            )
            return
        }
        try {
            promise.resolve(CeremonyTokens.mint(opClass, sessionID))
        } catch (e: Exception) {
            promise.reject("CEREMONY_TOKEN_ERROR", e.message, e)
        }
    }
}
