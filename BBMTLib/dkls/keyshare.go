package dkls

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/nbd-wtf/go-nostr/nip19"
)

// KeyshareJSON is the on-disk / app keyshare format for DKLs23 wallets.
type KeyshareJSON struct {
	TssBackend          string   `json:"tss_backend"`
	Suite               int      `json:"suite"`
	PubKey              string   `json:"pub_key"`
	ChainCodeHex        string   `json:"chain_code_hex"`
	LocalPartyKey       string   `json:"local_party_key"`
	KeygenCommitteeKeys []string `json:"keygen_committee_keys"`
	ShareB64            string   `json:"share_b64"`
	CreatedAt           int64    `json:"created_at"`
	NostrNpub           string   `json:"nostr_npub,omitempty"`
	NsecHex             string   `json:"nsec,omitempty"`
}

// KeyshareJSONFromHandle exports a libtss handle into BoldWallet keyshare JSON.
func KeyshareJSONFromHandle(share *libtss.KeyShareHandle, chainCodeHex string, committee []string, localParty string, nostrNpub, nsecHex string) (string, error) {
	exported, err := libtss.ExportKeyShare(share)
	if err != nil {
		return "", err
	}
	groupKey, err := share.GroupKey()
	if err != nil {
		return "", err
	}
	ks := KeyshareJSON{
		TssBackend:          BackendName,
		Suite:               SuiteID,
		PubKey:              hex.EncodeToString(groupKey),
		ChainCodeHex:        chainCodeHex,
		LocalPartyKey:       localParty,
		KeygenCommitteeKeys: committee,
		ShareB64:            base64.StdEncoding.EncodeToString(exported),
		CreatedAt:           time.Now().UnixMilli(),
		NostrNpub:           nostrNpub,
		NsecHex:             nsecHex,
	}
	raw, err := json.Marshal(ks)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// normalizeBech32Nsec accepts bech32 nsec1… or hex sk (nostr.GeneratePrivateKey format).
func normalizeBech32Nsec(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("nsec cannot be empty")
	}
	if strings.HasPrefix(raw, "nsec1") {
		return raw, nil
	}
	if _, err := hex.DecodeString(raw); err != nil {
		return "", fmt.Errorf("unrecognized nsec format")
	}
	// Match mobile / GG18 scripts: store hex(utf8(nsec1)), not hex(utf8(hex-sk)).
	return nip19.EncodePrivateKey(raw)
}

// NsecFieldForKeyshareJSON stores a bech32 nsec in the keyshare JSON field using the
// same encoding as GG18 LocalStateNostr.SetNsec (hex of UTF-8 bytes of the nsec string).
func NsecFieldForKeyshareJSON(nsec string) (string, error) {
	bech32, err := normalizeBech32Nsec(nsec)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString([]byte(bech32)), nil
}

// NsecFromKeyshareField decodes the stored nsec field back to bech32 (nsec1…).
func NsecFromKeyshareField(stored string) (string, error) {
	if stored == "" {
		return "", fmt.Errorf("nsec is empty")
	}
	if strings.HasPrefix(stored, "nsec1") {
		return stored, nil
	}
	raw, err := hex.DecodeString(stored)
	if err != nil {
		return "", fmt.Errorf("decode nsec hex: %w", err)
	}
	out := string(raw)
	if !strings.HasPrefix(out, "nsec1") {
		return "", fmt.Errorf("invalid nsec format in keyshare")
	}
	return out, nil
}

// ImportKeyshare loads a DKLs23 keyshare from JSON.
func ImportKeyshare(jsonStr string) (*libtss.KeyShareHandle, *KeyshareJSON, error) {
	var ks KeyshareJSON
	if err := json.Unmarshal([]byte(jsonStr), &ks); err != nil {
		return nil, nil, err
	}
	if ks.TssBackend != BackendName && ks.TssBackend != "" {
		return nil, nil, fmt.Errorf("unsupported tss_backend %q", ks.TssBackend)
	}
	data, err := base64.StdEncoding.DecodeString(ks.ShareB64)
	if err != nil {
		return nil, nil, fmt.Errorf("decode share_b64: %w", err)
	}
	defer clear(data)
	share, err := libtss.ImportKeyShare(libtss.CiphersuiteSecp256k1ECDSA, data)
	if err != nil {
		return nil, nil, err
	}
	return share, &ks, nil
}

// ValidateKeyshareFile checks a keyshare JSON file has required DKLs23 fields.
func ValidateKeyshareFile(path string) error {
	raw, err := readFile(path)
	if err != nil {
		return err
	}
	var ks KeyshareJSON
	if err := json.Unmarshal(raw, &ks); err != nil {
		return err
	}
	if ks.PubKey == "" {
		return fmt.Errorf("missing pub_key")
	}
	if ks.ShareB64 == "" {
		return fmt.Errorf("missing share_b64")
	}
	if ks.TssBackend != "" && ks.TssBackend != BackendName {
		return fmt.Errorf("unexpected tss_backend %q", ks.TssBackend)
	}
	return nil
}

func readFile(path string) ([]byte, error) {
	return readFileOS(path)
}
