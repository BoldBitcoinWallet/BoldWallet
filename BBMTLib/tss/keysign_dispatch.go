package tss

import "encoding/json"

type keyshareBackendProbe struct {
	TssBackend     string          `json:"tss_backend"`
	ShareB64       string          `json:"share_b64"`
	EcdsaLocalData json.RawMessage `json:"ecdsa_local_data"`
}

// IsDKLsKeyshareJSON reports whether the keyshare should use DKLs23 signing.
// Matches TS detectKeyshareTssBackend: explicit backend wins; GG18 ecdsa_local_data
// takes precedence over share_b64 when tss_backend is absent.
func IsDKLsKeyshareJSON(keyshareJSON string) bool {
	var p keyshareBackendProbe
	if err := json.Unmarshal([]byte(keyshareJSON), &p); err != nil {
		return false
	}
	if p.TssBackend == "dkls23" {
		return true
	}
	if p.TssBackend == "gg18" {
		return false
	}
	if hasEcdsaLocalData(p.EcdsaLocalData) {
		return false
	}
	if p.ShareB64 != "" {
		return true
	}
	return false
}

func hasEcdsaLocalData(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	s := string(raw)
	return s != "null" && s != "false" && s != `""`
}

type nostrKeysignSighashFunc func(
	relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, derivationPath, sighashBase64 string,
) (string, error)

type lanKeysignSighashFunc func(
	server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64 string,
) (string, error)

type nostrKeysignRawFunc func(
	relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, message string,
) (string, error)

var (
	dklsNostrKeysignSighash nostrKeysignSighashFunc
	dklsLanKeysignSighash   lanKeysignSighashFunc
	dklsNostrKeysignRaw     nostrKeysignRawFunc
)

// RegisterDKLsKeysignHandlers wires DKLs23 keysign for Bitcoin send and PSBT signing in this package.
func RegisterDKLsKeysignHandlers(nostr nostrKeysignSighashFunc, lan lanKeysignSighashFunc, nostrRaw nostrKeysignRawFunc) {
	dklsNostrKeysignSighash = nostr
	dklsLanKeysignSighash = lan
	dklsNostrKeysignRaw = nostrRaw
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

// DispatchNostrJoinKeysign routes raw-message Nostr keysign to DKLs23 or GG18.
func DispatchNostrJoinKeysign(
	relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, derivationPath, message string,
) (string, error) {
	if IsDKLsKeyshareJSON(keyshareJSON) && dklsNostrKeysignRaw != nil {
		return dklsNostrKeysignRaw(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, message)
	}
	return NostrJoinKeysign(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, derivationPath, message)
}
