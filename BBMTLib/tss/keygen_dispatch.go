package tss

import (
	"fmt"
	"strings"
)

// TssBackend identifies the MPC stack for keygen dispatch.
type TssBackend string

const (
	BackendGG18   TssBackend = "gg18"
	BackendDKLs23 TssBackend = "dkls23"
)

// ParseTssBackend normalizes backend strings ("dkls" → dkls23).
func ParseTssBackend(raw string) (TssBackend, error) {
	s := strings.TrimSpace(strings.ToLower(raw))
	switch s {
	case "", string(BackendGG18):
		return BackendGG18, nil
	case string(BackendDKLs23), "dkls":
		return BackendDKLs23, nil
	default:
		return "", fmt.Errorf("unknown MPC backend %q (want gg18 or dkls23)", raw)
	}
}

type lanKeygenFunc func(
	key, partiesCSV, session, server, chaincode, sessionKey, encKey, decKey string,
) (string, error)

type nostrKeygenFunc func(
	relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, chaincode string,
) (string, error)

var (
	dklsLanKeygen   lanKeygenFunc
	dklsNostrKeygen nostrKeygenFunc
)

// RegisterDKLsKeygenHandlers wires DKLs23 LAN/Nostr keygen into this package.
func RegisterDKLsKeygenHandlers(lan lanKeygenFunc, nostr nostrKeygenFunc) {
	dklsLanKeygen = lan
	dklsNostrKeygen = nostr
}

// DispatchJoinKeygen runs LAN DKG for the requested backend.
// GG18 requires ppmPath; DKLs23 uses chaincode as the session seed argument from mobile.
func DispatchJoinKeygen(
	backend string,
	ppmPath, key, partiesCSV, encKey, decKey, session, server, chaincode, sessionKey string,
) (string, error) {
	b, err := ParseTssBackend(backend)
	if err != nil {
		return "", err
	}
	switch b {
	case BackendDKLs23:
		if dklsLanKeygen == nil {
			return "", fmt.Errorf("DKLs23 LAN keygen not registered")
		}
		return dklsLanKeygen(key, partiesCSV, session, server, chaincode, sessionKey, encKey, decKey)
	default:
		return JoinKeygen(ppmPath, key, partiesCSV, encKey, decKey, session, server, chaincode, sessionKey)
	}
}

// DispatchNostrJoinKeygen runs Nostr DKG for the requested backend.
func DispatchNostrJoinKeygen(
	backend string,
	relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, chaincode, ppmPath string,
) (string, error) {
	b, err := ParseTssBackend(backend)
	if err != nil {
		return "", err
	}
	switch b {
	case BackendDKLs23:
		if dklsNostrKeygen == nil {
			return "", fmt.Errorf("DKLs23 Nostr keygen not registered")
		}
		return dklsNostrKeygen(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, chaincode)
	default:
		return NostrJoinKeygen(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, chaincode, ppmPath)
	}
}
