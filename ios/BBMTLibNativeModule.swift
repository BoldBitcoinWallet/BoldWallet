//
//  BBMTLibNativeModule.swift
//  Bold Bitcoin MPC TSS Lib
//
//  Created on 30/11/2024.
//
import Darwin
import Foundation
import LocalAuthentication
import Network
import React
import Security
import SystemConfiguration.CaptiveNetwork
@objc(BBMTLibNativeModule)
class BBMTLibNativeModule: RCTEventEmitter {

  var useLog: Bool = true

  func onGoLog(_ message: String?) {
    if let msg = message {
      sendLogEvent("GoLog", msg)
    }
  }

  func onMessage(_ message: String?) {
    if let msg = message {
      let tag = "TssHook"
      let params: [String: Any] = ["tag": tag, "message": msg]
      sendEvent(withName: "BBMT_APPLE", body: params)
      MpcKeepAliveModule.onTssHook(msg)
    }
    onGoLog(message)
  }

  override func supportedEvents() -> [String] {
    return ["BBMT_APPLE"]
  }

  private func resolve(
    _ tag: String, _ output: String, _ error: NSError?, _ resolver: @escaping RCTPromiseResolveBlock
  ) {
    if error == nil {
      sendLogEvent(tag, output)
      resolver(output)
    } else {
      sendLogEvent(tag, error!.localizedDescription)
      resolver(error!.localizedDescription)
    }
  }

  private func sendLogEvent(_ tag: String, _ message: String) {
    if useLog {
      let params: [String: Any] = ["tag": tag, "message": message]
      print(tag + ": " + message)
      sendEvent(withName: "BBMT_APPLE", body: params)
    }
  }

  /// RN always passes the keyshare as a Swift `String` from JS (unavoidable bridge copy). This
  /// does not remove that; it zeroes the UTF-8 staging buffer we allocate and short-lived temporaries
  /// via `autoreleasepool`. Tss still receives `NSString*`; copies inside Tss are not under app control.
  /// Keychain account for the full keyshare JSON. Must match `react-native-encrypted-storage`
  /// (`EncryptedStorage.setItem('keyshare', …)` → `kSecAttrAccount`).
  private enum RNESKeychain {
    static let keyshareAccount = "keyshare"
  }

  /// When the full document fails `JSONSerialization` (huge `ecdsa_local_data`, etc.), still pull `nsec` for Nostr.
  private func extractNsecStringViaRegex(from raw: String) -> String? {
    let pattern = #""nsec"\s*:\s*"([^"]*)""#
    guard let re = try? NSRegularExpression(pattern: pattern, options: []) else {
      return nil
    }
    let range = NSRange(raw.startIndex..., in: raw)
    guard let m = re.firstMatch(in: raw, options: [], range: range),
      m.numberOfRanges >= 2,
      let sr = Range(m.range(at: 1), in: raw)
    else {
      return nil
    }
    let s = String(raw[sr])
    return s.isEmpty ? nil : s
  }

  /// Debug: summary line (lengths / types) only.
  private func logNsecKeyshareDiag(rawLen: Int, obj: [String: Any]?, nsecVal: Any?) {
    let keysCsv = obj.map { $0.keys.sorted().joined(separator: ",") } ?? "(nil)"
    let nsecDesc: String
    if nsecVal == nil {
      nsecDesc = "absent"
    } else if let s = nsecVal as? String {
      let mode: String
      if s.hasPrefix("nsec1") {
        mode = "bech32"
      } else if !s.isEmpty && s.count % 2 == 0 {
        mode = "hex_candidate"
      } else {
        mode = "other"
      }
      nsecDesc = "string len=\(s.count) mode=\(mode)"
    } else {
      nsecDesc = "NOT_STRING type=\(String(describing: Swift.type(of: nsecVal as Any)))"
    }
    sendLogEvent(
      "nsecFromKeyshare",
      "diag rawLen=\(rawLen) keys=[\(keysCsv)] nsec=\(nsecDesc)")
  }

  /// One Keychain read: parsed Nostr `nsec` for Tss + same raw keyshare JSON string for native MPC calls.
  /// NOTE (F15): these strings are the irreducible bridge copies (JS String -> NSString -> Go string).
  /// Do not add staging copies; full elimination needs native-held shares (F15b).
  private func nsecAndKeyshareJSONFromRNES() throws -> (partyNsec: String, keyshareJSON: String) {
    guard let raw = loadKeyshareJSONFromRNES() else {
      sendLogEvent("nsecFromKeyshare", "FAIL: no_keychain_blob account=keyshare")
      throw NSError(
        domain: "BBMTLibNativeModule", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "No keyshare found in secure storage"])
    }
    let rawLen = raw.utf8.count
    let data = raw.data(using: .utf8)
    var obj: [String: Any]?
    var parseError: Error?
    if let data = data {
      do {
        if let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
          obj = root
        }
      } catch {
        parseError = error
      }
    }
    var nsecVal: Any?
    if let obj = obj {
      nsecVal = obj["nsec"]
    } else {
      let errDesc = parseError?.localizedDescription ?? "not_dictionary_or_nil_data"
      sendLogEvent(
        "nsecFromKeyshare",
        "WARN: full_json_parse_failed rawLen=\(rawLen) err=\(errDesc)")
      if let extracted = extractNsecStringViaRegex(from: raw) {
        nsecVal = extracted
        sendLogEvent(
          "nsecFromKeyshare",
          "recover: nsec from regex len=\(extracted.count)")
      } else {
        sendLogEvent(
          "nsecFromKeyshare",
          "FAIL: json_parse and no regex nsec rawLen=\(rawLen) err=\(errDesc)")
        throw NSError(
          domain: "BBMTLibNativeModule", code: 6,
          userInfo: [
            NSLocalizedDescriptionKey:
              "Could not parse keyshare JSON (nsec not extractable)"
          ])
      }
    }
    logNsecKeyshareDiag(rawLen: rawLen, obj: obj, nsecVal: nsecVal)
    guard let nsecField = nsecVal as? String, !nsecField.isEmpty else {
      sendLogEvent(
        "nsecFromKeyshare",
        "FAIL: nsec missing empty_or_non_string (see diag above)")
      throw NSError(
        domain: "BBMTLibNativeModule", code: 2,
        userInfo: [NSLocalizedDescriptionKey: "nsec not found in keyshare"])
    }
    let partyNsec: String
    if nsecField.hasPrefix("nsec1") {
      partyNsec = nsecField
    } else {
      do {
        partyNsec = try Self.hexUtf8BytesToNsecString(nsecField)
      } catch {
        sendLogEvent(
          "nsecFromKeyshare",
          "FAIL: hex_decode \(error.localizedDescription)")
        throw error
      }
    }
    return (partyNsec, raw)
  }

  private static func hexUtf8BytesToNsecString(_ hex: String) throws -> String {
    let s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    guard s.count % 2 == 0 else {
      throw NSError(
        domain: "BBMTLibNativeModule", code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Invalid nsec hex encoding"])
    }
    var bytes = [UInt8]()
    bytes.reserveCapacity(s.count / 2)
    var i = s.startIndex
    while i < s.endIndex {
      let j = s.index(i, offsetBy: 2)
      let byteStr = String(s[i..<j])
      guard let b = UInt8(byteStr, radix: 16) else {
        throw NSError(
          domain: "BBMTLibNativeModule", code: 4,
          userInfo: [NSLocalizedDescriptionKey: "Invalid nsec hex"])
      }
      bytes.append(b)
      i = j
    }
    guard let out = String(bytes: bytes, encoding: .utf8), out.hasPrefix("nsec1") else {
      throw NSError(
        domain: "BBMTLibNativeModule", code: 5,
        userInfo: [NSLocalizedDescriptionKey: "Invalid nsec format in keyshare"])
    }
    return out
  }

  /// True when Keychain has a `keyshare` item without loading the blob (`kSecReturnData` false).
  private func keyshareExistsInRNES() -> Bool {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: RNESKeychain.keyshareAccount,
      kSecReturnData as String: false,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    return status == errSecSuccess
  }

  /// Read keyshare from the same Keychain layout as `RNEncryptedStorage` iOS implementation.
  private func loadKeyshareJSONFromRNES() -> String? {
    // F15b-1: de-envelopes; pre-migration plaintext self-heals
    // inline. Corruption surfaces loudly at bootstrap migration;
    // here nil → NO_KEYSHARE (same user action: re-import).
    guard let data = try? KeyshareEnvelope.readItem(account: RNESKeychain.keyshareAccount),
      let raw = String(data: data, encoding: .utf8)
    else { return nil }
    if !KeyshareEnvelope.isEnvelope(raw) {
      guard (try? KeyshareEnvelope.ensureEnveloped(account: RNESKeychain.keyshareAccount)) != nil,
        let data2 = try? KeyshareEnvelope.readItem(account: RNESKeychain.keyshareAccount),
        let migrated = String(data: data2, encoding: .utf8),
        KeyshareEnvelope.isEnvelope(migrated)
      else { return nil }
      return try? KeyshareEnvelope.decrypt(migrated)
    }
    return try? KeyshareEnvelope.decrypt(raw)
  }

  /// F15b-1 resolve guard: returns false (and logs) when a value
  /// about to resolve to JS contains share-material labels.
  private func guardJsSafeResolve(_ value: String, method: String) -> Bool {
    if KeyshareEnvelope.containsShareSecrets(value) {
      sendLogEvent(method, "REFUSED to resolve share bytes to JS")
      return false
    }
    return true
  }

  /// F15b-1: staged DKG/import results must carry a handle ID.
  private func guardStagedShape(_ value: String, method: String) -> Bool {
    guard guardJsSafeResolve(value, method: method) else { return false }
    guard value.contains("\"handle\"") else {
      sendLogEvent(method, "REFUSED malformed staged result (no handle)")
      return false
    }
    return true
  }

  /// Maps envelope/keychain failures to the shared
  /// [SECURE_STORAGE_*] tokens so JS copy matches F3/F4.
  private func secureStorageMessage(_ error: Error) -> String {
    if let e = error as? KeyshareEnvelopeError {
      switch e {
      case .keychain(let op, let status):
        if status == errSecInteractionNotAllowed || status == errSecAuthFailed {
          return "[SECURE_STORAGE_LOCKED] Keychain \(op) failed. Your keyshare was not saved/read."
        }
        return "[SECURE_STORAGE_UNAVAILABLE] Keychain \(op) failed (\(status)). Your keyshare was not saved/read."
      case .malformed, .authFailed:
        return "[SECURE_STORAGE_CORRUPTED] Secure storage is corrupted. Your keyshare was not saved/read. Please re-import your keyshare backup."
      }
    }
    return "[SECURE_STORAGE_UNAVAILABLE] Secure storage unavailable. Your keyshare was not saved/read."
  }

  @objc func publishData(
    _ port: String, timeout: String, encKey: String, raw: String, mode: String,
    ceremonyToken: String, ceremonySessionID: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2c B13: rides the handshake ceremony token (sign|keygen).
    guard CeremonyTokens.verifyTransport(token: ceremonyToken, sessionID: ceremonySessionID) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssPublishData(port, timeout, encKey, raw, mode, &error)
      if error == nil {
        self?.sendLogEvent("publishData", output)
        resolver(output)
      } else {
        self?.sendLogEvent("publishData", error!.localizedDescription)
        resolver("")
      }
    }
  }

  @objc func fetchData(
    _ url: String, decKey: String, payload: String,
    ceremonyToken: String, ceremonySessionID: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2c B14: rides the handshake ceremony token (sign|keygen).
    guard CeremonyTokens.verifyTransport(token: ceremonyToken, sessionID: ceremonySessionID) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    var error: NSError?
    let output = TssFetchData(url, decKey, payload, &error)
    if error == nil {
      self.sendLogEvent("fetchData", output)
      resolver(output)
    } else {
      self.sendLogEvent("fetchData", error!.localizedDescription)
      resolver("")
    }
  }

  @objc func setBtcNetwork(
    _ network: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      TssSetNetwork(network, &error)
      let output = TssGetNetwork(&error)
      self?.sendLogEvent("setBtcNetwork", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func spendingHash(
    _ senderAddress: String,
    receiverAddress: String,
    amountSatoshi: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssSpendingHash(
        senderAddress,
        receiverAddress,
        Int64(amountSatoshi) ?? 0, &error)
      self?.sendLogEvent("spendingHash", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func spendingHashWithUTXOs(
    _ utxosWithPathsJSON: String,
    receiverAddress: String,
    amountSatoshi: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssSpendingHashWithUTXOs(
        utxosWithPathsJSON,
        receiverAddress,
        amountSatoshi, &error)
      self?.sendLogEvent("spendingHashWithUTXOs", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func estimateFees(
    _ senderAddress: String,
    receiverAddress: String,
    amountSatoshi: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssEstimateFees(
        senderAddress,
        receiverAddress,
        Int64(amountSatoshi) ?? 0, &error)
      self?.sendLogEvent("estimateFee", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func estimateFeeWithUTXOs(
    _ utxosWithPathsJSON: String,
    receiverAddress: String,
    amountSatoshi: String,
    changeAddress: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssEstimateFeeWithUTXOs(
        utxosWithPathsJSON,
        receiverAddress,
        amountSatoshi,
        changeAddress, &error)
      self?.sendLogEvent("estimateFeeWithUTXOs", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func runRelay(
    _ port: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssRunRelay(port, &error)
      self?.sendLogEvent("runRelay", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func stopRelay(
    _ tag: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssStopRelay(&error)
    resolve("stopRelay", output, error, resolver)
  }

  @objc func listenForPeers(
    _ id: String, pubkey: String, port: String, timeout: String, mode: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssListenForPeers(id, pubkey, port, timeout, mode, &error)
      if error == nil {
        self?.sendLogEvent("listenForPeers", output)
        resolver(output)
      } else {
        self?.sendLogEvent("listenForPeers", error!.localizedDescription)
        resolver("")
      }
    }
  }

  @objc func discoverPeers(
    _ id: String, pubkey: String, localIp: String, remoteIp: String, port: String, timeout: String, mode: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssDiscoverPeers(id, pubkey, localIp, remoteIp, port, timeout, mode, &error)
      if error == nil {
        self?.sendLogEvent("discoverPeers", output)
        resolver(output)
      } else { 
        self?.sendLogEvent("discoverPeers", error!.localizedDescription)
        resolver("")
      }
    }
  }

  @objc func getLanIp(
    _ peerIP: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var address: String?
    var classCAddress: String?
    var iphoneHotspotIp: String?
    var sameSubnetIp: String?

    var ifaddr: UnsafeMutablePointer<ifaddrs>? = nil

    // Check if peerIP is valid IPv4 for subnet matching
    let checkSubnet =
      !peerIP.isEmpty
      && peerIP.range(of: #"^\d+\.\d+\.\d+\.\d+$"#, options: .regularExpression) != nil

    if getifaddrs(&ifaddr) == 0 {
      var ptr = ifaddr
      while ptr != nil {
        defer { ptr = ptr?.pointee.ifa_next }
        guard let interface = ptr?.pointee else { continue }
        let addrFamily = interface.ifa_addr.pointee.sa_family
        if addrFamily == UInt8(AF_INET), let name = interface.ifa_name {
          let interfaceName = String(cString: name)
          if interfaceName == "en0" {
            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(
              interface.ifa_addr,
              socklen_t(interface.ifa_addr.pointee.sa_len),
              &hostname,
              socklen_t(hostname.count),
              nil,
              0,
              NI_NUMERICHOST
            ) == 0 {
              let ipAddress = String(cString: hostname)
              // Check subnet match first if peerIP is provided
              if checkSubnet && isSameSubnet(ipAddress, peerIP) {
                sameSubnetIp = ipAddress
                break  // Exit early if we find a subnet match
              } else if isClassC(ipAddress) {
                classCAddress = ipAddress
              } else if ipAddress.hasPrefix("172.20.10.") {
                iphoneHotspotIp = ipAddress
              } else if address == nil {
                address = ipAddress
              }
            }
          }
        }
      }
      freeifaddrs(ifaddr)
    }

    if let subnetIp = sameSubnetIp {
      sendLogEvent("getLanIp (Same Subnet)", subnetIp)
      resolver(subnetIp)
    } else if let hotspotIp = iphoneHotspotIp {
      sendLogEvent("getLanIp (iPhone Hotspot)", hotspotIp)
      resolver(hotspotIp)
    } else if let classC = classCAddress {
      sendLogEvent("getLanIp (Class C)", classC)
      resolver(classC)
    } else {
      sendLogEvent("getLanIp", address ?? "")
      resolver(address ?? "")
    }
  }

  private func isClassC(_ ip: String) -> Bool {
    let parts = ip.split(separator: ".").compactMap { Int($0) }
    return parts.count == 4 && parts[0] >= 192 && parts[0] <= 223
  }

  private func isSameSubnet(_ ip1: String, _ ip2: String) -> Bool {
    let parts1 = ip1.split(separator: ".").compactMap { Int($0) }
    let parts2 = ip2.split(separator: ".").compactMap { Int($0) }

    guard parts1.count == 4, parts2.count == 4 else { return false }

    // Assuming /24 subnet mask - compare first 3 octets
    return parts1[0] == parts2[0] && parts1[1] == parts2[1] && parts1[2] == parts2[2]
  }

  @objc func eciesKeypair(
    _ ceremonyToken: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2b B21: single-call keygen ceremony (no MPC session yet).
    guard CeremonyTokens.verifySingleCall(token: ceremonyToken, opClass: .keygen) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    var error: NSError?
    let output = TssGenerateKeyPair(&error)
    resolve("eciesKeypair", output, error, resolver)
  }

  // F10 (3a): dead oracle methods aesEncrypt / aesDecrypt /
  // aesEncryptStoredKeyshare REMOVED (zero callers repo-wide, no
  // WebView/eval/reflection path; Go TssAes* stays for native use).
  /// F1: versioned backup import. Resolves {"format":"v2"|"legacy","plaintext":"..."}.
  // F15b-1 (A5): backupDecrypt REMOVED — plaintext-to-JS import
  // replaced by importBackupToStagedHandle (A6).
  /// F15b-1 (A6): versioned backup import that stages natively.
  /// Resolves {handle, metadata, legacy} — never plaintext.
  @objc func importBackupToStagedHandle(
    _ blob: String, password: String, ceremonyToken: String, ceremonySessionID: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2e B17: strict import ceremony (owner-shared stage+persist).
    guard CeremonyTokens.verify(token: ceremonyToken, opClass: .import, sessionID: ceremonySessionID) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssImportBackupStaged(blob, password, &error)
      if let error = error {
        rejecter("BACKUP_IMPORT_ERROR", error.localizedDescription, error)
        return
      }
      guard self?.guardStagedShape(output, method: "importBackupToStagedHandle") == true else {
        rejecter("BACKUP_IMPORT_ERROR", "Keyshare staging failed", nil)
        return
      }
      resolver(output)
    }
  }

  /// F15b-1 (A7): persist a staged handle to enveloped Keychain.
  /// Resolves post-finalize metadata for the JS mirror. Staged
  /// entry is destroyed only after a VERIFIED write (retryable).
  @objc func persistStoredKeyshare(
    _ handle: String, nsec: String, npub: String,
    ceremonyToken: String, ceremonySessionID: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2e B18: strict import ceremony (shared with stage, or
    // the setup-commit flow's own save ceremony).
    guard CeremonyTokens.verify(token: ceremonyToken, opClass: .import, sessionID: ceremonySessionID) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let json = TssFinalizeStagedForPersist(handle, nsec, npub, &error)
      if let error = error {
        rejecter("PERSIST_ERROR", error.localizedDescription, error)
        return
      }
      do {
        let envelope = try KeyshareEnvelope.encrypt(json)
        try KeyshareEnvelope.deleteItem(account: RNESKeychain.keyshareAccount)
        try KeyshareEnvelope.addItem(
          account: RNESKeychain.keyshareAccount, data: Data(envelope.utf8),
          accessible: KeyshareEnvelope.keyshareAccessible)
        guard let check = try KeyshareEnvelope.readItem(account: RNESKeychain.keyshareAccount),
          let checkStr = String(data: check, encoding: .utf8),
          (try? KeyshareEnvelope.decrypt(checkStr)) == json
        else {
          rejecter(
            "PERSIST_ERROR",
            "Secure write verification failed. Retry setup without force-closing the app.", nil)
          return
        }
        var metaError: NSError?
        let metadata = TssProjectMetadata(json, &metaError)
        if let metaError = metaError {
          rejecter("PERSIST_ERROR", metaError.localizedDescription, metaError)
          return
        }
        var destroyError: NSError?
        _ = TssDestroyStaged(handle, &destroyError) // best-effort; memory-only entry
        guard self?.guardJsSafeResolve(metadata, method: "persistStoredKeyshare") == true else {
          rejecter("PERSIST_ERROR", "Refusing to expose keyshare secrets to JS", nil)
          return
        }
        resolver(metadata)
      } catch {
        rejecter("PERSIST_ERROR", self?.secureStorageMessage(error) ?? "Secure storage error", error as NSError)
      }
    }
  }

  /// F15b-1 (A8): §3 superset metadata. Never share bytes.
  @objc func getKeyshareMetadataJSON(
    _ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard let raw = self?.loadKeyshareJSONFromRNES() else {
        rejecter("NO_KEYSHARE", "No keyshare found in secure storage", nil)
        return
      }
      var error: NSError?
      let metadata = TssProjectMetadata(raw, &error)
      if let error = error {
        rejecter("KEYSHARE_META_ERROR", error.localizedDescription, error)
        return
      }
      guard self?.guardJsSafeResolve(metadata, method: "getKeyshareMetadataJSON") == true else {
        rejecter("KEYSHARE_META_ERROR", "Refusing to expose keyshare secrets to JS", nil)
        return
      }
      resolver(metadata)
    }
  }

  /// F15b-1 (A9): redacted structure for the dev tree view.
  @objc func getKeyshareStructureRedacted(
    _ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard let raw = self?.loadKeyshareJSONFromRNES() else {
        rejecter("NO_KEYSHARE", "No keyshare found in secure storage", nil)
        return
      }
      var error: NSError?
      let redacted = TssRedactedStructure(raw, &error)
      if let error = error {
        rejecter("KEYSHARE_STRUCT_ERROR", error.localizedDescription, error)
        return
      }
      guard self?.guardJsSafeResolve(redacted, method: "getKeyshareStructureRedacted") == true else {
        rejecter("KEYSHARE_STRUCT_ERROR", "Refusing to expose keyshare secrets to JS", nil)
        return
      }
      resolver(redacted)
    }
  }

  /// F15b-1 (A10): wipe staged Go entries. No Keychain touch.
  @objc func destroyKeyshareHandles(
    _ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async {
      var error: NSError?
      _ = TssDestroyAllStaged(&error)
      if let error = error {
        rejecter("DESTROY_HANDLES_ERROR", error.localizedDescription, error)
        return
      }
      resolver(true)
    }
  }

  /// 3b-1 ceremony mint, per-ceremony methods ONLY. There is
  /// deliberately NO generic "request token for class X" bridge
  /// method: each entry point below hardcodes its op class and
  /// its prompt copy, so JS can neither choose the class nor
  /// spoof the action label. Transport rides the parent
  /// ceremony token (sign|keygen) — no transport mint exists.
  @objc func requestSignCeremonyToken(
    _ sessionID: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    promptAndMint(
      opClass: .sign, sessionID: sessionID,
      title: "Authenticate to sign", subtitle: "Approve the signing ceremony",
      resolver: resolver, rejecter: rejecter)
  }

  @objc func requestKeygenCeremonyToken(
    _ sessionID: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    promptAndMint(
      opClass: .keygen, sessionID: sessionID,
      title: "Authenticate to generate keys", subtitle: "Approve the wallet setup ceremony",
      resolver: resolver, rejecter: rejecter)
  }

  @objc func requestExportCeremonyToken(
    _ sessionID: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    promptAndMint(
      opClass: .export, sessionID: sessionID,
      title: "Authenticate to export backup", subtitle: "Approve the backup export",
      resolver: resolver, rejecter: rejecter)
  }

  @objc func requestImportCeremonyToken(
    _ sessionID: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    promptAndMint(
      opClass: .import, sessionID: sessionID,
      title: "Authenticate to import backup", subtitle: "Approve the backup import",
      resolver: resolver, rejecter: rejecter)
  }

  @objc func requestConfigCeremonyToken(
    _ sessionID: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    promptAndMint(
      opClass: .config, sessionID: sessionID,
      title: "Authenticate to change settings", subtitle: "Approve the network settings change",
      resolver: resolver, rejecter: rejecter)
  }

  /// Shared mint worker. PRIVATE — not a bridge method, not
  /// JS-reachable. OS-visible auth FIRST (LAContext,
  /// biometric-or-device-passcode), mint ONLY on success. No
  /// screen lock → CEREMONY_AUTH_NO_LOCK refuse (Q3). Every other
  /// failure → CEREMONY_AUTH_REQUIRED (no reason oracle).
  private func promptAndMint(
    opClass: CeremonyOpClass, sessionID: String, title: String, subtitle: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard !sessionID.isEmpty else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Confirm to continue — authenticate in the prompt.", nil)
      return
    }
    let context = LAContext()
    var evalError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &evalError) else {
      if let code = evalError?.code, code == LAError.passcodeNotSet.rawValue {
        rejecter("CEREMONY_AUTH_NO_LOCK", "Set a device screen lock to continue.", nil)
      } else {
        rejecter("CEREMONY_AUTH_REQUIRED", "Confirm to continue — authenticate in the prompt.", evalError)
      }
      return
    }
    // LAContext takes a single reason string (Android uses
    // title+subtitle); combine for parity. Copy is hardcoded
    // per ceremony above — JS supplies nothing, so the action
    // label is unspoofable (the per-transaction WHAT remains a
    // disclosed residual per §6.4; F20 owns the native screen).
    // The prompt itself is always OS-rendered.
    let reason = title + " — " + subtitle
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
      if success {
        resolver(CeremonyTokens.mint(opClass: opClass, sessionID: sessionID))
      } else {
        // User cancel, fallback, lockout, failure: never mint.
        rejecter("CEREMONY_AUTH_REQUIRED", "Confirm to continue — authenticate in the prompt.", nil)
      }
    }
  }

  /// 3b-1: retire a token after ceremony success (-> used).
  @objc func completeCeremonyToken(
    _ token: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    CeremonyTokens.complete(token: token)
    resolver(true)
  }

  /// 3b-1: revoke a token on teardown (-> revoked). Idempotent.
  @objc func releaseCeremonyToken(
    _ token: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    CeremonyTokens.release(token: token)
    resolver(true)
  }

  #if DEBUG
    /// DEBUG-ONLY prompt-bypassing mint for tests. Stripped from
    /// release by #if DEBUG (unlike Android's runtime gate;
    /// disclosed, same security property). Production code must
    /// never call this — guardrailed in jest.
    @objc func requestCeremonyTokenTest(
      _ op: String, sessionID: String,
      resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
    ) {
      guard let opClass = CeremonyOpClass.parse(op), !sessionID.isEmpty else {
        rejecter("CEREMONY_AUTH_REQUIRED", "Confirm to continue — authenticate in the prompt.", nil)
        return
      }
      resolver(CeremonyTokens.mint(opClass: opClass, sessionID: sessionID))
    }
  #endif

  /// F15b-1 migration bootstrap (§1.5 step 7): idempotent
  /// plaintext → envelope migration. Resolves {migrated:bool}.
  /// Storage failures reject with [SECURE_STORAGE_*] copy.
  @objc func ensureKeyshareEnveloped(
    _ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      do {
        let migrated = try KeyshareEnvelope.ensureEnveloped(account: RNESKeychain.keyshareAccount)
        resolver(["migrated": migrated])
      } catch {
        rejecter("MIGRATION_ERROR", self?.secureStorageMessage(error) ?? String(describing: error), error as NSError)
      }
    }
  }

  @objc func sha256(
    _ message: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssSha256(message, &error)
    resolve("sha256", output, error, resolver)
  }

  @objc func secureRandom(
    _ length: Int, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssSecureRandom(Int32(length), &error)
    resolve("secureRandom", output, error, resolver)
  }

  @objc func recoverPubkey(
    _ r: String, s: String, v: String, h: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssSecP256k1Recover(r, s, v, h, &error)
    resolve("recoverPubkey", output, error, resolver)
  }

  @objc func derivePubkey(
    _ hexPubkey: String, hexChaincode: String, path: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssGetDerivedPubKey(hexPubkey, hexChaincode, path, false, &error)
    resolve("derivePubkey", output, error, resolver)
  }

  @objc func encodeXpub(
    _ hexPubkey: String, hexChaincode: String, network: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssEncodeXpub(hexPubkey, hexChaincode, network, &error)
    resolve("encodeXpub", output, error, resolver)
  }

  @objc func getOutputDescriptor(
    _ hexPubkey: String, hexChaincode: String, network: String, addressType: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssGetOutputDescriptor(hexPubkey, hexChaincode, network, addressType, &error)
    resolve("getOutputDescriptor", output, error, resolver)
  }

  @objc func appendOutputDescriptorChecksum(
    _ descriptorBody: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssAppendOutputDescriptorChecksum(descriptorBody, &error)
    resolve("appendOutputDescriptorChecksum", output, error, resolver)
  }

  @objc func btcAddress(
    _ compressedPubkey: String, network: String, addressType: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    if addressType == "segwit-native" {
      let segwitNative = TssPubToP2WPKH(compressedPubkey, network, &error)
      resolve("btcAddress", segwitNative, error, resolver)
    } else if addressType == "segwit-compatible" {
      let segwitCompatible = TssPubToP2SHP2WKH(compressedPubkey, network, &error)
      resolve("btcAddress", segwitCompatible, error, resolver)
    } else if addressType == "taproot" {
      let taproot = TssPubToP2TR(compressedPubkey, network, &error)
      resolve("btcAddress", taproot, error, resolver)
    } else if addressType == "legacy" {
      let legacy = TssPubToP2KH(compressedPubkey, network, &error)
      resolve("btcAddress", legacy, error, resolver)
    } else {
      resolve("btcAddress", "", error, resolver)
    }
  }

  @objc func setFeePolicy(
    _ policy: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssUseFeePolicy(policy, &error)
    resolve("setFeePolicy", output, error, resolver)
  }

  /// 3b-2d B15/B16: native-held API allowlist store.
  /// UserDefaults key with NO other writer (grep-verified).
  private var apiAllowlistStore: CeremonyApiAllowlist.Store {
    CeremonyApiAllowlist.Store(
      load: {
        Set(UserDefaults.standard.stringArray(forKey: "ceremonyApiAllowlistUrls") ?? [])
      },
      save: { urls in
        UserDefaults.standard.set(Array(urls), forKey: "ceremonyApiAllowlistUrls")
      }
    )
  }

  /// 3b-2d: allowlist-or-token gate. True when the call may
  /// proceed (newly approved URLs persisted best-effort — a
  /// persist failure still applies this use since the user
  /// approved it; the next launch simply prompts again).
  private func gateApiUrls(
    _ urls: [String], token: String, sessionID: String,
    method: String, rejecter: @escaping RCTPromiseRejectBlock
  ) -> Bool {
    switch CeremonyApiAllowlist.decide(urls: urls, token: token, sessionID: sessionID, store: apiAllowlistStore) {
    case .reject:
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return false
    case .applyAndPersist:
      CeremonyApiAllowlist.persist(urls, store: apiAllowlistStore)
      return true
    case .apply:
      return true
    }
  }

  @objc func setAPI(
    _ network: String, baseAPI: String, ceremonyToken: String, ceremonySessionID: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard gateApiUrls([baseAPI], token: ceremonyToken, sessionID: ceremonySessionID, method: "setAPI", rejecter: rejecter) else {
      return
    }
    var error: NSError?
    let output = TssUseAPI(network, baseAPI, &error)
    resolve("setAPI", output, error, resolver)
  }

  @objc func setFeeAPIs(
    _ urls: String, ceremonyToken: String, ceremonySessionID: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard gateApiUrls(CeremonyApiAllowlist.parseCsv(urls), token: ceremonyToken, sessionID: ceremonySessionID, method: "setFeeAPIs", rejecter: rejecter) else {
      return
    }
    var error: NSError?
    let output = TssUseFeeAPIs(urls, &error)
    resolve("setFeeAPIs", output, error, resolver)
  }
  
  @objc func totalUTXO(
    _ address: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssTotalUTXO(address, &error)
    resolve("totalUTXO", output, error, resolver)
  }

  @objc func preparams(
    _ outFile: String, timeout: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    var success: ObjCBool = false
    let waitMinutes = Int(timeout) ?? 2
    let preParams = TssLocalPreParams(outFile, waitMinutes, &success, &error)
    if success.boolValue {
      sendLogEvent("preparams", "ok")
      resolver(preParams)
    } else {
      if let actualError = error {
        sendLogEvent("preparams", actualError.localizedDescription)
        rejecter(actualError.localizedDescription, nil, actualError)
      } else {
        sendLogEvent("preparams", "An unknown error occurred")
        rejecter("An unknown error occurred", nil, nil)
      }
    }
  }

  // F19: GG18 setup output stays plaintext in Wave 3 (protocol-
  // variant decision deferred). DKLs twins stage natively.
  @objc func mpcTssSetup(
    _ server: String, partyID: String, ppmFile: String, partiesCSV: String, sessionID: String,
    sessionKey: String, encKey: String, decKey: String, chaincode: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssJoinKeygen(
      ppmFile, partyID, partiesCSV, encKey, decKey, sessionID, server, chaincode, sessionKey, &error)
    resolve("mpcTssSetup", output, error, resolver)
  }

  @objc func nostrKeypair(
    _ ceremonyToken: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2b B20: single-call keygen ceremony (no MPC session yet).
    guard CeremonyTokens.verifySingleCall(token: ceremonyToken, opClass: .keygen) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssNostrKeypair(&error)
      self?.sendLogEvent("nostrKeypair", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func hexToNpub(
    _ hexKey: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssHexToNpub(hexKey, &error)
      self?.sendLogEvent("hexToNpub", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func dklsHelloDkg(
    _ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      let output: String
      if BbmtBridge.isAvailable() {
        output = BbmtBridge.helloDkg()
      } else {
        output =
          "DKLS: run BBMTLib/build-dkls.sh ios and link ios/BbmtMobile/libbbmtmobile.xcframework"
      }
      self?.sendLogEvent("dklsHelloDkg", output)
      resolver(output)
    }
  }

  @objc func dklsMpcTssSetup(
    _ server: String, partyID: String, partiesCSV: String, sessionID: String,
    sessionKey: String, encKey: String, decKey: String, chaincode: String,
    ceremonyToken: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2b: gate FIRST — before runtime checks.
    guard CeremonyTokens.verify(token: ceremonyToken, opClass: .keygen, sessionID: sessionID) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard BbmtBridge.isAvailable() else {
        rejecter(
          "DKLS_NATIVE_REQUIRED",
          "Run BBMTLib/build-dkls.sh ios and link libbbmtmobile.xcframework in Xcode",
          nil)
        return
      }
      let output = BbmtBridge.lanJoinKeygen(
        withKey: partyID, parties: partiesCSV, session: sessionID, server: server,
        chaincode: chaincode, sessionKey: sessionKey, encKey: encKey, decKey: decKey)
      if output.hasPrefix("error:") {
        rejecter("DKLS_MPC_SETUP_ERROR", output, nil)
        return
      }
      // F15b-1: staged shape only; never log resolve values.
      guard self?.guardStagedShape(output, method: "dklsMpcTssSetup") == true else {
        rejecter("DKLS_MPC_SETUP_ERROR", "Keyshare staging failed", nil)
        return
      }
      self?.sendLogEvent("dklsMpcTssSetup", "staged ok len=\(output.count)")
      resolver(output)
    }
  }

  @objc func dklsNostrMpcTssSetup(
    _ relaysCSV: String, partyNsec: String, partiesNpubsCSV: String, sessionID: String,
    sessionKey: String, chaincode: String, ceremonyToken: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2b: gate FIRST — before runtime checks.
    guard CeremonyTokens.verify(token: ceremonyToken, opClass: .keygen, sessionID: sessionID) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard BbmtBridge.isAvailable() else {
        rejecter(
          "DKLS_NATIVE_REQUIRED",
          "Run BBMTLib/build-dkls.sh ios and link libdklsmobile.a in Xcode",
          nil)
        return
      }
      let output = BbmtBridge.nostrJoinKeygen(
        withRelays: relaysCSV, nsec: partyNsec, peers: partiesNpubsCSV, session: sessionID,
        sessionKey: sessionKey, chaincode: chaincode)
      if output.hasPrefix("error:") {
        rejecter("DKLS_NOSTR_KEYGEN_ERROR", output, nil)
        return
      }
      // F15b-1: staged shape only; never log resolve values.
      guard self?.guardStagedShape(output, method: "dklsNostrMpcTssSetup") == true else {
        rejecter("DKLS_NOSTR_KEYGEN_ERROR", "Keyshare staging failed", nil)
        return
      }
      self?.sendLogEvent("dklsNostrMpcTssSetup", "staged ok len=\(output.count)")
      resolver(output)
    }
  }

  @objc func dklsCancelMpcSession(
    _ sessionID: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    if BbmtBridge.isAvailable() {
      BbmtBridge.cancelMpcSession(sessionID)
    }
    resolver(nil)
  }

  @objc func dklsCancelNostrMpc(
    _ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    if BbmtBridge.isAvailable() {
      BbmtBridge.cancelNostrMpc()
    }
    resolver(nil)
  }

  @objc func dklsMpcSignPSBT(
    _ server: String, partyID: String, partiesCSV: String, sessionID: String,
    sessionKey: String, encKey: String, decKey: String, psbtBase64: String,
    ceremonyToken: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2a: gate FIRST — before runtime checks or storage reads.
    guard CeremonyTokens.verify(token: ceremonyToken, opClass: .sign, sessionID: sessionID) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard BbmtBridge.isAvailable() else {
        rejecter("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh ios", nil)
        return
      }
      guard let keyshare = self?.loadKeyshareJSONFromRNES() else {
        rejecter("NO_KEYSHARE", "No keyshare found in secure storage", nil)
        return
      }
      let output = BbmtBridge.mpcSignPsbt(
        withServer: server, key: partyID, parties: partiesCSV, session: sessionID,
        sessionKey: sessionKey, encKey: encKey, decKey: decKey, keyshare: keyshare,
        psbt: psbtBase64)
      if output.hasPrefix("error:") {
        rejecter("DKLS_PSBT_LAN", output, nil)
        return
      }
      resolver(output)
    }
  }

  @objc func dklsMpcSendBTCWithUTXOs(
    _ server: String, partyID: String, partiesCSV: String, sessionID: String,
    sessionKey: String, encKey: String, decKey: String, btcPub: String,
    toAddress: String, satoshiAmount: String, satoshiFees: String,
    utxosWithPathsJSON: String, changeAddress: String, ceremonyToken: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2a: gate FIRST — before runtime checks or storage reads.
    guard CeremonyTokens.verify(token: ceremonyToken, opClass: .sign, sessionID: sessionID) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard BbmtBridge.isAvailable() else {
        rejecter("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh ios", nil)
        return
      }
      guard let keyshare = self?.loadKeyshareJSONFromRNES() else {
        rejecter("NO_KEYSHARE", "No keyshare found in secure storage", nil)
        return
      }
      let output = BbmtBridge.mpcSendBtc(
        withServer: server, key: partyID, parties: partiesCSV, session: sessionID,
        sessionKey: sessionKey, encKey: encKey, decKey: decKey, keyshare: keyshare,
        btcPub: btcPub, toAddress: toAddress, amount: satoshiAmount, fees: satoshiFees,
        utxos: utxosWithPathsJSON, change: changeAddress)
      if output.hasPrefix("error:") {
        rejecter("DKLS_SEND_LAN", output, nil)
        return
      }
      resolver(output)
    }
  }

  @objc func dklsNostrMpcSendBTC(
    _ relaysCSV: String, partiesNpubsCSV: String, npubsSorted: String,
    balanceSats: String, toAddress: String, satoshiAmount: String,
    satoshiFees: String, utxosWithPathsJSON: String, changeAddress: String,
    ceremonyToken: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2a: gate FIRST — single-call ceremony, no MPC session.
    guard CeremonyTokens.verifySingleCall(token: ceremonyToken, opClass: .sign) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard BbmtBridge.isAvailable() else {
        rejecter("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh ios", nil)
        return
      }
      do {
        let (partyNsec, keyshareJSON) = try self?.nsecAndKeyshareJSONFromRNES()
          ?? ("", "")
        let output = BbmtBridge.nostrMpcSendBtc(
          withRelays: relaysCSV, nsec: partyNsec, parties: partiesNpubsCSV,
          npubsSorted: npubsSorted, balance: balanceSats, keyshare: keyshareJSON,
          toAddress: toAddress, amount: satoshiAmount, fees: satoshiFees,
          utxos: utxosWithPathsJSON, change: changeAddress)
        if output.hasPrefix("error:") {
          rejecter("DKLS_SEND_NOSTR", output, nil)
          return
        }
        resolver(output)
      } catch {
        rejecter("DKLS_SEND_NOSTR", error.localizedDescription, error)
      }
    }
  }

  @objc func dklsNostrMpcSignPSBT(
    _ relaysCSV: String, partiesNpubsCSV: String, npubsSorted: String,
    psbtBase64: String, ceremonyToken: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    // 3b-2a: gate FIRST — single-call ceremony, no MPC session.
    guard CeremonyTokens.verifySingleCall(token: ceremonyToken, opClass: .sign) else {
      rejecter("CEREMONY_AUTH_REQUIRED", "Ceremony authorization required for this call", nil)
      return
    }
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard BbmtBridge.isAvailable() else {
        rejecter("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh ios", nil)
        return
      }
      do {
        let (partyNsec, keyshareJSON) = try self?.nsecAndKeyshareJSONFromRNES()
          ?? ("", "")
        let output = BbmtBridge.nostrMpcSignPsbt(
          withRelays: relaysCSV, nsec: partyNsec, parties: partiesNpubsCSV,
          npubsSorted: npubsSorted, keyshare: keyshareJSON, psbt: psbtBase64)
        if output.hasPrefix("error:") {
          rejecter("DKLS_PSBT_NOSTR", output, nil)
          return
        }
        resolver(output)
      } catch {
        rejecter("DKLS_PSBT_NOSTR", error.localizedDescription, error)
      }
    }
  }

  // F19: GG18 setup output stays plaintext in Wave 3 (protocol-
  // variant decision deferred). DKLs twins stage natively.
  @objc func nostrMpcTssSetup(
    _ relaysCSV: String, partyNsec: String, partiesNpubsCSV: String, sessionID: String,
    sessionKey: String, chaincode: String, ppmFile: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssNostrJoinKeygen(
        relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, chaincode, ppmFile, &error)
      self?.sendLogEvent("nostrMpcTssSetup", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func nostrJoinKeysign(
    _ relaysCSV: String, partyNsec: String, partiesNpubsCSV: String, sessionID: String,
    sessionKey: String, keyshareJSON: String, derivationPath: String, message: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard let self = self else {
        resolver("")
        return
      }
      var error: NSError?
      let output = TssNostrJoinKeysign(
        relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON,
        derivationPath, message, &error)
      self.sendLogEvent("nostrJoinKeysign", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func postTx(
    _ rawTxHex: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let txid = TssPostTx(rawTxHex, &error)
      if error == nil {
        self?.sendLogEvent("postTx", txid)
        resolver(txid)
      } else {
        rejecter("POST_TX_ERROR", error!.localizedDescription, error)
      }
    }
  }

  @objc func computeTxId(
    _ rawTxHex: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let txid = TssComputeTxId(rawTxHex, &error)
    if error == nil {
      resolver(txid)
    } else {
      rejecter("COMPUTE_TXID_ERROR", error!.localizedDescription, error)
    }
  }

  @objc func cancelMpcSession(
    _ sessionID: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async {
      guard BbmtBridge.isAvailable() else {
        rejecter("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh ios", nil)
        return
      }
      var error: NSError?
      let output = TssCancelMpcSession(sessionID, &error)
      if error == nil {
        resolver(output)
      } else {
        rejecter("CANCEL_MPC_ERROR", error!.localizedDescription, error)
      }
    }
  }

  @objc func cancelNostrMpc(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async {
      guard BbmtBridge.isAvailable() else {
        rejecter("DKLS_NATIVE_REQUIRED", "Run BBMTLib/build-dkls.sh ios", nil)
        return
      }
      var error: NSError?
      let output = TssCancelNostrMpc(&error)
      if error == nil {
        resolver(output)
      } else {
        rejecter("CANCEL_NOSTR_MPC_ERROR", error!.localizedDescription, error)
      }
    }
  }

  @objc func disableLogging(
    _ tag: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    useLog = false
    TssDisableLogs()
    resolver(tag)
  }

  @objc func parsePSBTDetails(
    _ psbtBase64: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssParsePSBTDetails(psbtBase64, &error)
      self?.sendLogEvent("parsePSBTDetails", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func psbtIdentityHash(
    _ psbtBase64: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssPsbtIdentityHash(psbtBase64, &error)
      let preview = output.count > 16 ? String(output.prefix(16)) + "…" : output
      self?.sendLogEvent("psbtIdentityHash", preview)
      if let error = error {
        rejecter("PSBT_IDENTITY_ERROR", error.localizedDescription, error)
      } else {
        resolver(output)
      }
    }
  }

  // MARK: - Stored keyshare (read from RNES-compatible storage; no keyshare string from JS bridge)

  @objc func mpcSignPSBT(
    _ server: String,
    partyID: String,
    partiesCSV: String,
    sessionID: String,
    sessionKey: String,
    encKey: String,
    decKey: String,
    psbtBase64: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard let self = self else {
        rejecter("MODULE_GONE", "Native module released", nil)
        return
      }
      guard let keyshare = self.loadKeyshareJSONFromRNES() else {
        rejecter("NO_KEYSHARE", "No keyshare found in secure storage", nil)
        return
      }
      var error: NSError?
      let output = TssMpcSignPSBT(
        server,
        partyID,
        partiesCSV,
        sessionID,
        sessionKey,
        encKey,
        decKey,
        keyshare,
        psbtBase64, &error)
      self.sendLogEvent("mpcSignPSBT", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func mpcSendBTCWithUTXOs(
    _ server: String,
    partyID: String,
    partiesCSV: String,
    sessionID: String,
    sessionKey: String,
    encKey: String,
    decKey: String,
    publicKey: String,
    receiverAddress: String,
    amountSatoshi: String,
    feeSatoshi: String,
    utxosWithPathsJSON: String,
    changeAddress: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard let self = self else {
        rejecter("MODULE_GONE", "Native module released", nil)
        return
      }
      guard let keyshare = self.loadKeyshareJSONFromRNES() else {
        rejecter("NO_KEYSHARE", "No keyshare found in secure storage", nil)
        return
      }
      var error: NSError?
      let output = TssMpcSendBTCWithUTXOs(
        server,
        partyID,
        partiesCSV,
        sessionID,
        sessionKey,
        encKey,
        decKey,
        keyshare,
        publicKey,
        receiverAddress,
        amountSatoshi,
        feeSatoshi,
        utxosWithPathsJSON,
        changeAddress, &error)
      self.sendLogEvent("mpcSendBTCWithUTXOs", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func nostrMpcSendBTC(
    _ relaysCSV: String,
    partiesNpubsCSV: String,
    npubsSorted: String,
    balanceSats: String,
    receiverAddress: String,
    amountSatoshi: String,
    estimatedFee: String,
    utxosWithPathsJSON: String,
    changeAddress: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard let self = self else {
        rejecter("MODULE_GONE", "Native module released", nil)
        return
      }
      let partyNsec: String
      let keyshareJSON: String
      do {
        (partyNsec, keyshareJSON) = try self.nsecAndKeyshareJSONFromRNES()
      } catch {
        let ns = error as NSError
        if ns.domain == "BBMTLibNativeModule"
          && (ns.code == 1 || ns.code == 6)
        {
          rejecter("NO_KEYSHARE", ns.localizedDescription, ns)
        } else {
          rejecter("NO_NSEC", ns.localizedDescription, ns)
        }
        return
      }
      var error: NSError?
      let output = TssNostrMpcSendBTCWithUTXOs(
        relaysCSV,
        partyNsec,
        partiesNpubsCSV,
        npubsSorted,
        balanceSats,
        keyshareJSON,
        receiverAddress,
        amountSatoshi,
        estimatedFee,
        utxosWithPathsJSON,
        changeAddress, &error)
      self.sendLogEvent("nostrMpcSendBTC", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func nostrMpcSignPSBT(
    _ relaysCSV: String, partiesNpubsCSV: String, npubsSorted: String,
    psbtBase64: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard let self = self else {
        rejecter("MODULE_GONE", "Native module released", nil)
        return
      }
      let partyNsec: String
      let keyshareJSON: String
      do {
        (partyNsec, keyshareJSON) = try self.nsecAndKeyshareJSONFromRNES()
      } catch {
        let ns = error as NSError
        if ns.domain == "BBMTLibNativeModule"
          && (ns.code == 1 || ns.code == 6)
        {
          rejecter("NO_KEYSHARE", ns.localizedDescription, ns)
        } else {
          rejecter("NO_NSEC", ns.localizedDescription, ns)
        }
        return
      }
      var error: NSError?
      let output = TssNostrMpcSignPSBT(
        relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, keyshareJSON, psbtBase64, &error)
      self.sendLogEvent("nostrMpcSignPSBT", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  // (aesEncryptStoredKeyshare removed here — see note at aesEncrypt.)
  /// F1: versioned backup export. Password goes to Go (Argon2id + AES-GCM);
  /// JS never sees a derived key. Emits v2 format only.
  @objc func backupEncryptStoredKeyshare(
    _ password: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard let self = self else {
        rejecter("MODULE_GONE", "Native module released", nil)
        return
      }
      guard let data = self.loadKeyshareJSONFromRNES() else {
        rejecter("NO_KEYSHARE", "No keyshare found in secure storage", nil)
        return
      }
      var error: NSError?
      let output = TssBackupEncrypt(data, password, &error)
      if let error = error {
        rejecter("BACKUP_ENCRYPT_ERROR", error.localizedDescription, error)
      } else {
        resolver(output)
      }
    }
  }

  /// Reads keyshare from RNES storage in native, parses JSON, returns a **minimal** object (only
  /// fields needed for Nostr UI / session prep). The full MPC blob is never passed to JS.
  @objc func hasKeyshareInSecureStorage(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      resolve(self?.keyshareExistsInRNES() ?? false)
    }
  }

  @objc func getKeyshareNostrPrepJSON(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else {
        rejecter("MODULE_GONE", "Native module released", nil)
        return
      }
      guard let raw = self.loadKeyshareJSONFromRNES() else {
        rejecter("NO_KEYSHARE", "No keyshare found in secure storage", nil)
        return
      }
      guard let data = raw.data(using: .utf8),
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else {
        rejecter("PARSE_ERROR", "Invalid keyshare JSON", nil)
        return
      }
      let keys = [
        "pub_key", "chain_code_hex", "keygen_committee_keys", "local_party_key", "nostr_npub",
      ]
      var out: [String: Any] = [:]
      for k in keys {
        if let v = obj[k] { out[k] = v }
      }
      guard let outData = try? JSONSerialization.data(withJSONObject: out),
        let outStr = String(data: outData, encoding: .utf8)
      else {
        rejecter("BUILD_ERROR", "Could not build keyshare prep JSON", nil)
        return
      }
      resolve(outStr)
    }
  }

  /// Returns device entropy source metadata as a JSON string.
  /// Always resolves (never rejects) — assessment is informational, not gating.
  @objc func getDeviceEntropyMetadata(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let device = UIDevice.current
    let processInfo = ProcessInfo.processInfo

    let platform = "ios"
    let osVersion = "\(device.systemName) \(device.systemVersion)"
    let deviceModel = Self.deviceModelIdentifier()

    // On iOS, the CSPRNG is SecRandomCopyBytes backed by the kernel CSPRNG
    // which draws from /dev/random (entropy pool fed by hardware + timing jitter).
    let cryptoFramework = "Apple Security Framework (SecRandomCopyBytes)"
    let rngSource = "SecRandomCopyBytes → kernel CSPRNG (/dev/random)"

    // Secure Enclave availability
    let hwRng: String
    #if targetEnvironment(simulator)
    hwRng = "Secure Enclave (unavailable — simulator)"
    #else
    // Check if we can access the Secure Enclave for key operations
    let hasSE: Bool = {
      let query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecAttrKeySizeInBits as String: 256,
        kSecReturnRef as String: false,
      ]
      // Don't actually create a key — just check if the attribute is accepted
      return SecItemCopyMatching(query as CFDictionary, nil) != errSecParam
    }()
    hwRng = hasSE ? "Secure Enclave (available)" : "Secure Enclave (unavailable)"
    #endif

    // Entropy pool health — on iOS the kernel CSPRNG doesn't expose entropy_avail
    // in a userspace-readable way, but the CSPRNG is continuously reseeded and
    // SecRandomCopyBytes blocks until sufficient entropy is available.
    let entropyPoolHealth = "Kernel CSPRNG — continuously reseeded (no userspace counter)"

    // Simulator has no hardware entropy source; real devices with SE are always Strong.
    #if targetEnvironment(simulator)
    let rngAssessment = "Weak"
    #else
    let rngAssessment = hasSE ? "Strong" : "Weak"
    #endif

    let metadata: [String: Any] = [
      "platform": platform,
      "os_version": osVersion,
      "device_model": deviceModel,
      "crypto_framework": cryptoFramework,
      "rng_source": rngSource,
      "hardware_rng": hwRng,
      "entropy_pool_health": entropyPoolHealth,
      "rng_assessment": rngAssessment,
    ]

    do {
      let jsonData = try JSONSerialization.data(withJSONObject: metadata, options: [])
      if let jsonStr = String(data: jsonData, encoding: .utf8) {
        sendLogEvent("getDeviceEntropyMetadata", "resolved rng_assessment=\(rngAssessment)")
        resolve(jsonStr)
      } else {
        reject("ENCODE_ERROR", "Failed to encode entropy metadata as UTF-8", nil)
      }
    } catch {
      reject("SERIALIZE_ERROR", "Failed to serialize entropy metadata: \(error.localizedDescription)", error)
    }
  }

  /// Returns the device model identifier (e.g. "iPhone15,2") in a privacy-safe manner.
  private static func deviceModelIdentifier() -> String {
    var sysInfo = utsname()
    uname(&sysInfo)
    let mirror = Mirror(reflecting: sysInfo.machine)
    let identifier = mirror.children.reduce("") { id, child in
      guard let value = child.value as? Int8, value != 0 else { return id }
      return id + String(UnicodeScalar(UInt8(value)))
    }
    return identifier.isEmpty ? "unknown" : identifier
  }

  @objc override func startObserving() {
    TssSetHookListener(self)
    TssSetEventListener(self)
  }

  @objc override func stopObserving() {
    TssSetEventListener(nil)
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }
}
