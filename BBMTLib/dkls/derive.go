package dkls

import (
	"encoding/hex"
	"fmt"
	"strings"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

// derivationPathForLibtss converts app BIP32 paths (m/84'/1'/0'/0/0) to libtss form (m/84/1/0/0/0).
// The wallet derives pubkeys from the MPC group key using non-hardened indices only; libtss rejects hardened markers.
func derivationPathForLibtss(derivationPath string) (string, error) {
	path := strings.TrimSpace(derivationPath)
	if path == "" {
		return "", nil
	}
	indices, err := tss.GetDerivePathBytes(path)
	if err != nil {
		return "", err
	}
	if len(indices) == 0 {
		return "", fmt.Errorf("empty derivation path %q", derivationPath)
	}
	parts := make([]string, len(indices))
	for i, idx := range indices {
		parts[i] = fmt.Sprintf("%d", idx)
	}
	return "m/" + strings.Join(parts, "/"), nil
}

// deriveShareForSigning returns a child key share for the BIP32 path used by the UTXO.
// chainCodeHex must match keyshare chain_code_hex (wallet HD root), not the DKG-internal chain code.
// Caller must Free() the returned handle when it differs from the parent share.
func deriveShareForSigning(share *libtss.KeyShareHandle, derivationPath, chainCodeHex string) (*libtss.KeyShareHandle, error) {
	libPath, err := derivationPathForLibtss(derivationPath)
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
