import CryptoKit
import Foundation

/// F20 Phase 1b: canonical send-payment binding. The confirmation
/// sheet and every send keysign compute this over the exact
/// arguments; a digest bound at mint must match at sign.
/// Amounts/fees are the satoshi strings as passed (trimmed) —
/// native never reformats numbers for the binding.
/// The network is deliberately NOT in the string: address
/// prefixes already encode it (tb1/m/n/2 vs bc1/1/3), and the
/// sheet banner is derived from the destination prefix.
enum SendBinding {
  static func digest(
    toAddress: String, amountSatoshi: String, feeSatoshi: String, changeAddress: String
  ) -> String {
    let parts = [toAddress, amountSatoshi, feeSatoshi, changeAddress].map {
      $0.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let canonical = "v1|" + parts.joined(separator: "|")
    let digest = SHA256.hash(data: Data(canonical.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  /// Banner network from the destination address prefix.
  static func isTestnetAddress(_ address: String) -> Bool {
    let a = address.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return a.hasPrefix("tb1") || a.hasPrefix("m") || a.hasPrefix("n") || a.hasPrefix("2")
  }
}
