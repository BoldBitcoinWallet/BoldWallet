// F20-1b send-binding parity — run with:
//   swiftc -O SendBinding.swift f20_send_check.swift -o /tmp/f20send && /tmp/f20send
// Vector asserted identically in Kotlin F20SendBindingTest.
import Foundation

let expected = "fb135146c69b71bf5584dcf2b8f0facbcf98f796596d67804bb2a3528b7a410a"
assert(SendBinding.digest(toAddress: "tb1qdest", amountSatoshi: "1000", feeSatoshi: "10", changeAddress: "tb1qchange") == expected, "send digest mismatch")
assert(SendBinding.digest(toAddress: " tb1qdest ", amountSatoshi: " 1000", feeSatoshi: "10 ", changeAddress: "tb1qchange") == expected, "trim mismatch")
assert(SendBinding.isTestnetAddress("tb1qxyz") && !SendBinding.isTestnetAddress("bc1qxyz"), "banner mismatch")
print("F20-1b Swift send-binding parity: PASS")
