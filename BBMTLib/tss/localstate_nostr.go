package tss

import (
	"encoding/hex"
	"fmt"
)

// LocalStateNostr wraps LocalState with the extra nostr credentials.
type LocalStateNostr struct {
	LocalState
	NostrNpub string `json:"nostr_npub"`
	NsecHex   string `json:"nsec"` // nsec in hex format
}

// SetNsec stores the raw nsec as hex.
func (l *LocalStateNostr) SetNsec(rawNsec string) error {
	if rawNsec == "" {
		return fmt.Errorf("nsec cannot be empty")
	}
	// Convert nsec string to hex
	l.NsecHex = hex.EncodeToString([]byte(rawNsec))
	return nil
}

// GetNsec returns the stored nsec by decoding from hex.
func (l *LocalStateNostr) GetNsec() (string, error) {
	if l.NsecHex == "" {
		return "", fmt.Errorf("nsec is empty")
	}
	// Decode hex to get the raw nsec
	rawNsec, err := hex.DecodeString(l.NsecHex)
	if err != nil {
		return "", fmt.Errorf("decode hex: %w", err)
	}
	return string(rawNsec), nil
}
