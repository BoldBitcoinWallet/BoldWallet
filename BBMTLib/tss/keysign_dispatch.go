package tss

import "encoding/json"

type keyshareBackendProbe struct {
	TssBackend string `json:"tss_backend"`
	ShareB64   string `json:"share_b64"`
}

// IsDKLsKeyshareJSON reports whether the keyshare should use DKLs23 signing.
func IsDKLsKeyshareJSON(keyshareJSON string) bool {
	var p keyshareBackendProbe
	if err := json.Unmarshal([]byte(keyshareJSON), &p); err != nil {
		return false
	}
	if p.TssBackend == "dkls23" {
		return true
	}
	if p.TssBackend == "" && p.ShareB64 != "" {
		return true
	}
	return false
}

type nostrKeysignSighashFunc func(
	relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, derivationPath, sighashBase64 string,
) (string, error)

type lanKeysignSighashFunc func(
	server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64 string,
) (string, error)

var (
	dklsNostrKeysignSighash nostrKeysignSighashFunc
	dklsLanKeysignSighash   lanKeysignSighashFunc
)

// RegisterDKLsKeysignHandlers wires DKLs23 keysign for Bitcoin send/PSBT helpers in this package.
func RegisterDKLsKeysignHandlers(nostr nostrKeysignSighashFunc, lan lanKeysignSighashFunc) {
	dklsNostrKeysignSighash = nostr
	dklsLanKeysignSighash = lan
}

// DispatchNostrJoinKeysignWithSighash routes to DKLs23 or GG18 based on keyshare metadata.
func DispatchNostrJoinKeysignWithSighash(
	relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, derivationPath, sighashBase64 string,
) (string, error) {
	if IsDKLsKeyshareJSON(keyshareJSON) && dklsNostrKeysignSighash != nil {
		return dklsNostrKeysignSighash(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, derivationPath, sighashBase64)
	}
	return NostrJoinKeysignWithSighash(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, derivationPath, sighashBase64)
}

// DispatchJoinKeysign routes LAN keysign (message is base64-encoded sighash) to DKLs23 or GG18.
func DispatchJoinKeysign(
	server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64 string,
) (string, error) {
	if IsDKLsKeyshareJSON(keyshare) && dklsLanKeysignSighash != nil {
		return dklsLanKeysignSighash(server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64)
	}
	return JoinKeysign(server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64)
}
