package dkls

import "github.com/BoldBitcoinWallet/BBMTLib/tss"

// High-level Bitcoin / PSBT entrypoints delegate to BBMTLib/tss, which dispatches
// per-input keysign to DKLs23 when the keyshare JSON indicates dkls23.

func MpcSignPSBT(
	server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshareJSON, psbtBase64 string,
) (string, error) {
	return tss.MpcSignPSBT(server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshareJSON, psbtBase64)
}

func NostrMpcSignPSBT(
	relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, keyshareJSON, psbtBase64 string,
) (string, error) {
	return tss.NostrMpcSignPSBT(relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, keyshareJSON, psbtBase64)
}

func MpcSendBTCWithUTXOs(
	server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshareJSON,
	publicKey, receiverAddress, amountSatoshi, feeSatoshi, utxosWithPathsJSON, changeAddress string,
) (string, error) {
	return tss.MpcSendBTCWithUTXOs(
		server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshareJSON,
		publicKey, receiverAddress, amountSatoshi, feeSatoshi, utxosWithPathsJSON, changeAddress,
	)
}

func NostrMpcSendBTCWithUTXOs(
	relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, balanceSats, keyshareJSON,
	receiverAddress, amountSatoshiStr, estimatedFeeStr, utxosWithPathsJSON, changeAddress string,
) (string, error) {
	return tss.NostrMpcSendBTCWithUTXOs(
		relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, balanceSats, keyshareJSON,
		receiverAddress, amountSatoshiStr, estimatedFeeStr, utxosWithPathsJSON, changeAddress,
	)
}

func CancelNostrMpc() (result string, err error) {
	defer recoverAsError("CancelNostrMpc", &err, &result)
	CancelMpcSession("")
	_, _ = tss.CancelNostrMpc()
	return "ok", nil
}
