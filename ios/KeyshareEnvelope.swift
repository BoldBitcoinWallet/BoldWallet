import CryptoKit
import Foundation
import Security

// F15b-1 at-rest envelope: device-bound AES-256-GCM sealing the
// Keychain `keyshare` value, so JS-direct RNES reads yield
// ciphertext. Pure Swift + platform frameworks (no RN deps) so
// the envelope-harness compiles this file standalone.
//
// Keychain shape mirrors RNEncryptedStorage exactly: class
// generic-password + account, NO service attribute. Keyshare
// WRITES carry WhenPasscodeSetThisDeviceOnly (F4 policy — the
// swiftc harness asserts the query dict; see envelope-harness).

enum KeyshareEnvelopeError: Error {
  case keychain(op: String, status: OSStatus)
  case malformed(String)
  case authFailed
}

enum KeyshareEnvelope {
  static let marker = "v1:"
  static let keyAccount = "keyshare-envelope-key"
  static let stagingSuffix = "_migrating"

  // Keychain accessible class for keyshare WRITES. Must match the
  // F4 patch (RNEncryptedStorage storeQueryForKey:); the harness
  // asserts both construct the same attribute.
  static let keyshareAccessible: CFString = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly

  static func isEnvelope(_ s: String) -> Bool {
    guard s.hasPrefix(marker) else { return false }
    return s.split(separator: ":", omittingEmptySubsequences: false).count == 3
  }

  // MARK: - Device key

  static func deviceKey(account: String = keyAccount) throws -> SymmetricKey {
    if let raw = try readItem(account: account) {
      guard raw.count == 32 else {
        throw KeyshareEnvelopeError.malformed("envelope key length")
      }
      return SymmetricKey(data: raw)
    }
    var bytes = Data(count: 32)
    let rc = bytes.withUnsafeMutableBytes { ptr in
      SecRandomCopyBytes(kSecRandomDefault, 32, ptr.baseAddress!)
    }
    guard rc == errSecSuccess else {
      throw KeyshareEnvelopeError.keychain(op: "random", status: rc)
    }
    let key = SymmetricKey(data: bytes)
    try addItem(account: account, data: bytes, accessible: keyshareAccessible)
    return key
  }

  // MARK: - Seal / open

  static func encrypt(_ json: String, keyAccount: String = keyAccount) throws -> String {
    let key = try deviceKey(account: keyAccount)
    let nonce = AES.GCM.Nonce()
    let sealed = try AES.GCM.seal(Data(json.utf8), using: key, nonce: nonce)
    guard let combined = sealed.combined else {
      throw KeyshareEnvelopeError.malformed("seal combined")
    }
    // combined = nonce(12) || ct || tag(16); store split for parity
    // with the Android v1:nonce:ct envelope (ct includes tag).
    let nonceData = combined.prefix(12)
    let rest = combined.suffix(from: 12)
    return marker + nonceData.base64EncodedString() + ":" + rest.base64EncodedString()
  }

  static func decrypt(_ envelope: String, keyAccount: String = keyAccount) throws -> String {
    let parts = envelope.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 3, parts[0] == "v1", !parts[1].isEmpty, !parts[2].isEmpty,
      let nonceData = Data(base64Encoded: parts[1]),
      let rest = Data(base64Encoded: parts[2]),
      nonceData.count == 12, rest.count > 16
    else {
      throw KeyshareEnvelopeError.malformed("envelope shape")
    }
    let key = try deviceKey(account: keyAccount)
    do {
      let box = try AES.GCM.SealedBox(
        nonce: AES.GCM.Nonce(data: nonceData),
        ciphertext: rest.prefix(rest.count - 16),
        tag: rest.suffix(16))
      let opened = try AES.GCM.open(box, using: key)
      guard let out = String(data: opened, encoding: .utf8) else {
        throw KeyshareEnvelopeError.malformed("envelope utf8")
      }
      return out
    } catch let e as KeyshareEnvelopeError {
      throw e
    } catch {
      throw KeyshareEnvelopeError.authFailed
    }
  }

  // MARK: - Migration (§1.5 staging protocol)

  /// Plaintext `account` → envelope, atomic via a staging item,
  /// retry-safe across crashes. Returns true when a migration ran.
  /// Sanitized logging only (lengths/booleans — never values).
  static func ensureEnveloped(
    account: String = "keyshare",
    keyAccount: String = keyAccount
  ) throws -> Bool {
    let staging = account + stagingSuffix
    guard let currentData = try readItem(account: account),
      let current = String(data: currentData, encoding: .utf8)
    else {
      return false // Fresh install — not an error.
    }
    if isEnvelope(current) {
      if (try readItem(account: staging)) != nil {
        try deleteItem(account: staging)
      }
      return false
    }
    guard current.contains("\"pub_key\"") else {
      throw KeyshareEnvelopeError.malformed("not a keyshare value")
    }
    let envelope: String
    if let stagedData = try readItem(account: staging),
      let staged = String(data: stagedData, encoding: .utf8),
      isEnvelope(staged),
      (try? decrypt(staged, keyAccount: keyAccount)) == current
    {
      envelope = staged // Crash after staging write: resume.
    } else {
      envelope = try encrypt(current, keyAccount: keyAccount)
      try deleteItem(account: staging)
      try addItem(account: staging, data: Data(envelope.utf8), accessible: keyshareAccessible)
      guard let check = try readItem(account: staging),
        let checkStr = String(data: check, encoding: .utf8),
        (try? decrypt(checkStr, keyAccount: keyAccount)) == current
      else {
        throw KeyshareEnvelopeError.malformed("staging verify mismatch")
      }
    }
    try deleteItem(account: account)
    try addItem(account: account, data: Data(envelope.utf8), accessible: keyshareAccessible)
    guard let promoted = try readItem(account: account),
      let promotedStr = String(data: promoted, encoding: .utf8),
      isEnvelope(promotedStr),
      (try? decrypt(promotedStr, keyAccount: keyAccount)) == current
    else {
      throw KeyshareEnvelopeError.malformed("promote verify mismatch")
    }
    try deleteItem(account: staging)
    return true
  }

  // MARK: - Query construction (harness-asserted)

  static func storeQueryForKey(account: String, data: Data) -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
      kSecValueData as String: data,
      kSecAttrAccessible as String: keyshareAccessible,
    ]
  }

  // MARK: - Direct Keychain ops (same item RNEncryptedStorage manages)

  static func readItem(account: String) throws -> Data? {
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: CFTypeRef?
    let st = SecItemCopyMatching(q as CFDictionary, &out)
    if st == errSecItemNotFound { return nil }
    guard st == errSecSuccess, let data = out as? Data else {
      throw KeyshareEnvelopeError.keychain(op: "read", status: st)
    }
    return data
  }

  static func addItem(account: String, data: Data, accessible: CFString) throws {
    var q = storeQueryForKey(account: account, data: data)
    q[kSecAttrAccessible as String] = accessible
    let st = SecItemAdd(q as CFDictionary, nil)
    guard st == errSecSuccess else {
      throw KeyshareEnvelopeError.keychain(op: "add", status: st)
    }
  }

  static func deleteItem(account: String) throws {
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
    ]
    let st = SecItemDelete(q as CFDictionary)
    guard st == errSecSuccess || st == errSecItemNotFound else {
      throw KeyshareEnvelopeError.keychain(op: "delete", status: st)
    }
  }
}
