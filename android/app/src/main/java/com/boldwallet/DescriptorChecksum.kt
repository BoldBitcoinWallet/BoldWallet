package com.boldwallet

/**
 * Sparrow / Bitcoin Core output-descriptor checksum (BIP 380).
 * Mirrors [github.com/BoldBitcoinWallet/BBMTLib/tss/descriptor_checksum.go].
 */
object DescriptorChecksum {
    private const val INPUT_CHARSET =
        "0123456789()[],'/*abcdefgh@:$%{}" +
            "IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~" +
            "ijklmnopqrstuvwxyzABCDEFGH`#\"\\ "
    private const val CHECKSUM_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

    private val GENERATOR = longArrayOf(
        0xf5dee51989L,
        0xa9fdca3312L,
        0x1bab10e32dL,
        0x3706b1677aL,
        0x644d626ffdL,
    )

    fun appendToDescriptor(desc: String): String {
        if (desc.isEmpty()) return desc
        val body = if (desc.contains('#')) desc.substringBeforeLast('#') else desc
        val checksum = checksum(body)
        return "$body#$checksum"
    }

    private fun checksum(desc: String): String {
        val symbols = expandSymbols(desc)
        var c = 1L
        for (sym in symbols) {
            c = polyMod(c, sym)
        }
        repeat(8) { c = polyMod(c, 0) }
        c = c xor 1L
        return buildString(8) {
            for (j in 0 until 8) {
                val idx = ((c shr (5 * (7 - j))) and 31L).toInt()
                append(CHECKSUM_CHARSET[idx])
            }
        }
    }

    private fun polyMod(c: Long, value: Int): Long {
        val c0 = (c shr 35).toByte()
        var out = ((c and 0x7ffffffffL) shl 5) xor value.toLong()
        if (c0.toInt() and 1 != 0) out = out xor GENERATOR[0]
        if (c0.toInt() and 2 != 0) out = out xor GENERATOR[1]
        if (c0.toInt() and 4 != 0) out = out xor GENERATOR[2]
        if (c0.toInt() and 8 != 0) out = out xor GENERATOR[3]
        if (c0.toInt() and 16 != 0) out = out xor GENERATOR[4]
        return out
    }

    private fun expandSymbols(desc: String): IntArray {
        val symbols = mutableListOf<Int>()
        var cls = 0
        var clsCount = 0
        for (ch in desc) {
            val pos = INPUT_CHARSET.indexOf(ch)
            if (pos < 0) {
                throw IllegalArgumentException("invalid descriptor character '$ch'")
            }
            symbols.add(pos and 31)
            cls = cls * 3 + (pos shr 5)
            clsCount++
            if (clsCount == 3) {
                symbols.add(cls)
                cls = 0
                clsCount = 0
            }
        }
        if (clsCount > 0) {
            symbols.add(cls)
        }
        return symbols.toIntArray()
    }
}
