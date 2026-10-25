package main

import "C"

import "github.com/BoldBitcoinWallet/BBMTLib/tss"

//export BbmtPublishData
func BbmtPublishData(port, timeout, enckey, data, mode *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.PublishData(mustGoStr(port, "port"), mustGoStr(timeout, "timeout"), mustGoStr(enckey, "enckey"), mustGoStr(data, "data"), mustGoStr(mode, "mode")))
}

//export BbmtFetchData
func BbmtFetchData(url, decKey, data *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.FetchData(mustGoStr(url, "url"), mustGoStr(decKey, "decKey"), mustGoStr(data, "data")))
}

//export BbmtSetNetwork
func BbmtSetNetwork(network *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.SetNetwork(mustGoStr(network, "network")))
}

//export BbmtGetNetwork
func BbmtGetNetwork() (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.GetNetwork())
}

//export BbmtSpendingHash
func BbmtSpendingHash(sender, receiver *C.char, amount C.longlong) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.SpendingHash(mustGoStr(sender, "sender"), mustGoStr(receiver, "receiver"), mustNonNegative(int64(amount), maxBridgeSats, "amount")))
}

//export BbmtSpendingHashWithUTXOs
func BbmtSpendingHashWithUTXOs(utxos, receiver, amount *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.SpendingHashWithUTXOs(mustGoStr(utxos, "utxos"), mustGoStr(receiver, "receiver"), mustGoStr(amount, "amount")))
}

//export BbmtEstimateFees
func BbmtEstimateFees(sender, receiver *C.char, amount C.longlong) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.EstimateFees(mustGoStr(sender, "sender"), mustGoStr(receiver, "receiver"), mustNonNegative(int64(amount), maxBridgeSats, "amount")))
}

//export BbmtEstimateFeeWithUTXOs
func BbmtEstimateFeeWithUTXOs(utxos, receiver, amount, change *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.EstimateFeeWithUTXOs(mustGoStr(utxos, "utxos"), mustGoStr(receiver, "receiver"), mustGoStr(amount, "amount"), mustGoStr(change, "change")))
}

//export BbmtRunRelay
func BbmtRunRelay(port *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.RunRelay(mustGoStr(port, "port")))
}

//export BbmtStopRelay
func BbmtStopRelay() (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.StopRelay())
}

//export BbmtListenForPeers
func BbmtListenForPeers(id, pubkey, port, timeout, mode *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.ListenForPeers(mustGoStr(id, "id"), mustGoStr(pubkey, "pubkey"), mustGoStr(port, "port"), mustGoStr(timeout, "timeout"), mustGoStr(mode, "mode")))
}

//export BbmtDiscoverPeers
func BbmtDiscoverPeers(id, pubkey, localIP, remoteIPs, port, timeout, mode *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.DiscoverPeers(mustGoStr(id, "id"), mustGoStr(pubkey, "pubkey"), mustGoStr(localIP, "localIP"), mustGoStr(remoteIPs, "remoteIPs"), mustGoStr(port, "port"), mustGoStr(timeout, "timeout"), mustGoStr(mode, "mode")))
}

//export BbmtGenerateKeyPair
func BbmtGenerateKeyPair() (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.GenerateKeyPair())
}

//export BbmtAesEncrypt
func BbmtAesEncrypt(data, key *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.AesEncrypt(mustGoStr(data, "data"), mustGoStr(key, "key")))
}

//export BbmtAesDecrypt
func BbmtAesDecrypt(data, key *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.AesDecrypt(mustGoStr(data, "data"), mustGoStr(key, "key")))
}

//export BbmtSha256
func BbmtSha256(msg *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.Sha256(mustGoStr(msg, "msg")))
}

//export BbmtBackupEncrypt
func BbmtBackupEncrypt(plaintext, password *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.BackupEncrypt(mustGoStr(plaintext, "plaintext"), mustGoStr(password, "password")))
}

// F15b-1 (A5): BbmtBackupDecrypt REMOVED — plaintext-to-JS import
// replaced by staged BbmtImportBackupStaged. tss.BackupDecrypt
// (envelope parse + AEAD) stays: the staged path calls it.

//export BbmtSecureRandom
func BbmtSecureRandom(length C.int) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.SecureRandom(int(length)))
}

//export BbmtSecP256k1Recover
func BbmtSecP256k1Recover(r, s, v, h *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.SecP256k1Recover(mustGoStr(r, "r"), mustGoStr(s, "s"), mustGoStr(v, "v"), mustGoStr(h, "h")))
}

//export BbmtGetDerivedPubKey
func BbmtGetDerivedPubKey(hexPub, hexChain, path *C.char, isEdDSA C.int) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.GetDerivedPubKey(mustGoStr(hexPub, "hexPub"), mustGoStr(hexChain, "hexChain"), mustGoStr(path, "path"), mustNonNegative(int64(isEdDSA), 1, "isEdDSA") != 0))
}

//export BbmtEncodeXpub
func BbmtEncodeXpub(hexPub, hexChain, network *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.EncodeXpub(mustGoStr(hexPub, "hexPub"), mustGoStr(hexChain, "hexChain"), mustGoStr(network, "network")))
}

//export BbmtGetOutputDescriptor
func BbmtGetOutputDescriptor(hexPub, hexChain, network, addressType *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.GetOutputDescriptor(mustGoStr(hexPub, "hexPub"), mustGoStr(hexChain, "hexChain"), mustGoStr(network, "network"), mustGoStr(addressType, "addressType")))
}

//export BbmtAppendOutputDescriptorChecksum
func BbmtAppendOutputDescriptorChecksum(descriptor *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.AddDescriptorChecksum(mustGoStr(descriptor, "descriptor")))
}

//export BbmtPubToP2WPKH
func BbmtPubToP2WPKH(pub, network *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.PubToP2WPKH(mustGoStr(pub, "pub"), mustGoStr(network, "network")))
}

//export BbmtPubToP2SHP2WKH
func BbmtPubToP2SHP2WKH(pub, network *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.PubToP2SHP2WKH(mustGoStr(pub, "pub"), mustGoStr(network, "network")))
}

//export BbmtPubToP2TR
func BbmtPubToP2TR(pub, network *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.PubToP2TR(mustGoStr(pub, "pub"), mustGoStr(network, "network")))
}

//export BbmtPubToP2KH
func BbmtPubToP2KH(pub, network *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.PubToP2KH(mustGoStr(pub, "pub"), mustGoStr(network, "network")))
}

//export BbmtUseFeePolicy
func BbmtUseFeePolicy(policy *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.UseFeePolicy(mustGoStr(policy, "policy")))
}

//export BbmtUseAPI
func BbmtUseAPI(network, base *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.UseAPI(mustGoStr(network, "network"), mustGoStr(base, "base")))
}

//export BbmtUseFeeAPIs
func BbmtUseFeeAPIs(urls *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.UseFeeAPIs(mustGoStr(urls, "urls")))
}

//export BbmtTotalUTXO
func BbmtTotalUTXO(address *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.TotalUTXO(mustGoStr(address, "address")))
}

//export BbmtLocalPreParams
func BbmtLocalPreParams(ppmFile *C.char, timeoutMinutes C.long) (out *C.char) {
	defer recoverBridge(&out)
	ok, err := tss.LocalPreParams(mustGoStr(ppmFile, "ppmFile"), int(mustNonNegative(int64(timeoutMinutes), maxPreParamsTimeout, "timeoutMinutes")))
	if err != nil {
		return cString("", err)
	}
	if !ok {
		return C.CString("error:preparams failed")
	}
	return C.CString("ok")
}

//export BbmtJoinKeygen
func BbmtJoinKeygen(ppmPath, key, parties, encKey, decKey, session, server, chaincode, sessionKey *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.JoinKeygen(
		mustGoStr(ppmPath, "ppmPath"), mustGoStr(key, "key"), mustGoStr(parties, "parties"), mustGoStr(encKey, "encKey"), mustGoStr(decKey, "decKey"),
		mustGoStr(session, "session"), mustGoStr(server, "server"), mustGoStr(chaincode, "chaincode"), mustGoStr(sessionKey, "sessionKey"),
	))
}

//export BbmtJoinKeygenWithBackend
func BbmtJoinKeygenWithBackend(backend, ppmPath, key, parties, encKey, decKey, session, server, chaincode, sessionKey *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.DispatchJoinKeygen(
		mustGoStr(backend, "backend"),
		mustGoStr(ppmPath, "ppmPath"), mustGoStr(key, "key"), mustGoStr(parties, "parties"), mustGoStr(encKey, "encKey"), mustGoStr(decKey, "decKey"),
		mustGoStr(session, "session"), mustGoStr(server, "server"), mustGoStr(chaincode, "chaincode"), mustGoStr(sessionKey, "sessionKey"),
	))
}

//export BbmtNostrKeypair
func BbmtNostrKeypair() (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.NostrKeypair())
}

//export BbmtHexToNpub
func BbmtHexToNpub(hexKey *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.HexToNpub(mustGoStr(hexKey, "hexKey")))
}

//export BbmtNostrJoinKeygen
func BbmtNostrJoinKeygen(relays, nsec, peers, session, sessionKey, chaincode, ppmPath *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.NostrJoinKeygen(
		mustGoStr(relays, "relays"), mustGoStr(nsec, "nsec"), mustGoStr(peers, "peers"), mustGoStr(session, "session"), mustGoStr(sessionKey, "sessionKey"), mustGoStr(chaincode, "chaincode"), mustGoStr(ppmPath, "ppmPath"),
	))
}

//export BbmtNostrJoinKeygenWithBackend
func BbmtNostrJoinKeygenWithBackend(backend, relays, nsec, peers, session, sessionKey, chaincode, ppmPath *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.DispatchNostrJoinKeygen(
		mustGoStr(backend, "backend"),
		mustGoStr(relays, "relays"), mustGoStr(nsec, "nsec"), mustGoStr(peers, "peers"), mustGoStr(session, "session"), mustGoStr(sessionKey, "sessionKey"), mustGoStr(chaincode, "chaincode"), mustGoStr(ppmPath, "ppmPath"),
	))
}

//export BbmtNostrJoinKeysign
func BbmtNostrJoinKeysign(relays, nsec, peers, session, sessionKey, keyshare, derivePath, message *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.DispatchNostrJoinKeysign(
		mustGoStr(relays, "relays"), mustGoStr(nsec, "nsec"), mustGoStr(peers, "peers"), mustGoStr(session, "session"), mustGoStr(sessionKey, "sessionKey"),
		mustGoStr(keyshare, "keyshare"), mustGoStr(derivePath, "derivePath"), mustGoStr(message, "message"),
	))
}

//export BbmtPostTx
func BbmtPostTx(rawTx *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.PostTx(mustGoStr(rawTx, "rawTx")))
}

//export BbmtComputeTxId
func BbmtComputeTxId(rawTx *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.ComputeTxId(mustGoStr(rawTx, "rawTx")))
}

//export BbmtCancelMpcSession
func BbmtCancelMpcSession(sessionID *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.CancelMpcSession(mustGoStr(sessionID, "sessionID")))
}

//export BbmtCancelNostrMpc
func BbmtCancelNostrMpc() (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.CancelNostrMpc())
}

//export BbmtDisableLogs
func BbmtDisableLogs() {
	tss.DisableLogs()
}

//export BbmtParsePSBTDetails
func BbmtParsePSBTDetails(psbt *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.ParsePSBTDetails(mustGoStr(psbt, "psbt")))
}

//export BbmtPsbtIdentityHash
func BbmtPsbtIdentityHash(psbt *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.PsbtIdentityHash(mustGoStr(psbt, "psbt")))
}

//export BbmtMpcSignPSBT
func BbmtMpcSignPSBT(server, key, parties, session, sessionKey, encKey, decKey, keyshare, psbt *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.MpcSignPSBT(
		mustGoStr(server, "server"), mustGoStr(key, "key"), mustGoStr(parties, "parties"), mustGoStr(session, "session"), mustGoStr(sessionKey, "sessionKey"),
		mustGoStr(encKey, "encKey"), mustGoStr(decKey, "decKey"), mustGoStr(keyshare, "keyshare"), mustGoStr(psbt, "psbt"),
	))
}

//export BbmtMpcSendBTCWithUTXOs
func BbmtMpcSendBTCWithUTXOs(
	server, key, parties, session, sessionKey, encKey, decKey, keyshare, btcPub,
	receiver, amount, fees, utxos, change *C.char,
) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.MpcSendBTCWithUTXOs(
		mustGoStr(server, "server"), mustGoStr(key, "key"), mustGoStr(parties, "parties"), mustGoStr(session, "session"), mustGoStr(sessionKey, "sessionKey"),
		mustGoStr(encKey, "encKey"), mustGoStr(decKey, "decKey"), mustGoStr(keyshare, "keyshare"), mustGoStr(btcPub, "btcPub"),
		mustGoStr(receiver, "receiver"), mustGoStr(amount, "amount"), mustGoStr(fees, "fees"), mustGoStr(utxos, "utxos"), mustGoStr(change, "change"),
	))
}

//export BbmtNostrMpcSendBTCWithUTXOs
func BbmtNostrMpcSendBTCWithUTXOs(
	relays, nsec, parties, npubsSorted, balance, keyshare,
	receiver, amount, fees, utxos, change *C.char,
) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.NostrMpcSendBTCWithUTXOs(
		mustGoStr(relays, "relays"), mustGoStr(nsec, "nsec"), mustGoStr(parties, "parties"), mustGoStr(npubsSorted, "npubsSorted"), mustGoStr(balance, "balance"), mustGoStr(keyshare, "keyshare"),
		mustGoStr(receiver, "receiver"), mustGoStr(amount, "amount"), mustGoStr(fees, "fees"), mustGoStr(utxos, "utxos"), mustGoStr(change, "change"),
	))
}

//export BbmtNostrMpcSignPSBT
func BbmtNostrMpcSignPSBT(relays, nsec, parties, npubsSorted, keyshare, psbt *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(tss.NostrMpcSignPSBT(
		mustGoStr(relays, "relays"), mustGoStr(nsec, "nsec"), mustGoStr(parties, "parties"), mustGoStr(npubsSorted, "npubsSorted"), mustGoStr(keyshare, "keyshare"), mustGoStr(psbt, "psbt"),
	))
}
