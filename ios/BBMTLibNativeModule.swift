//
//  BBMTLibNativeModule.swift
//  Bold Bitcoin MPC TSS Lib
//
//  Created on 30/11/2024.
//
import Foundation
import React
import Tss
import SystemConfiguration.CaptiveNetwork
import Network

@objc(BBMTLibNativeModule)
class BBMTLibNativeModule: RCTEventEmitter {
  
  var useLog: Bool = true
  
  override func supportedEvents() -> [String] {
    return ["BBMT_LIB_IOS"]
  }
  
  private func resolve(_ tag: String, _ output: String, _ error: NSError?, _ resolver: @escaping RCTPromiseResolveBlock) {
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
      print(tag + ": " + message);
      sendEvent(withName: "BBMT_LIB_IOS", body: params)
    }
  }
  
  @objc func publishData(_ port: String, timeout: String, encKey: String, raw: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard self != nil else { return }
      var error: NSError?
      let output = TssPublishData(port, timeout, encKey, raw, &error)
      self?.resolve("publishData", output, error, resolver)
    }
  }
  
  @objc func fetchData(_ url: String, decKey: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    var error: NSError?
    let output = TssFetchData(url, decKey, &error)
    resolve("fetchData", output, error, resolver)
  }
  
  @objc func setBtcNetwork(_ network: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard self != nil else { return }
      var error: NSError?
      TssSetNetwork(network, &error)
      let output = TssGetNetwork(&error)
      self?.resolve("setBtcNetwork", output, error, resolver)
    }
  }
  
  @objc func estimateFee(
    _ senderAddress: String,
    receiverAddress: String,
    amountSatoshi: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock) {
      DispatchQueue.global(qos: .background).async { [weak self] in
        guard self != nil else { return }
        var error: NSError?
        let preview = 1
        let wif = ""
        let publicKey = "123456789012345678901234567890123"
        let output = TssSendBitcoin(wif, publicKey,
                                    senderAddress,
                                    receiverAddress,
                                    Int64(preview),
                                    Int64(amountSatoshi) ?? 0, &error)
        self?.resolve("estimateFee", output, error, resolver)
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
    rejecter: @escaping RCTPromiseRejectBlock) {
      DispatchQueue.global(qos: .background).async { [weak self] in
        guard self != nil else { return }
        var error: NSError?
        let output = TssMpcSendBTC(server,
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
        self?.resolve("mpcSendBTC", output, error, resolver)
      }
    }
  
  @objc func runRelay(_ port: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard self != nil else { return }
      var error: NSError?
      let output = TssRunRelay(port, &error)
      self?.resolve("runRelay", output, error, resolver)
    }
  }
  
  @objc func stopRelay(_ tag: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    var error: NSError?
    let output = TssStopRelay(&error)
    resolve("stopRelay", output, error, resolver)
  }
  
  @objc func listenForPeer(_ id: String, pubkey: String, port: String, timeout: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard self != nil else { return }
      var error: NSError?
      let output = TssListenForPeer(id, pubkey, port, timeout, &error)
      self?.resolve("listenForPeer", output, error, resolver)
    }
  }
  
  @objc func discoverPeer(_ id: String, pubkey: String, localIp: String, port: String, timeout: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .background).async { [weak self] in
      guard self != nil else { return }
      var error: NSError?
      let output = TssDiscoverPeer(id, pubkey, localIp, port, timeout, &error)
      if error == nil {
        self?.sendLogEvent("discoverPeer", output)
        resolver(output)
      } else {
        self?.sendLogEvent("discoverPeer", error!.localizedDescription)
        resolver("")
      }
    }
  }
  
  @objc func getLanIp(_ tag: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    var address: String?
    var classCAddress: String? // Variable to store Class C IP if found
    var ifaddr: UnsafeMutablePointer<ifaddrs>? = nil
    
    if getifaddrs(&ifaddr) == 0 {
      var ptr = ifaddr
      while ptr != nil {
        defer { ptr = ptr?.pointee.ifa_next }
        guard let interface = ptr?.pointee else { continue }
        let addrFamily = interface.ifa_addr.pointee.sa_family
        if addrFamily == UInt8(AF_INET) || addrFamily == UInt8(AF_INET6),
           let name = interface.ifa_name {
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
              if isClassC(ipAddress) {
                classCAddress = ipAddress
              } else if address == nil {
                address = ipAddress
              }
            }
          }
        }
      }
      freeifaddrs(ifaddr)
    }
    if let classC = classCAddress {
      sendLogEvent("getLanIp", classC)
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
  
  @objc func eciesKeypair(_ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    var error: NSError?
    let output = TssGenerateKeyPair(&error)
    resolve("eciesKeypair", output, error, resolver)
  }
  
  @objc func aesEncrypt(_ data: String, key: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    var error: NSError?
    let output = TssAesEncrypt(data, key, &error)
    resolve("aesEncrypt", output, error, resolver)
  }
  
  @objc func aesDecrypt(_ data: String, key: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    var error: NSError?
    let output = TssAesDecrypt(data, key, &error)
    resolve("aesDecrypt", output, error, resolver)
  }
  
  @objc func sha256(_ message: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    var error: NSError?
    let output = TssSha256(message, &error)
    resolve("sha256", output, error, resolver)
  }
  
  @objc func recoverPubkey(_ r: String, s: String, v: String, h: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    var error: NSError?
    let output = TssSecP256k1Recover(r, s, v, h, &error)
    resolve("recoverPubkey", output, error, resolver)
  }
  
  @objc func derivePubkey(_ hexPubkey: String, hexChaincode: String, path: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    var error: NSError?
    let output = TssGetDerivedPubKey(hexPubkey, hexChaincode, path, false, &error)
    resolve("derivePubkey", output, error, resolver)
  }
  
  @objc func p2khAddress(_ compressedPubkey: String, network: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    var error: NSError?
    let output = TssConvertPubKeyToBTCAddress(compressedPubkey, network, &error)
    resolve("p2khAddress", output, error, resolver)
  }
  
  @objc func preparams(_ outFile: String, timeout: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
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
  
  @objc func mpcTssSetup(_ server: String, partyID: String, ppmFile: String, partiesCSV: String, sessionID: String, sessionKey: String, encKey: String, decKey: String, chaincode: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    var error: NSError?
    let output = TssJoinKeygen(ppmFile, partyID, partiesCSV, encKey, decKey, sessionID, server, chaincode, "",  &error)
    resolve("mpcTssSetup", output, error, resolver)
  }
  
  @objc func disableLogging(_ tag: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock
  ) {
    useLog = false
    TssDisableLogs()
    resolver(tag)
  }
  
  @objc override func startObserving() {
  }
  
  @objc override func stopObserving() {

  }
  
  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }
}
