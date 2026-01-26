package tss

import (
	"encoding/hex"
	"fmt"

	ecdsaKeygen "github.com/bnb-chain/tss-lib/v2/ecdsa/keygen"
)

type Service interface {
	KeygenECDSA(req *KeygenRequest) (*KeygenResponse, error)
	KeysignECDSA(req *KeysignRequest) (*KeysignResponse, error)
	ApplyData(string) error
}

type Messenger interface {
	Send(from, to, body string) error
}

type LocalStateAccessor interface {
	GetLocalState(pubKey string) (string, error)
	SaveLocalState(pubkey, localState string) error
}

type ServiceImpl struct {
	preParams        *ecdsaKeygen.LocalPreParams
	messenger        Messenger
	stateAccessor    LocalStateAccessor
	inboundMessageCh chan string
}

type MessageFromTss struct {
	WireBytes   []byte `json:"wire_bytes"`
	From        string `json:"from"`
	To          string `json:"to"`
	IsBroadcast bool   `json:"is_broadcast"`
}

type LocalState struct {
	PubKey              string                         `json:"pub_key"`
	ECDSALocalData      ecdsaKeygen.LocalPartySaveData `json:"ecdsa_local_data"`
	KeygenCommitteeKeys []string                       `json:"keygen_committee_keys"`
	LocalPartyKey       string                         `json:"local_party_key"`
	ChainCodeHex        string                         `json:"chain_code_hex"`
	CreatedAt           int64                          `json:"created_at"`
}

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

type KeygenRequest struct {
	LocalPartyID string
	AllParties   string
	ChainCodeHex string
}

type KeygenResponse struct {
	PubKey string `json:"pub_key"`
}

type KeysignRequest struct {
	PubKey               string `json:"pub_key"`
	MessageToSign        string `json:"message_to_sign"` // base64 encoded
	KeysignCommitteeKeys string `json:"keysign_committee_keys"`
	LocalPartyKey        string `json:"local_party_key"`
	DerivePath           string `json:"derive_path"`
}

type KeysignResponse struct {
	Msg          string `json:"msg"`
	MsgHex       string `json:"msg_hex"`
	R            string `json:"r"`
	S            string `json:"s"`
	DerSignature string `json:"der_signature"`
	RecoveryID   string `json:"recovery_id"`
}

type FeeResponse struct {
	FastestFee  int `json:"fastestFee"`
	HalfHourFee int `json:"halfHourFee"`
	HourFee     int `json:"hourFee"`
	EconomyFee  int `json:"economyFee"`
	MinimumFee  int `json:"minimumFee"`
}
