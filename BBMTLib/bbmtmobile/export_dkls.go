package main

import "C"

import "github.com/BoldBitcoinWallet/BBMTLib/dkls"

//export DklsHelloDkg
func DklsHelloDkg() *C.char {
	return cString(dkls.HelloDkg())
}

//export DklsVersion
func DklsVersion() *C.char {
	return C.CString("dkls23-bbmt-1.0.0")
}

//export DklsLanJoinKeygen
func DklsLanJoinKeygen(key, parties, session, server, chaincode, sessionKey, encKey, decKey *C.char) *C.char {
	return cString(dkls.JoinKeygen(
		C.GoString(key), C.GoString(parties), C.GoString(session),
		C.GoString(server), C.GoString(chaincode), C.GoString(sessionKey),
		C.GoString(encKey), C.GoString(decKey),
	))
}

//export DklsNostrJoinKeygen
func DklsNostrJoinKeygen(relays, nsec, peers, session, sessionKey, chaincode *C.char) *C.char {
	return cString(dkls.NostrJoinKeygen(
		C.GoString(relays), C.GoString(nsec), C.GoString(peers),
		C.GoString(session), C.GoString(sessionKey), C.GoString(chaincode),
	))
}

//export DklsNostrJoinKeysign
func DklsNostrJoinKeysign(relays, nsec, peers, session, sessionKey, keyshare, message *C.char) *C.char {
	return cString(dkls.NostrJoinKeysign(
		C.GoString(relays), C.GoString(nsec), C.GoString(peers),
		C.GoString(session), C.GoString(sessionKey), C.GoString(keyshare), C.GoString(message),
	))
}

//export DklsMpcSignPSBT
func DklsMpcSignPSBT(server, key, parties, session, sessionKey, encKey, decKey, keyshare, psbt *C.char) *C.char {
	return cString(dkls.MpcSignPSBT(
		C.GoString(server), C.GoString(key), C.GoString(parties), C.GoString(session),
		C.GoString(sessionKey), C.GoString(encKey), C.GoString(decKey),
		C.GoString(keyshare), C.GoString(psbt),
	))
}

//export DklsNostrMpcSignPSBT
func DklsNostrMpcSignPSBT(relays, nsec, parties, npubsSorted, keyshare, psbt *C.char) *C.char {
	return cString(dkls.NostrMpcSignPSBT(
		C.GoString(relays), C.GoString(nsec), C.GoString(parties), C.GoString(npubsSorted),
		C.GoString(keyshare), C.GoString(psbt),
	))
}

//export DklsMpcSendBTCWithUTXOs
func DklsMpcSendBTCWithUTXOs(
	server, key, parties, session, sessionKey, encKey, decKey, keyshare,
	btcPub, toAddress, amount, fees, utxos, change *C.char,
) *C.char {
	return cString(dkls.MpcSendBTCWithUTXOs(
		C.GoString(server), C.GoString(key), C.GoString(parties), C.GoString(session),
		C.GoString(sessionKey), C.GoString(encKey), C.GoString(decKey), C.GoString(keyshare),
		C.GoString(btcPub), C.GoString(toAddress), C.GoString(amount), C.GoString(fees),
		C.GoString(utxos), C.GoString(change),
	))
}

//export DklsNostrMpcSendBTCWithUTXOs
func DklsNostrMpcSendBTCWithUTXOs(
	relays, nsec, parties, npubsSorted, balance, keyshare,
	toAddress, amount, fees, utxos, change *C.char,
) *C.char {
	return cString(dkls.NostrMpcSendBTCWithUTXOs(
		C.GoString(relays), C.GoString(nsec), C.GoString(parties), C.GoString(npubsSorted),
		C.GoString(balance), C.GoString(keyshare),
		C.GoString(toAddress), C.GoString(amount), C.GoString(fees),
		C.GoString(utxos), C.GoString(change),
	))
}

//export DklsCancelMpcSession
func DklsCancelMpcSession(sessionID *C.char) *C.char {
	dkls.CancelMpcSession(C.GoString(sessionID))
	return C.CString("ok")
}

//export DklsCancelNostrMpc
func DklsCancelNostrMpc() *C.char {
	result, err := dkls.CancelNostrMpc()
	return cString(result, err)
}

// DklsFree is an alias kept for older JNI / bridge code.
//
//export DklsFree
func DklsFree(p *C.char) {
	BbmtFree(p)
}
