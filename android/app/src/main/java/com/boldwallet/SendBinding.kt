package com.boldwallet

import java.security.MessageDigest

/**
 * F20 Phase 1b: canonical send-payment binding. The confirmation
 * sheet and every send keysign compute this over the exact
 * arguments; a digest bound at mint must match at sign.
 * Amounts/fees are the satoshi strings as passed (trimmed) —
 * native never reformats numbers for the binding.
 * The network is deliberately NOT in the string: address
 * prefixes already encode it (tb1/m/n/2 vs bc1/1/3), and the
 * sheet banner is derived from the destination prefix.
 */
object SendBinding {
    fun digest(
        toAddress: String,
        amountSatoshi: String,
        feeSatoshi: String,
        changeAddress: String,
    ): String {
        val canonical = listOf(
            toAddress.trim(),
            amountSatoshi.trim(),
            feeSatoshi.trim(),
            changeAddress.trim(),
        ).joinToString("|", prefix = "v1|")
        val d = MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(Charsets.UTF_8))
        return d.joinToString("") { "%02x".format(it) }
    }

    /** Banner network from the destination address prefix. */
    fun isTestnetAddress(address: String): Boolean {
        val a = address.trim().lowercase()
        return a.startsWith("tb1") || a.startsWith("m") ||
            a.startsWith("n") || a.startsWith("2")
    }
}
