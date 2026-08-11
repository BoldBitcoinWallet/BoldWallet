package main

import "C"

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/BoldBitcoinWallet/BBMTLib/pkg/nostrservice"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

func goStr(p *C.char) string {
	if p == nil {
		return ""
	}
	return C.GoString(p)
}

//export BbmtPublishData
func BbmtPublishData(port, timeout, enckey, data, mode *C.char) *C.char {
	return cString(tss.PublishData(goStr(port), goStr(timeout), goStr(enckey), goStr(data), goStr(mode)))
}

//export BbmtFetchData
func BbmtFetchData(url, decKey, data *C.char) *C.char {
	return cString(tss.FetchData(goStr(url), goStr(decKey), goStr(data)))
}

//export BbmtSetNetwork
func BbmtSetNetwork(network *C.char) *C.char {
	return cString(tss.SetNetwork(goStr(network)))
}

//export BbmtGetNetwork
func BbmtGetNetwork() *C.char {
	return cString(tss.GetNetwork())
}

//export BbmtSpendingHash
func BbmtSpendingHash(sender, receiver *C.char, amount C.longlong) *C.char {
	return cString(tss.SpendingHash(goStr(sender), goStr(receiver), int64(amount)))
}

//export BbmtSpendingHashWithUTXOs
func BbmtSpendingHashWithUTXOs(utxos, receiver, amount *C.char) *C.char {
	return cString(tss.SpendingHashWithUTXOs(goStr(utxos), goStr(receiver), goStr(amount)))
}

//export BbmtEstimateFees
func BbmtEstimateFees(sender, receiver *C.char, amount C.longlong) *C.char {
	return cString(tss.EstimateFees(goStr(sender), goStr(receiver), int64(amount)))
}

//export BbmtEstimateFeeWithUTXOs
func BbmtEstimateFeeWithUTXOs(utxos, receiver, amount, change *C.char) *C.char {
	return cString(tss.EstimateFeeWithUTXOs(goStr(utxos), goStr(receiver), goStr(amount), goStr(change)))
}

//export BbmtRunRelay
func BbmtRunRelay(port *C.char) *C.char {
	return cString(tss.RunRelay(goStr(port)))
}

//export BbmtStopRelay
func BbmtStopRelay() *C.char {
	return cString(tss.StopRelay())
}

//export BbmtListenForPeers
func BbmtListenForPeers(id, pubkey, port, timeout, mode *C.char) *C.char {
	return cString(tss.ListenForPeers(goStr(id), goStr(pubkey), goStr(port), goStr(timeout), goStr(mode)))
}

//export BbmtDiscoverPeers
func BbmtDiscoverPeers(id, pubkey, localIP, remoteIPs, port, timeout, mode *C.char) *C.char {
	return cString(tss.DiscoverPeers(goStr(id), goStr(pubkey), goStr(localIP), goStr(remoteIPs), goStr(port), goStr(timeout), goStr(mode)))
}

//export BbmtGenerateKeyPair
func BbmtGenerateKeyPair() *C.char {
	return cString(tss.GenerateKeyPair())
}

//export BbmtAesEncrypt
func BbmtAesEncrypt(data, key *C.char) *C.char {
	return cString(tss.AesEncrypt(goStr(data), goStr(key)))
}

//export BbmtAesDecrypt
func BbmtAesDecrypt(data, key *C.char) *C.char {
	return cString(tss.AesDecrypt(goStr(data), goStr(key)))
}

//export BbmtSha256
func BbmtSha256(msg *C.char) *C.char {
	return cString(tss.Sha256(goStr(msg)))
}

//export BbmtSecP256k1Recover
func BbmtSecP256k1Recover(r, s, v, h *C.char) *C.char {
	return cString(tss.SecP256k1Recover(goStr(r), goStr(s), goStr(v), goStr(h)))
}

//export BbmtGetDerivedPubKey
func BbmtGetDerivedPubKey(hexPub, hexChain, path *C.char, isEdDSA C.int) *C.char {
	return cString(tss.GetDerivedPubKey(goStr(hexPub), goStr(hexChain), goStr(path), isEdDSA != 0))
}

//export BbmtEncodeXpub
func BbmtEncodeXpub(hexPub, hexChain, network *C.char) *C.char {
	return cString(tss.EncodeXpub(goStr(hexPub), goStr(hexChain), goStr(network)))
}

//export BbmtGetOutputDescriptor
func BbmtGetOutputDescriptor(hexPub, hexChain, network, addressType *C.char) *C.char {
	return cString(tss.GetOutputDescriptor(goStr(hexPub), goStr(hexChain), goStr(network), goStr(addressType)))
}

//export BbmtAppendOutputDescriptorChecksum
func BbmtAppendOutputDescriptorChecksum(descriptor *C.char) *C.char {
	return cString(tss.AddDescriptorChecksum(goStr(descriptor)))
}

//export BbmtPubToP2WPKH
func BbmtPubToP2WPKH(pub, network *C.char) *C.char {
	return cString(tss.PubToP2WPKH(goStr(pub), goStr(network)))
}

//export BbmtPubToP2SHP2WKH
func BbmtPubToP2SHP2WKH(pub, network *C.char) *C.char {
	return cString(tss.PubToP2SHP2WKH(goStr(pub), goStr(network)))
}

//export BbmtPubToP2TR
func BbmtPubToP2TR(pub, network *C.char) *C.char {
	return cString(tss.PubToP2TR(goStr(pub), goStr(network)))
}

//export BbmtPubToP2KH
func BbmtPubToP2KH(pub, network *C.char) *C.char {
	return cString(tss.PubToP2KH(goStr(pub), goStr(network)))
}

//export BbmtUseFeePolicy
func BbmtUseFeePolicy(policy *C.char) *C.char {
	return cString(tss.UseFeePolicy(goStr(policy)))
}

//export BbmtUseAPI
func BbmtUseAPI(network, base *C.char) *C.char {
	return cString(tss.UseAPI(goStr(network), goStr(base)))
}

//export BbmtUseFeeAPIs
func BbmtUseFeeAPIs(urls *C.char) *C.char {
	return cString(tss.UseFeeAPIs(goStr(urls)))
}

//export BbmtTotalUTXO
func BbmtTotalUTXO(address *C.char) *C.char {
	return cString(tss.TotalUTXO(goStr(address)))
}

//export BbmtLocalPreParams
func BbmtLocalPreParams(ppmFile *C.char, timeoutMinutes C.long) *C.char {
	ok, err := tss.LocalPreParams(goStr(ppmFile), int(timeoutMinutes))
	if err != nil {
		return cString("", err)
	}
	if !ok {
		return C.CString("error:preparams failed")
	}
	return C.CString("ok")
}

//export BbmtJoinKeygen
func BbmtJoinKeygen(ppmPath, key, parties, encKey, decKey, session, server, chaincode, sessionKey *C.char) *C.char {
	return cString(tss.JoinKeygen(
		goStr(ppmPath), goStr(key), goStr(parties), goStr(encKey), goStr(decKey),
		goStr(session), goStr(server), goStr(chaincode), goStr(sessionKey),
	))
}

//export BbmtJoinKeygenWithBackend
func BbmtJoinKeygenWithBackend(backend, ppmPath, key, parties, encKey, decKey, session, server, chaincode, sessionKey *C.char) *C.char {
	return cString(tss.DispatchJoinKeygen(
		goStr(backend),
		goStr(ppmPath), goStr(key), goStr(parties), goStr(encKey), goStr(decKey),
		goStr(session), goStr(server), goStr(chaincode), goStr(sessionKey),
	))
}

//export BbmtNostrKeypair
func BbmtNostrKeypair() *C.char {
	return cString(tss.NostrKeypair())
}

//export BbmtHexToNpub
func BbmtHexToNpub(hexKey *C.char) *C.char {
	return cString(tss.HexToNpub(goStr(hexKey)))
}

//export BbmtNostrJoinKeygen
func BbmtNostrJoinKeygen(relays, nsec, peers, session, sessionKey, chaincode, ppmPath *C.char) *C.char {
	return cString(tss.NostrJoinKeygen(
		goStr(relays), goStr(nsec), goStr(peers), goStr(session), goStr(sessionKey), goStr(chaincode), goStr(ppmPath),
	))
}

//export BbmtNostrJoinKeygenWithBackend
func BbmtNostrJoinKeygenWithBackend(backend, relays, nsec, peers, session, sessionKey, chaincode, ppmPath *C.char) *C.char {
	return cString(tss.DispatchNostrJoinKeygen(
		goStr(backend),
		goStr(relays), goStr(nsec), goStr(peers), goStr(session), goStr(sessionKey), goStr(chaincode), goStr(ppmPath),
	))
}

//export BbmtNostrJoinKeysign
func BbmtNostrJoinKeysign(relays, nsec, peers, session, sessionKey, keyshare, derivePath, message *C.char) *C.char {
	return cString(tss.DispatchNostrJoinKeysign(
		goStr(relays), goStr(nsec), goStr(peers), goStr(session), goStr(sessionKey),
		goStr(keyshare), goStr(derivePath), goStr(message),
	))
}

//export BbmtPostTx
func BbmtPostTx(rawTx *C.char) *C.char {
	return cString(tss.PostTx(goStr(rawTx)))
}

//export BbmtComputeTxId
func BbmtComputeTxId(rawTx *C.char) *C.char {
	return cString(tss.ComputeTxId(goStr(rawTx)))
}

//export BbmtCancelMpcSession
func BbmtCancelMpcSession(sessionID *C.char) *C.char {
	return cString(tss.CancelMpcSession(goStr(sessionID)))
}

//export BbmtCancelNostrMpc
func BbmtCancelNostrMpc() *C.char {
	return cString(tss.CancelNostrMpc())
}

//export BbmtDisableLogs
func BbmtDisableLogs() {
	tss.DisableLogs()
}

//export BbmtParsePSBTDetails
func BbmtParsePSBTDetails(psbt *C.char) *C.char {
	return cString(tss.ParsePSBTDetails(goStr(psbt)))
}

//export BbmtPsbtIdentityHash
func BbmtPsbtIdentityHash(psbt *C.char) *C.char {
	return cString(tss.PsbtIdentityHash(goStr(psbt)))
}

//export BbmtMpcSignPSBT
func BbmtMpcSignPSBT(server, key, parties, session, sessionKey, encKey, decKey, keyshare, psbt *C.char) *C.char {
	return cString(tss.MpcSignPSBT(
		goStr(server), goStr(key), goStr(parties), goStr(session), goStr(sessionKey),
		goStr(encKey), goStr(decKey), goStr(keyshare), goStr(psbt),
	))
}

//export BbmtMpcSendBTCWithUTXOs
func BbmtMpcSendBTCWithUTXOs(
	server, key, parties, session, sessionKey, encKey, decKey, keyshare, btcPub,
	receiver, amount, fees, utxos, change *C.char,
) *C.char {
	return cString(tss.MpcSendBTCWithUTXOs(
		goStr(server), goStr(key), goStr(parties), goStr(session), goStr(sessionKey),
		goStr(encKey), goStr(decKey), goStr(keyshare), goStr(btcPub),
		goStr(receiver), goStr(amount), goStr(fees), goStr(utxos), goStr(change),
	))
}

//export BbmtNostrMpcSendBTCWithUTXOs
func BbmtNostrMpcSendBTCWithUTXOs(
	relays, nsec, parties, npubsSorted, balance, keyshare,
	receiver, amount, fees, utxos, change, initiatorNpubHint *C.char,
) *C.char {
	return cString(tss.NostrMpcSendBTCWithUTXOs(
		goStr(relays), goStr(nsec), goStr(parties), goStr(npubsSorted), goStr(balance), goStr(keyshare),
		goStr(receiver), goStr(amount), goStr(fees), goStr(utxos), goStr(change), goStr(initiatorNpubHint),
	))
}

//export BbmtNostrMpcSignPSBT
func BbmtNostrMpcSignPSBT(relays, nsec, parties, npubsSorted, keyshare, psbt, initiatorNpubHint *C.char) *C.char {
	return cString(tss.NostrMpcSignPSBT(
		goStr(relays), goStr(nsec), goStr(parties), goStr(npubsSorted), goStr(keyshare), goStr(psbt), goStr(initiatorNpubHint),
	))
}

//export BbmtNostrServiceStart
func BbmtNostrServiceStart(relays, nsec, npub, peers, roomHash, policyJSON *C.char) *C.char {
	var policy nostrservice.RoomPolicy
	policyRaw := goStr(policyJSON)
	if strings.TrimSpace(policyRaw) != "" {
		if err := json.Unmarshal([]byte(policyRaw), &policy); err != nil {
			return cString("", err)
		}
	}
	err := nostrservice.GetService().StartRoom(nostrservice.RoomConfig{
		RoomHash:      goStr(roomHash),
		RelaysCSV:     goStr(relays),
		LocalNsec:     goStr(nsec),
		LocalNpub:     goStr(npub),
		PeersNpubsCSV: goStr(peers),
		Policy:        policy,
	})
	return cString("ok", err)
}

//export BbmtNostrServiceSubscribe
func BbmtNostrServiceSubscribe(roomHash *C.char) *C.char {
	err := nostrservice.GetService().EnsureRoomSubscription(goStr(roomHash))
	if err != nil {
		return cString("", err)
	}
	return cString("ok", nil)
}

//export BbmtNostrServicePublish
func BbmtNostrServicePublish(roomHash, payloadJSON *C.char) *C.char {
	payloadRaw := goStr(payloadJSON)
	if payloadRaw == "" {
		return cString("", errors.New("payload json is required"))
	}
	var payload any
	if err := json.Unmarshal([]byte(payloadRaw), &payload); err != nil {
		return cString("", err)
	}
	err := nostrservice.GetService().PublishMessage(goStr(roomHash), payload)
	return cString("ok", err)
}

//export BbmtNostrServiceStop
func BbmtNostrServiceStop(roomHash *C.char) *C.char {
	err := nostrservice.GetService().StopRoom(goStr(roomHash))
	return cString("ok", err)
}
