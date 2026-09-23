// Dice-only master chaincode (Spec v2.2).
// Opt-in: final = SHA256('BOLD-DICE-CHAINCODE-v1' || canonicalAllAscii).
// canonicalAllAscii = `BOLD-DICE-v1|` + sorted(perSetCommitHex).join(`|`)
//   where perSetCommitHex = SHA256Hex(`BOLD-DICE-COMMIT-v1||<sides>:<r1>,<r2>,...`).
// No baseChaincode / RNG input on the opt-in path. Empty dice set returns base
// unchanged (skip path, byte-identical). Commitments and the chaincode do not
// cross the wire; the app may exchange only `dice_` + 6 hex (checksum tag).
package tss

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
)

const (
	DiceSpecPrefix      = "BOLD-DICE-v1|"
	DiceCommitDomain    = "BOLD-DICE-COMMIT-v1"
	DiceChaincodeDomain = "BOLD-DICE-CHAINCODE-v1"
	// ChaincodeMixDomain is legacy (skip-compat only, never used on opt-in path).
	ChaincodeMixDomain = "BOLD-CHAINCODE-MIX-v1"
)

func sha256HexAscii(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// DiceCommitHexForCanonical returns SHA256Hex(`BOLD-DICE-COMMIT-v1||` + canonical).
func DiceCommitHexForCanonical(canonical string) string {
	return sha256HexAscii(DiceCommitDomain + "||" + canonical)
}

// CanonicalAllForSetCommits builds `BOLD-DICE-v1|` + sorted(commits).join(`|`).
func CanonicalAllForSetCommits(perSetCommits []string) string {
	cp := append([]string{}, perSetCommits...)
	for i := range cp {
		cp[i] = strings.ToLower(strings.TrimSpace(cp[i]))
	}
	sort.Strings(cp)
	return DiceSpecPrefix + strings.Join(cp, "|")
}

// DeriveDiceChaincodeHex derives the dice-only master chaincode from the local
// canonical dice string. canonicalAll is `BOLD-DICE-v1|` followed by per-set
// commitments sorted ascending, joined with `|`.
func DeriveDiceChaincodeHex(canonicalAll string) (string, error) {
	t := strings.TrimSpace(canonicalAll)
	if t == "" {
		return "", fmt.Errorf("no dice canonical")
	}
	if !strings.HasPrefix(t, DiceSpecPrefix) {
		return "", fmt.Errorf("bad dice prefix")
	}
	return sha256HexAscii(DiceChaincodeDomain + "||" + t), nil
}

// MixChaincodeHex is legacy skip-compat: empty diceHexCSV returns base unchanged.
// diceHexCSV is a comma-separated list of per-set commitment hex strings.
// Non-empty input is rejected: the opt-in path must use DeriveDiceChaincodeHex
// (dice-only, no base/RNG mixing). Kept so old callers compiling against the
// mixer keep byte-identical skip behavior.
func MixChaincodeHex(baseHex string, diceHexCSV string) (string, error) {
	base := strings.ToLower(strings.TrimSpace(baseHex))
	if len(base) != 64 {
		return "", fmt.Errorf("bad base chaincode")
	}
	if _, err := hex.DecodeString(base); err != nil {
		return "", fmt.Errorf("bad base chaincode hex")
	}
	csv := strings.TrimSpace(diceHexCSV)
	if csv == "" {
		return base, nil
	}
	return "", fmt.Errorf("dice mixing removed: use DeriveDiceChaincodeHex")
}
