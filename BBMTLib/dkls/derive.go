package dkls

import (
	"encoding/hex"
	"fmt"
	"strings"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

// deriveShareForSigning returns a child key share for the BIP32 path used by the UTXO.
// chainCodeHex must match keyshare chain_code_hex (wallet HD root), not the DKG-internal chain code.
// Caller must Free() the returned handle when it differs from the parent share.
func deriveShareForSigning(share *libtss.KeyShareHandle, derivationPath, chainCodeHex string) (*libtss.KeyShareHandle, error) {
	libPath, err := tss.DerivationPathForLibtss(derivationPath)
	if err != nil {
		return nil, err
	}
	if libPath == "" {
		return share, nil
	}
	chainCode, err := hex.DecodeString(strings.TrimSpace(chainCodeHex))
	if err != nil {
		return nil, fmt.Errorf("decode chain_code_hex: %w", err)
	}
	if len(chainCode) != 32 {
		return nil, fmt.Errorf("chain_code_hex must be 32 bytes, got %d", len(chainCode))
	}
	derived, err := libtss.DerivePathWithChainCode(share, libPath, chainCode)
	if err != nil {
		return nil, fmt.Errorf("derive key share for path %q: %w", libPath, err)
	}
	return derived, nil
}
