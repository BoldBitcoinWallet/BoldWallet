package tss

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/big"
	"runtime/debug"
	"strconv"
	"strings"

	tcrypto "github.com/bnb-chain/tss-lib/v2/crypto"
	"github.com/bnb-chain/tss-lib/v2/crypto/ckd"
	"github.com/bnb-chain/tss-lib/v2/tss"
	"github.com/btcsuite/btcd/btcec/v2"
	btcecdsa "github.com/btcsuite/btcd/btcec/v2/ecdsa"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/decred/dcrd/dcrec/edwards/v2"
)

type ecdsaSignature struct {
	R, S *big.Int
}

const MaxUint32 = ^uint32(0)

// GetThreshold calculates the threshold value based on the input value.
// It takes an integer value as input and returns the threshold value and an error.
// If the input value is negative, it returns an error with the message "invalid input".
func GetThreshold(value int) (int, error) {
	if value < 2 {
		return 0, errors.New("invalid input")
	}
	threshold := int(math.Ceil(float64(value)*2.0/3.0)) - 1
	return threshold, nil
}

// GetHexEncodedPubKey returns the hexadecimal encoded string representation of an ECDSA/EDDSA public key.
// It takes a pointer to an ECPoint as input and returns the encoded string and an error.
// If the ECPoint is nil, it returns an empty string and an error indicating a nil ECPoint.
// If the ECPoint is not on the curve, it returns an empty string and an error indicating an invalid ECPoint.
func GetHexEncodedPubKey(pubKey *tcrypto.ECPoint) (string, error) {
	if pubKey == nil {
		return "", errors.New("nil ECPoint")
	}
	if !pubKey.IsOnCurve() {
		return "", errors.New("invalid ECPoint")
	}
	var pubKeyBytes []byte

	if pubKey.Curve().Params().Name == "secp256k1" {
		pubKeyBytes = elliptic.MarshalCompressed(pubKey.Curve(), pubKey.X(), pubKey.Y())
	} else { // EdDSA
		_, isEdDSA := pubKey.Curve().(*edwards.TwistedEdwardsCurve)
		if !isEdDSA {
			return "", errors.New("invalid curve type")
		}
		ePublicKey := edwards.NewPublicKey(pubKey.X(), pubKey.Y())
		pubKeyBytes = ePublicKey.SerializeCompressed()
	}
	return hex.EncodeToString(pubKeyBytes), nil
}

// Contains checks if a given string slice contains a specific search term.
// It iterates through the slice and returns true if the search term is found, false otherwise.
func Contains(s []string, searchterm string) bool {
	for _, item := range s {
		if item == searchterm {
			return true
		}
	}
	return false
}

// HashToInt converts a byte slice hash to a big.Int value using the provided elliptic curve.
// If the length of the hash is greater than the orderBytes of the curve, it truncates the hash.
// It then performs a right shift on the resulting big.Int value to ensure it fits within the orderBits of the curve.
// The converted big.Int value is returned.
func HashToInt(hash []byte, c elliptic.Curve) *big.Int {
	orderBits := c.Params().N.BitLen()
	orderBytes := (orderBits + 7) / 8
	if len(hash) > orderBytes {
		hash = hash[:orderBytes]
	}

	ret := new(big.Int).SetBytes(hash)
	excess := len(hash)*8 - orderBits
	if excess > 0 {
		ret.Rsh(ret, uint(excess))
	}
	return ret
}

// EncodeXpub encodes a public key and chain code into xpub/tpub format for watch-only wallets (Sparrow, etc.)
// It derives to the BIP44 account level (m/44/0/0) so Sparrow can derive /0/x for addresses.
// hexPubKey: compressed public key in hex (33 bytes / 66 chars) - the master public key
// hexChainCode: chain code in hex (32 bytes / 64 chars) - the master chain code
// network: "mainnet" or "testnet3"
// Returns: xpub (mainnet) or tpub (testnet) encoded string at account level m/44/0/0
func EncodeXpub(hexPubKey, hexChainCode, network string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in EncodeXpub: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	if len(hexPubKey) == 0 {
		return "", errors.New("empty pub key")
	}
	if len(hexChainCode) == 0 {
		return "", errors.New("empty chain code")
	}

	pubKeyBuf, err := hex.DecodeString(hexPubKey)
	if err != nil {
		return "", fmt.Errorf("decode hex pub key failed: %w", err)
	}
	if len(pubKeyBuf) != 33 {
		return "", errors.New("invalid public key length, expected 33 bytes")
	}

	chainCodeBuf, err := hex.DecodeString(hexChainCode)
	if err != nil {
		return "", fmt.Errorf("decode hex chain code failed: %w", err)
	}
	if len(chainCodeBuf) != 32 {
		return "", errors.New("invalid chain code length, expected 32 bytes")
	}

	// Select network parameters
	var net *chaincfg.Params
	if network == "mainnet" {
		net = &chaincfg.MainNetParams
	} else {
		net = &chaincfg.TestNet3Params
	}

	// Parse the master public key
	masterPubKey, err := btcec.ParsePubKey(pubKeyBuf)
	if err != nil {
		return "", fmt.Errorf("parse pub key failed: %w", err)
	}

	// Create EC point for derivation
	curve := tss.S256()
	ecPoint, err := tcrypto.NewECPoint(curve, masterPubKey.X(), masterPubKey.Y())
	if err != nil {
		return "", fmt.Errorf("new ec point failed: %w", err)
	}

	// Derive to account level (non-hardened, as we're deriving from public key)
	// For mainnet: m/44/0/0, for testnet: m/44/1/0
	// Note: These are non-hardened because we're deriving from a public key
	// The logical BIP44 path is 44'/coinType'/0' (hardened), but we derive non-hardened
	coinType := uint32(0) // mainnet
	if network == "testnet" || network == "testnet3" {
		coinType = uint32(1) // testnet
	}
	accountPath := []uint32{44, coinType, 0}
	Logf("EncodeXpub: Deriving to account level m/44/%d/0 (network: %s)", coinType, network)
	_, accountKey, err := derivingPubkeyFromPath(ecPoint, chainCodeBuf, accountPath, curve)
	if err != nil {
		return "", fmt.Errorf("deriving to account path failed: %w", err)
	}

	// Build the extended public key at account level
	// Format: version(4) + depth(1) + fingerprint(4) + childIndex(4) + chainCode(32) + pubKey(33) = 78 bytes
	var serialized [78]byte

	// Version bytes (xpub or tpub)
	copy(serialized[0:4], net.HDPublicKeyID[:])

	// Depth: 3 for account level (m/44/0/0)
	serialized[4] = 3

	// Parent fingerprint: we use zeros since we don't track the parent
	copy(serialized[5:9], []byte{0x00, 0x00, 0x00, 0x00})

	// Child index: 0 (last component of m/44/0/0)
	copy(serialized[9:13], []byte{0x00, 0x00, 0x00, 0x00})

	// Chain code from the derived key (32 bytes)
	copy(serialized[13:45], accountKey.ChainCode)

	// Public key from the derived key (33 bytes, compressed)
	derivedPubKey := elliptic.MarshalCompressed(curve, accountKey.X, accountKey.Y)
	copy(serialized[45:78], derivedPubKey)

	// Base58Check encode
	return base58CheckEncode(serialized[:]), nil
}

// base58CheckEncode encodes a byte slice using Base58Check encoding (used for Bitcoin addresses and xpub)
func base58CheckEncode(input []byte) string {
	// Double SHA256 for checksum
	firstHash := sha256.Sum256(input)
	secondHash := sha256.Sum256(firstHash[:])
	checksum := secondHash[:4]

	// Append checksum
	full := append(input, checksum...)

	// Base58 encode
	return base58Encode(full)
}

// base58Encode encodes a byte slice to Base58 (Bitcoin alphabet)
func base58Encode(input []byte) string {
	const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

	// Count leading zeros
	leadingZeros := 0
	for _, b := range input {
		if b == 0 {
			leadingZeros++
		} else {
			break
		}
	}

	// Convert to big integer
	num := new(big.Int).SetBytes(input)
	base := big.NewInt(58)
	zero := big.NewInt(0)
	mod := new(big.Int)

	var encoded []byte
	for num.Cmp(zero) > 0 {
		num.DivMod(num, base, mod)
		encoded = append([]byte{alphabet[mod.Int64()]}, encoded...)
	}

	// Add leading '1's for each leading zero byte
	for i := 0; i < leadingZeros; i++ {
		encoded = append([]byte{'1'}, encoded...)
	}

	return string(encoded)
}

func GetDerivedPubKey(hexPubKey, hexChainCode, path string, isEdDSA bool) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in GetDerivedPubKey: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	if isEdDSA {
		return "", errors.New("don't support to derive pubkey for EdDSA now")
	}
	if len(hexPubKey) == 0 {
		return "", errors.New("empty pub key")
	}
	if len(hexChainCode) == 0 {
		return "", errors.New("empty chain code")
	}
	if len(path) == 0 {
		return "", errors.New("empty path")
	}
	pubKeyBuf, err := hex.DecodeString(hexPubKey)
	if err != nil {
		return "", fmt.Errorf("decode hex pub key failed: %w", err)
	}
	chainCodeBuf, err := hex.DecodeString(hexChainCode)
	if err != nil {
		return "", fmt.Errorf("decode hex chain code failed: %w", err)
	}
	if len(chainCodeBuf) != 32 {
		return "", errors.New("invalid chain code length")
	}
	curve := tss.S256()
	// elliptic.UnmarshalCompressed doesn't work, probably because of a curve
	// thus here we use btcec.ParsePubKey to unmarshal the compressed public key
	pubKey, err := btcec.ParsePubKey(pubKeyBuf)
	if err != nil {
		return "", fmt.Errorf("parse pub key failed: %w", err)
	}

	ecPoint, err := tcrypto.NewECPoint(curve, pubKey.X(), pubKey.Y())
	if err != nil {
		return "", fmt.Errorf("new ec point failed: %w", err)
	}

	pathBuf, err := GetDerivePathBytes(path)
	if err != nil {
		return "", fmt.Errorf("get derive path bytes failed: %w", err)
	}
	_, extendedKey, err := derivingPubkeyFromPath(ecPoint, chainCodeBuf, pathBuf, curve)
	if err != nil {
		return "", fmt.Errorf("deriving pubkey from path failed: %w", err)
	}
	return hex.EncodeToString(elliptic.MarshalCompressed(curve, extendedKey.X, extendedKey.Y)), nil
}

func derivingPubkeyFromPath(masterPub *tcrypto.ECPoint, chainCode []byte, path []uint32, ec elliptic.Curve) (*big.Int, *ckd.ExtendedKey, error) {
	// build ecdsa key pair
	pk := ecdsa.PublicKey{
		Curve: ec,
		X:     masterPub.X(),
		Y:     masterPub.Y(),
	}

	net := &chaincfg.MainNetParams
	extendedParentPk := &ckd.ExtendedKey{
		PublicKey:  pk,
		Depth:      0,
		ChildIndex: 0,
		ChainCode:  chainCode[:],
		ParentFP:   []byte{0x00, 0x00, 0x00, 0x00},
		Version:    net.HDPrivateKeyID[:],
	}

	return ckd.DeriveChildKeyFromHierarchy(path, extendedParentPk, ec.Params().N, ec)
}

func GetDerivePathBytes(derivePath string) ([]uint32, error) {
	var pathBuf []uint32
	for _, item := range strings.Split(derivePath, "/") {
		if len(item) == 0 {
			continue
		}
		if item == "m" {
			continue
		}
		result := strings.Trim(item, "'")
		intResult, err := strconv.Atoi(result)
		if err != nil {
			return nil, fmt.Errorf("invalid path: %w", err)
		}
		if intResult < 0 || intResult > int(math.MaxInt) {
			return nil, fmt.Errorf("integer value %d cannot fit into a uint32", intResult)
		}
		pathBuf = append(pathBuf, uint32(intResult))
	}
	return pathBuf, nil
}

// DerivationPathForLibtss converts wallet/PSBT paths (m/84'/1'/0'/0/0) to libtss form (m/84/1/0/0/0).
// Pubkey derivation from the MPC group key uses non-hardened indices; libtss rejects hardened markers.
func DerivationPathForLibtss(derivationPath string) (string, error) {
	path := strings.TrimSpace(derivationPath)
	if path == "" {
		return "", nil
	}
	indices, err := GetDerivePathBytes(path)
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

func GetDERSignature(r, s *big.Int) ([]byte, error) {
	der, err := asn1.Marshal(ecdsaSignature{
		R: r,
		S: s,
	})
	if err != nil {
		return nil, err
	}
	return CanonicalizeDERSignature(der)
}

// CanonicalizeDERSignature returns BIP-143/Bitcoin-standard low-S DER encoding.
func CanonicalizeDERSignature(der []byte) ([]byte, error) {
	if len(der) == 0 {
		return nil, fmt.Errorf("empty DER signature")
	}
	sig, err := btcecdsa.ParseDERSignature(der)
	if err != nil {
		return nil, fmt.Errorf("parse DER signature: %w", err)
	}
	return sig.Serialize(), nil
}

func hexToBytes(s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		Logf("ERROR: invalid hex: %s, error: %v", s, err)
		// Return empty bytes instead of panicking to prevent app crashes
		return []byte{}
	}
	return b
}

func Sha256(msg string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in Sha256: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	hash := sha256.New()
	hash.Write([]byte(msg))
	hashBytes := hash.Sum(nil)
	return hex.EncodeToString(hashBytes), nil
}

func SecureRandom(length int) (string, error) {
	bytes := make([]byte, (length+1)/2)
	_, err := rand.Read(bytes)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", bytes)[:length], nil
}

// GetOutputDescriptor generates a wallet output descriptor for watch-only wallet import (Sparrow, etc.)
// hexPubKey: compressed master public key in hex (33 bytes / 66 chars)
// hexChainCode: master chain code in hex (32 bytes / 64 chars)
// network: "mainnet" or "testnet3"
// addressType: "legacy", "segwit-native", or "segwit-compatible"
// Returns: checksummed output descriptor (pkh / wpkh / sh(wpkh) with #suffix per BIP 380)
func GetOutputDescriptor(hexPubKey, hexChainCode, network, addressType string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in GetOutputDescriptor: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	if len(hexPubKey) == 0 {
		return "", errors.New("empty pub key")
	}
	if len(hexChainCode) == 0 {
		return "", errors.New("empty chain code")
	}

	pubKeyBuf, err := hex.DecodeString(hexPubKey)
	if err != nil {
		return "", fmt.Errorf("decode hex pub key failed: %w", err)
	}
	if len(pubKeyBuf) != 33 {
		return "", errors.New("invalid public key length, expected 33 bytes")
	}

	// Compute master fingerprint: HASH160(master_pubkey)[0:4]
	// HASH160 = RIPEMD160(SHA256(data))
	hash160 := btcutil.Hash160(pubKeyBuf)
	fingerprint := hex.EncodeToString(hash160[:4])

	// Determine coin type and BIP path based on network and address type
	coinType := uint32(0) // mainnet
	if network == "testnet" || network == "testnet3" {
		coinType = uint32(1) // testnet
	}

	// Determine BIP path based on address type
	var bipPath uint32
	var coinTypeStr string
	switch addressType {
	case "segwit-native":
		bipPath = 84 // BIP84
		coinTypeStr = "1'"
		if coinType == 0 {
			coinTypeStr = "0'"
		}
	case "segwit-compatible":
		bipPath = 49 // BIP49
		coinTypeStr = "1'"
		if coinType == 0 {
			coinTypeStr = "0'"
		}
	case "legacy":
		fallthrough
	default:
		bipPath = 44 // BIP44
		coinTypeStr = "1'"
		if coinType == 0 {
			coinTypeStr = "0'"
		}
	}

	// Derive xpub to the correct BIP account level (non-hardened, as we're deriving from public key)
	// Parse the master public key
	masterPubKey, err := btcec.ParsePubKey(pubKeyBuf)
	if err != nil {
		return "", fmt.Errorf("parse pub key failed: %w", err)
	}

	chainCodeBuf, err := hex.DecodeString(hexChainCode)
	if err != nil {
		return "", fmt.Errorf("decode hex chain code failed: %w", err)
	}
	if len(chainCodeBuf) != 32 {
		return "", errors.New("invalid chain code length, expected 32 bytes")
	}

	// Create EC point for derivation
	curve := tss.S256()
	ecPoint, err := tcrypto.NewECPoint(curve, masterPubKey.X(), masterPubKey.Y())
	if err != nil {
		return "", fmt.Errorf("new ec point failed: %w", err)
	}

	// Derive to account level for the specific BIP path (non-hardened)
	accountPath := []uint32{bipPath, coinType, 0}
	Logf("GetOutputDescriptor: Deriving to account level m/%d/%d/0 (network: %s, addressType: %s)", bipPath, coinType, network, addressType)
	_, accountKey, err := derivingPubkeyFromPath(ecPoint, chainCodeBuf, accountPath, curve)
	if err != nil {
		return "", fmt.Errorf("deriving to account path failed: %w", err)
	}

	// Select network parameters for xpub encoding
	var net *chaincfg.Params
	if network == "mainnet" {
		net = &chaincfg.MainNetParams
	} else {
		net = &chaincfg.TestNet3Params
	}

	// Build the extended public key at account level
	// Format: version(4) + depth(1) + fingerprint(4) + childIndex(4) + chainCode(32) + pubKey(33) = 78 bytes
	var serialized [78]byte

	// Version bytes (xpub or tpub)
	copy(serialized[0:4], net.HDPublicKeyID[:])

	// Depth: 3 for account level (m/bipPath/coinType/0)
	serialized[4] = 3

	// Parent fingerprint: we use zeros since we don't track the parent
	copy(serialized[5:9], []byte{0x00, 0x00, 0x00, 0x00})

	// Child index: 0 (last component of m/bipPath/coinType/0)
	copy(serialized[9:13], []byte{0x00, 0x00, 0x00, 0x00})

	// Chain code from the derived key (32 bytes)
	copy(serialized[13:45], accountKey.ChainCode)

	// Public key from the derived key (33 bytes, compressed)
	derivedPubKey := elliptic.MarshalCompressed(curve, accountKey.X, accountKey.Y)
	copy(serialized[45:78], derivedPubKey)

	// Base58Check encode to get xpub
	xpub := base58CheckEncode(serialized[:])

	// Build output descriptor based on address type
	// The path shown uses ' for hardened derivation in descriptor notation
	// Since we derive non-hardened from master pubkey, we show the logical path
	var descriptor string
	switch addressType {
	case "segwit-native":
		// Native SegWit P2WPKH (BIP84 m/84'/coinType'/0')
		descriptor = fmt.Sprintf("wpkh([%s/84'/%s/0']%s/0/*)", fingerprint, coinTypeStr, xpub)
	case "segwit-compatible":
		// SegWit compatible P2SH-P2WPKH (BIP49 m/49'/coinType'/0')
		descriptor = fmt.Sprintf("sh(wpkh([%s/49'/%s/0']%s/0/*))", fingerprint, coinTypeStr, xpub)
	case "legacy":
		fallthrough
	default:
		// Legacy P2PKH (BIP44 m/44'/coinType'/0')
		descriptor = fmt.Sprintf("pkh([%s/44'/%s/0']%s/0/*)", fingerprint, coinTypeStr, xpub)
	}

	return AddDescriptorChecksum(descriptor)
}
