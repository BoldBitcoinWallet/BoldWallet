import Foundation

/// Drop-in replacements for gomobile Tss.* calls (backed by unified libbbmtmobile).
private func bbmtResolve(_ result: String, _ error: NSErrorPointer) -> String {
  if result.hasPrefix("error:") {
    let msg = String(result.dropFirst(6))
    error?.pointee = NSError(domain: "BBMT", code: 1, userInfo: [NSLocalizedDescriptionKey: msg])
    return ""
  }
  return result
}


func TssPublishData(_ port: String, _ timeout: String, _ enckey: String, _ data: String, _ mode: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.publishData(port, timeout: timeout, enckey: enckey, data: data, mode: mode), error)
}

func TssFetchData(_ url: String, _ decKey: String, _ data: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.fetchData(url, decKey: decKey, data: data), error)
}

func TssSetNetwork(_ network: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.setNetwork(network), error)
}

func TssGetNetwork(_ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.getNetwork(), error)
}

func TssRunRelay(_ port: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.runRelay(port), error)
}

func TssStopRelay(_ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.stopRelay(), error)
}

func TssGenerateKeyPair(_ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.generateKeyPair(), error)
}

func TssAesEncrypt(_ data: String, _ key: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.aesEncrypt(data, key: key), error)
}

func TssAesDecrypt(_ data: String, _ key: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.aesDecrypt(data, key: key), error)
}

func TssSha256(_ message: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.sha256(message), error)
}

func TssUseFeePolicy(_ policy: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.useFeePolicy(policy), error)
}

func TssUseAPI(_ network: String, _ base: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.useAPI(network, base: base), error)
}

func TssUseFeeAPIs(_ urls: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.useFeeAPIs(urls), error)
}

func TssTotalUTXO(_ address: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.totalUTXO(address), error)
}

func TssNostrKeypair(_ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.nostrKeypair(), error)
}

func TssHexToNpub(_ hexKey: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.hex(toNpub: hexKey), error)
}

func TssPostTx(_ rawTxHex: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.postTx(rawTxHex), error)
}

func TssComputeTxId(_ rawTxHex: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.computeTxId(rawTxHex), error)
}

func TssCancelMpcSession(_ sessionID: String, _ error: NSErrorPointer) -> String {
  BbmtBridge.cancelMpcSession(sessionID)
  return bbmtResolve("ok", error)
}

func TssCancelNostrMpc(_ error: NSErrorPointer) -> String {
  BbmtBridge.cancelNostrMpc()
  return bbmtResolve("ok", error)
}

func TssParsePSBTDetails(_ psbtBase64: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.parsePSBTDetails(psbtBase64), error)
}


func TssSpendingHash(_ senderAddress: String, _ receiverAddress: String, _ amountSatoshi: Int64, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.spendingHash(senderAddress, receiver: receiverAddress, amount: amountSatoshi), error)
}
func TssEstimateFees(_ senderAddress: String, _ receiverAddress: String, _ amountSatoshi: Int64, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.estimateFees(senderAddress, receiver: receiverAddress, amount: amountSatoshi), error)
}
func TssSpendingHashWithUTXOs(_ utxosWithPathsJSON: String, _ receiverAddress: String, _ amountSatoshiStr: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.spendingHash(withUTXOs: utxosWithPathsJSON, receiver: receiverAddress, amount: amountSatoshiStr), error)
}
func TssEstimateFeeWithUTXOs(_ utxosWithPathsJSON: String, _ receiverAddress: String, _ amountSatoshiStr: String, _ changeAddress: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.estimateFee(withUTXOs: utxosWithPathsJSON, receiver: receiverAddress, amount: amountSatoshiStr, change: changeAddress), error)
}
func TssListenForPeers(_ id: String, _ pubkey: String, _ port: String, _ timeout: String, _ mode: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.listen(forPeers: id, pubkey: pubkey, port: port, timeout: timeout, mode: mode), error)
}
func TssDiscoverPeers(_ id: String, _ pubkey: String, _ localIP: String, _ remoteIPsCSV: String, _ port: String, _ timeout: String, _ mode: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.discoverPeers(id, pubkey: pubkey, localIP: localIP, remoteIPs: remoteIPsCSV, port: port, timeout: timeout, mode: mode), error)
}
func TssSecP256k1Recover(_ r: String, _ s: String, _ v: String, _ h: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.secP256k1RecoverR(r, s: s, v: v, h: h), error)
}
func TssGetDerivedPubKey(_ hexPubKey: String, _ hexChainCode: String, _ path: String, _ isEdDSA: Bool, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.getDerivedPubKey(hexPubKey, hexChain: hexChainCode, path: path, isEdDSA: isEdDSA), error)
}
func TssEncodeXpub(_ hexPubKey: String, _ hexChainCode: String, _ network: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.encodeXpub(hexPubKey, hexChain: hexChainCode, network: network), error)
}
func TssGetOutputDescriptor(_ hexPubKey: String, _ hexChainCode: String, _ network: String, _ addressType: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.getOutputDescriptor(hexPubKey, hexChain: hexChainCode, network: network, addressType: addressType), error)
}
func TssPubToP2WPKH(_ pubKeyCompressed: String, _ mainnetORtestnet3: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.pub(toP2WPKH: pubKeyCompressed, network: mainnetORtestnet3), error)
}
func TssPubToP2SHP2WKH(_ pubKeyCompressed: String, _ mainnetORtestnet3: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.pub(toP2SHP2WKH: pubKeyCompressed, network: mainnetORtestnet3), error)
}
func TssPubToP2TR(_ pubKeyCompressedHex: String, _ mainnetORtestnet3: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.pub(toP2TR: pubKeyCompressedHex, network: mainnetORtestnet3), error)
}
func TssPubToP2KH(_ pubKeyCompressed: String, _ mainnetORtestnet3: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.pub(toP2KH: pubKeyCompressed, network: mainnetORtestnet3), error)
}
func TssLocalPreParams(_ ppmFile: String, _ timeoutMinutes: Int, _ result: UnsafeMutablePointer<ObjCBool>, _ error: NSErrorPointer) -> String {
  let out = BbmtBridge.localPreParams(ppmFile, timeoutMinutes: timeoutMinutes)
  if out.hasPrefix("error:") {
    result.pointee = false
    return bbmtResolve(out, error)
  }
  result.pointee = true
  error?.pointee = nil
  return out
}
func TssJoinKeygen(_ ppmPath: String, _ key: String, _ partiesCSV: String, _ encKey: String, _ decKey: String, _ session: String, _ server: String, _ chaincode: String, _ sessionKey: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.joinKeygen(ppmPath, key: key, parties: partiesCSV, encKey: encKey, decKey: decKey, session: session, server: server, chaincode: chaincode, sessionKey: sessionKey), error)
}
func TssNostrJoinKeygen(_ relaysCSV: String, _ partyNsec: String, _ partiesNpubsCSV: String, _ sessionID: String, _ sessionKey: String, _ chaincode: String, _ ppmPath: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.nostrJoinKeygen(relaysCSV, nsec: partyNsec, peers: partiesNpubsCSV, session: sessionID, sessionKey: sessionKey, chaincode: chaincode, ppmPath: ppmPath), error)
}
func TssNostrJoinKeysign(_ relaysCSV: String, _ partyNsec: String, _ partiesNpubsCSV: String, _ sessionID: String, _ sessionKey: String, _ keyshareJSON: String, _ derivationPath: String, _ message: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.nostrJoinKeysign(relaysCSV, nsec: partyNsec, peers: partiesNpubsCSV, session: sessionID, sessionKey: sessionKey, keyshare: keyshareJSON, derivePath: derivationPath, message: message), error)
}
func TssMpcSignPSBT(_ server: String, _ key: String, _ partiesCSV: String, _ session: String, _ sessionKey: String, _ encKey: String, _ decKey: String, _ keyshare: String, _ psbtBase64: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.mpcSignPSBT(server, key: key, parties: partiesCSV, session: session, sessionKey: sessionKey, encKey: encKey, decKey: decKey, keyshare: keyshare, psbt: psbtBase64), error)
}
func TssMpcSendBTCWithUTXOs(_ server: String, _ key: String, _ partiesCSV: String, _ session: String, _ sessionKey: String, _ encKey: String, _ decKey: String, _ keyshare: String, _ publicKey: String, _ receiverAddress: String, _ amountSatoshiStr: String, _ estimatedFeeStr: String, _ utxosWithPathsJSON: String, _ changeAddress: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.mpcSendBTC(withUTXOs: server, key: key, parties: partiesCSV, session: session, sessionKey: sessionKey, encKey: encKey, decKey: decKey, keyshare: keyshare, btcPub: publicKey, receiver: receiverAddress, amount: amountSatoshiStr, fees: estimatedFeeStr, utxos: utxosWithPathsJSON, change: changeAddress), error)
}
func TssNostrMpcSendBTCWithUTXOs(_ relaysCSV: String, _ partyNsec: String, _ partiesNpubsCSV: String, _ npubsSorted: String, _ balanceSats: String, _ keyshareJSON: String, _ receiverAddress: String, _ amountSatoshiStr: String, _ estimatedFeeStr: String, _ utxosWithPathsJSON: String, _ changeAddress: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.nostrMpcSendBTC(withUTXOs: relaysCSV, nsec: partyNsec, parties: partiesNpubsCSV, npubsSorted: npubsSorted, balance: balanceSats, keyshare: keyshareJSON, receiver: receiverAddress, amount: amountSatoshiStr, fees: estimatedFeeStr, utxos: utxosWithPathsJSON, change: changeAddress), error)
}
func TssNostrMpcSignPSBT(_ relaysCSV: String, _ partyNsec: String, _ partiesNpubsCSV: String, _ npubsSorted: String, _ keyshareJSON: String, _ psbtBase64: String, _ error: NSErrorPointer) -> String {
  bbmtResolve(BbmtBridge.nostrMpcSignPSBT(relaysCSV, nsec: partyNsec, parties: partiesNpubsCSV, npubsSorted: npubsSorted, keyshare: keyshareJSON, psbt: psbtBase64), error)
}
func TssDisableLogs() { BbmtBridge.disableLogs() }
func TssSetHookListener(_ h: AnyObject?) {
  if let module = h as? BBMTLibNativeModule {
    BbmtBridge.setHookListener { module.onMessage($0) }
  } else {
    BbmtBridge.setHookListener(nil)
  }
}
func TssSetEventListener(_ l: AnyObject?) {
  if let module = l as? BBMTLibNativeModule {
    BbmtBridge.setGoLogListener { module.onGoLog($0) }
  } else {
    BbmtBridge.setGoLogListener(nil)
  }
}
