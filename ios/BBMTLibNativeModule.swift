//
//  BBMTLibNativeModule.swift
//  Bold Bitcoin MPC TSS Lib
//
//  Created on 30/11/2024.
//
import Foundation
import Network
import React
import SystemConfiguration.CaptiveNetwork
import Tss

@objc(BBMTLibNativeModule)
class BBMTLibNativeModule: RCTEventEmitter, TssGoLogListenerProtocol, TssHookListenerProtocol {

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

  @objc func mpcSendBTC(
    /* tss */
    _ server: String,
    partyID: String,
    partiesCSV: String,
    sessionID: String,
    sessionKey: String,
    encKey: String,
    decKey: String,
    keyshare: String,
    derivation: String,
    /* btc */
    publicKey: String,
    senderAddress: String,
    receiverAddress: String,
    amountSatoshi: String,
    feeSatoshi: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssMpcSendBTC(
        server,
        partyID,
        partiesCSV,
        sessionID,
        sessionKey,
        encKey,
        decKey,
        keyshare,
        derivation,
        publicKey,
        senderAddress,
        receiverAddress,
        Int64(amountSatoshi) ?? 0,
        Int64(feeSatoshi) ?? 0, &error)
      self?.sendLogEvent("mpcSendBTC", output)
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
    keyshare: String,
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
      self?.sendLogEvent("mpcSendBTCWithUTXOs", output)
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
      var error: NSError?
      let output = TssNostrJoinKeysign(
        relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON,
        derivationPath, message, &error)
      self?.sendLogEvent("nostrJoinKeysign", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func nostrMpcSendBTC(
    _ relaysCSV: String, partyNsec: String, partiesNpubsCSV: String, npubsSorted: String,
    balanceSats: String, keyshareJSON: String, derivePath: String, publicKey: String,
    senderAddress: String, receiverAddress: String, amountSatoshi: String, estimatedFee: String,
    changeAddress: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssNostrMpcSendBTC(
        relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, balanceSats, keyshareJSON, derivePath,
        publicKey, senderAddress, receiverAddress, Int64(amountSatoshi) ?? 0,
        Int64(estimatedFee) ?? 0, changeAddress, &error)
      self?.sendLogEvent("nostrMpcSendBTC", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func nostrMpcSendBTCWithUTXOs(
    _ relaysCSV: String,
    partyNsec: String,
    partiesNpubsCSV: String,
    npubsSorted: String,
    balanceSats: String,
    keyshareJSON: String,
    receiverAddress: String,
    amountSatoshi: String,
    estimatedFee: String,
    utxosWithPathsJSON: String,
    changeAddress: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
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
      self?.sendLogEvent("nostrMpcSendBTCWithUTXOs", output)
      resolver(error == nil ? output : error!.localizedDescription)
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

  @objc func mpcSignPSBT(
    /* tss */
    _ server: String,
    partyID: String,
    partiesCSV: String,
    sessionID: String,
    sessionKey: String,
    encKey: String,
    decKey: String,
    keyshare: String,
    /* psbt */
    psbtBase64: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
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
      self?.sendLogEvent("mpcSignPSBT", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
  }

  @objc func nostrMpcSignPSBT(
    _ relaysCSV: String, partyNsec: String, partiesNpubsCSV: String, npubsSorted: String,
    keyshareJSON: String, psbtBase64: String,
    resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      var error: NSError?
      let output = TssNostrMpcSignPSBT(
        relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, keyshareJSON, psbtBase64, &error)
      self?.sendLogEvent("nostrMpcSignPSBT", output)
      resolver(error == nil ? output : error!.localizedDescription)
    }
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
