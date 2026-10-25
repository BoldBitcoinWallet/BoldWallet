import CryptoKit
import Foundation

/// F20: Swift mirror of Go tss.PsbtConfirmationDigest — sha256
/// (lowercase hex) over the canonical decoded PSBT bytes.
/// Canonicalization matches Go canonicalPsbtBase64: strip
/// space/\n/\r/\t, strict base64-decode, require psbt magic.
/// Any deviation returns nil and the caller fails closed.
enum PsbtDigest {
  static func compute(_ psbtBase64: String) -> String? {
    let stripped = psbtBase64.filter { $0 != " " && $0 != "\n" && $0 != "\r" && $0 != "\t" }
    if stripped.isEmpty { return nil }
    guard let raw = Data(base64Encoded: stripped) else { return nil }
    let bytes = [UInt8](raw)
    guard bytes.count >= 4,
          bytes[0] == 0x70, bytes[1] == 0x73, bytes[2] == 0x62, bytes[3] == 0x74
    else { return nil }
    let digest = SHA256.hash(data: raw)
    return digest.map { String(format: "%02x", $0) }.joined()
  }
}
