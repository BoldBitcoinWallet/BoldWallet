//
//  BBMTLibNativeModule.swift
//  Bold Bitcoin MPC TSS Lib
//
//  Created on 30/11/2024.
//
import Darwin
import Foundation
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
  private func withZeroedUTF8Keyshare<T>(_ keyshareFromBridge: String, _ work: (String) -> T) -> T {
    var bytes = ContiguousArray(keyshareFromBridge.utf8)
    defer {
      bytes.withUnsafeMutableBufferPointer { buf in
        if let base = buf.baseAddress, buf.count > 0 {
          memset(base, 0, buf.count)
        }
      }
    }
    let ephemeral = String(bytes: bytes, encoding: .utf8) ?? keyshareFromBridge
    return autoreleasepool {
      work(ephemeral)
    }
  }

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

  /// Debug: summary line (lengths / types). Full JSON is logged separately as `raw_json=`.
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

  /// One Keychain read: parsed Nostr `nsec` for Tss + same raw keyshare JSON string for `withZeroedUTF8Keyshare`.
  private func nsecAndKeyshareJSONFromRNES() throws -> (partyNsec: String, keyshareJSON: String) {
    guard let raw = loadKeyshareJSONFromRNES() else {
      sendLogEvent("nsecFromKeyshare", "FAIL: no_keychain_blob account=keyshare")
      throw NSError(
        domain: "BBMTLibNativeModule", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "No keyshare found in secure storage"])
    }
    sendLogEvent("nsecFromKeyshare", "raw_json=\(raw)")
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
          "FAIL: json_parse and no regex nsec rawLen=\(rawLen) err=\(errDesc) raw_json=\(raw)")
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

  /// Read keyshare from the same Keychain layout as `RNEncryptedStorage` iOS implementation.
  private func loadKeyshareJSONFromRNES() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: RNESKeychain.keyshareAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var dataRef: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &dataRef)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { return nil }
    guard let ref = dataRef else { return nil }
    // Do not call CFRelease: SecItemCopyMatching result is bridged to Data and ARC-managed.
    guard let data = ref as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  @objc func publishData(
    _ port: String, timeout: String, encKey: String, raw: String, mode: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
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
    _ url: String, decKey: String, payload: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
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
    _ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssGenerateKeyPair(&error)
    resolve("eciesKeypair", output, error, resolver)
  }

  @objc func aesEncrypt(
    _ data: String, key: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssAesEncrypt(data, key, &error)
    resolve("aesEncrypt", output, error, resolver)
  }

  @objc func aesDecrypt(
    _ data: String, key: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssAesDecrypt(data, key, &error)
    resolve("aesDecrypt", output, error, resolver)
  }

  @objc func sha256(
    _ message: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssSha256(message, &error)
    resolve("sha256", output, error, resolver)
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

  @objc func setAPI(
    _ network: String, baseAPI: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssUseAPI(network, baseAPI, &error)
    resolve("setAPI", output, error, resolver)
  }

  @objc func setFeeAPIs(
    _ urls: String, resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
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
    _ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
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
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
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
      self?.sendLogEvent("dklsMpcTssSetup", String(output.prefix(120)))
      resolver(output)
    }
  }

  @objc func dklsNostrMpcTssSetup(
    _ relaysCSV: String, partyNsec: String, partiesNpubsCSV: String, sessionID: String,
    sessionKey: String, chaincode: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
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
      self?.sendLogEvent("dklsNostrMpcTssSetup", String(output.prefix(120)))
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
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
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
    utxosWithPathsJSON: String, changeAddress: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
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
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
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
    psbtBase64: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
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
      let output = self.withZeroedUTF8Keyshare(keyshareJSON) { ks in
        TssNostrJoinKeysign(
          relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, ks,
          derivationPath, message, &error)
      }
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
      let output = self.withZeroedUTF8Keyshare(keyshare) { ks in
        TssMpcSignPSBT(
          server,
          partyID,
          partiesCSV,
          sessionID,
          sessionKey,
          encKey,
          decKey,
          ks,
          psbtBase64, &error)
      }
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
      let output = self.withZeroedUTF8Keyshare(keyshare) { ks in
        TssMpcSendBTCWithUTXOs(
          server,
          partyID,
          partiesCSV,
          sessionID,
          sessionKey,
          encKey,
          decKey,
          ks,
          publicKey,
          receiverAddress,
          amountSatoshi,
          feeSatoshi,
          utxosWithPathsJSON,
          changeAddress, &error)
      }
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
      let output = self.withZeroedUTF8Keyshare(keyshareJSON) { ks in
        TssNostrMpcSendBTCWithUTXOs(
          relaysCSV,
          partyNsec,
          partiesNpubsCSV,
          npubsSorted,
          balanceSats,
          ks,
          receiverAddress,
          amountSatoshi,
          estimatedFee,
          utxosWithPathsJSON,
          changeAddress, &error)
      }
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
      let output = self.withZeroedUTF8Keyshare(keyshareJSON) { ks in
        TssNostrMpcSignPSBT(
          relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, ks, psbtBase64, &error)
      }
      self.sendLogEvent("nostrMpcSignPSBT", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func aesEncryptStoredKeyshare(
    _ key: String,
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
      let output = self.withZeroedUTF8Keyshare(data) { ks in
        TssAesEncrypt(ks, key, &error)
      }
      self.sendLogEvent("aesEncryptStoredKeyshare", output)
      if error == nil {
        resolver(output)
      } else {
        resolver(error!.localizedDescription)
      }
    }
  }

  /// Reads keyshare from RNES storage in native, parses JSON, returns a **minimal** object (only
  /// fields needed for Nostr UI / session prep). The full MPC blob is never passed to JS.
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
