package main

import "C"

import "github.com/BoldBitcoinWallet/BBMTLib/dkls"

//export DklsHelloDkg
func DklsHelloDkg() (out *C.char) {
	defer recoverBridge(&out)
	return cString(dkls.HelloDkg())
}

//export DklsVersion
func DklsVersion() (out *C.char) {
	defer recoverBridge(&out)
	return C.CString("dkls23-bbmt-1.0.0")
}

//export DklsLanJoinKeygen
func DklsLanJoinKeygen(key, parties, session, server, chaincode, sessionKey, encKey, decKey *C.char) (out *C.char) {
	defer recoverBridge(&out)
	// F15b-1: DKG output is staged natively; JS receives
	// {handle, metadata} only — never the keyshare JSON.
	ksJSON, err := dkls.JoinKeygen(
		mustGoStr(key, "key"), mustGoStr(parties, "parties"), mustGoStr(session, "session"),
		mustGoStr(server, "server"), mustGoStr(chaincode, "chaincode"), mustGoStr(sessionKey, "sessionKey"),
		mustGoStr(encKey, "encKey"), mustGoStr(decKey, "decKey"),
	)
	if err != nil {
		return cString("", err)
	}
	return cString(dkls.StageKeygenOutput(ksJSON))
}

//export DklsNostrJoinKeygen
func DklsNostrJoinKeygen(relays, nsec, peers, session, sessionKey, chaincode *C.char) (out *C.char) {
	defer recoverBridge(&out)
	// F15b-1: staged natively; JS receives {handle, metadata}.
	ksJSON, err := dkls.NostrJoinKeygen(
		mustGoStr(relays, "relays"), mustGoStr(nsec, "nsec"), mustGoStr(peers, "peers"),
		mustGoStr(session, "session"), mustGoStr(sessionKey, "sessionKey"), mustGoStr(chaincode, "chaincode"),
	)
	if err != nil {
		return cString("", err)
	}
	return cString(dkls.StageKeygenOutput(ksJSON))
}

//export DklsNostrJoinKeysign
func DklsNostrJoinKeysign(relays, nsec, peers, session, sessionKey, keyshare, message *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(dkls.NostrJoinKeysign(
		mustGoStr(relays, "relays"), mustGoStr(nsec, "nsec"), mustGoStr(peers, "peers"),
		mustGoStr(session, "session"), mustGoStr(sessionKey, "sessionKey"), mustGoStr(keyshare, "keyshare"), mustGoStr(message, "message"),
	))
}

//export DklsMpcSignPSBT
func DklsMpcSignPSBT(server, key, parties, session, sessionKey, encKey, decKey, keyshare, psbt *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(dkls.MpcSignPSBT(
		mustGoStr(server, "server"), mustGoStr(key, "key"), mustGoStr(parties, "parties"), mustGoStr(session, "session"),
		mustGoStr(sessionKey, "sessionKey"), mustGoStr(encKey, "encKey"), mustGoStr(decKey, "decKey"),
		mustGoStr(keyshare, "keyshare"), mustGoStr(psbt, "psbt"),
	))
}

//export DklsNostrMpcSignPSBT
func DklsNostrMpcSignPSBT(relays, nsec, parties, npubsSorted, keyshare, psbt *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(dkls.NostrMpcSignPSBT(
		mustGoStr(relays, "relays"), mustGoStr(nsec, "nsec"), mustGoStr(parties, "parties"), mustGoStr(npubsSorted, "npubsSorted"),
		mustGoStr(keyshare, "keyshare"), mustGoStr(psbt, "psbt"),
	))
}

//export DklsMpcSendBTCWithUTXOs
func DklsMpcSendBTCWithUTXOs(
	server, key, parties, session, sessionKey, encKey, decKey, keyshare,
	btcPub, toAddress, amount, fees, utxos, change *C.char,
) (out *C.char) {
	defer recoverBridge(&out)
	return cString(dkls.MpcSendBTCWithUTXOs(
		mustGoStr(server, "server"), mustGoStr(key, "key"), mustGoStr(parties, "parties"), mustGoStr(session, "session"),
		mustGoStr(sessionKey, "sessionKey"), mustGoStr(encKey, "encKey"), mustGoStr(decKey, "decKey"), mustGoStr(keyshare, "keyshare"),
		mustGoStr(btcPub, "btcPub"), mustGoStr(toAddress, "toAddress"), mustGoStr(amount, "amount"), mustGoStr(fees, "fees"),
		mustGoStr(utxos, "utxos"), mustGoStr(change, "change"),
	))
}

//export DklsNostrMpcSendBTCWithUTXOs
func DklsNostrMpcSendBTCWithUTXOs(
	relays, nsec, parties, npubsSorted, balance, keyshare,
	toAddress, amount, fees, utxos, change *C.char,
) (out *C.char) {
	defer recoverBridge(&out)
	return cString(dkls.NostrMpcSendBTCWithUTXOs(
		mustGoStr(relays, "relays"), mustGoStr(nsec, "nsec"), mustGoStr(parties, "parties"), mustGoStr(npubsSorted, "npubsSorted"),
		mustGoStr(balance, "balance"), mustGoStr(keyshare, "keyshare"),
		mustGoStr(toAddress, "toAddress"), mustGoStr(amount, "amount"), mustGoStr(fees, "fees"),
		mustGoStr(utxos, "utxos"), mustGoStr(change, "change"),
	))
}

//export DklsCancelMpcSession
func DklsCancelMpcSession(sessionID *C.char) (out *C.char) {
	defer recoverBridge(&out)
	dkls.CancelMpcSession(mustGoStr(sessionID, "sessionID"))
	return C.CString("ok")
}

//export DklsCancelNostrMpc
func DklsCancelNostrMpc() (out *C.char) {
	defer recoverBridge(&out)
	result, err := dkls.CancelNostrMpc()
	return cString(result, err)
}

// DklsFree is an alias kept for older JNI / bridge code.
//
//export DklsFree
func DklsFree(p *C.char) {
	BbmtFree(p)
}
