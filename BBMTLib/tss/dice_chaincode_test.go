package tss

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func diceOnlyRef(t *testing.T, canonicalAll string) string {
	t.Helper()
	h := sha256.New()
	h.Write([]byte("BOLD-DICE-CHAINCODE-v1"))
	h.Write([]byte("||"))
	h.Write([]byte(canonicalAll))
	return hex.EncodeToString(h.Sum(nil))
}

func TestDeriveDiceChaincodeHexVector(t *testing.T) {
	// Shared with TS: commit = SHA256("BOLD-DICE-COMMIT-v1||6:1,2,3")
	commit := "1ff5e30664dacfdf237ba1ddf5ce7e2a2ad3673cb7933e5224e31428abf7a331"
	if got := DiceCommitHexForCanonical("6:1,2,3"); got != commit {
		t.Fatalf("commit mismatch: got %s", got)
	}
	canon := "BOLD-DICE-v1|" + commit
	wantChain := "e28343733d5fde91a0697e7a4f1e5a6a135abdf8d21f5fb3db7aa0a9c6aa331a"
	out, err := DeriveDiceChaincodeHex(canon)
	if err != nil {
		t.Fatal(err)
	}
	if out != wantChain {
		t.Fatalf("chaincode mismatch: got %s want %s", out, wantChain)
	}
	legacy := "BOLD-DICE-v1|6:3,1,6"
	legacyOut, err := DeriveDiceChaincodeHex(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if want := diceOnlyRef(t, legacy); legacyOut != want {
		t.Fatalf("mismatch: got %s want %s", legacyOut, want)
	}
}

func TestDeriveDiceChaincodeIgnoresBase(t *testing.T) {
	canon := "BOLD-DICE-v1|6:1,2,3"
	a, err := DeriveDiceChaincodeHex(canon)
	if err != nil {
		t.Fatal(err)
	}
	if a == strings.Repeat("ab", 32) {
		t.Fatalf("dice-only output must not equal base")
	}
	if _, err := DeriveDiceChaincodeHex(""); err == nil {
		t.Fatalf("expected error for empty canonical")
	}
	if _, err := DeriveDiceChaincodeHex("WRONG|6:1"); err == nil {
		t.Fatalf("expected error for bad prefix")
	}
}

func TestMixChaincodeHexSkipPath(t *testing.T) {
	base := strings.Repeat("ab", 32)
	out, err := MixChaincodeHex(base, "")
	if err != nil {
		t.Fatal(err)
	}
	if out != strings.ToLower(base) {
		t.Fatalf("skip path must return base unchanged, got %s", out)
	}
}

func TestMixChaincodeHexRejectsBadInput(t *testing.T) {
	if _, err := MixChaincodeHex("zz", ""); err == nil {
		t.Fatalf("expected error for bad base")
	}
	base := strings.Repeat("22", 32)
	if _, err := MixChaincodeHex(base, "nothex"); err == nil {
		t.Fatalf("expected error for bad digest")
	}
}
