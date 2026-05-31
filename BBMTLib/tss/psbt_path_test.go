package tss

import (
	"testing"

	"github.com/btcsuite/btcd/btcutil/psbt"
)

func TestDerivationPathForLibtssFromPSBTPath(t *testing.T) {
	// formatBip32Path emits hardened notation as in PSBT Bip32Derivation
	hardened := formatBip32Path([]uint32{
		84 + 0x80000000,
		1 + 0x80000000,
		0 + 0x80000000,
		0,
		0,
	})
	if hardened != "m/84'/1'/0'/0/0" {
		t.Fatalf("formatBip32Path: got %q", hardened)
	}
	libPath, err := DerivationPathForLibtss(hardened)
	if err != nil {
		t.Fatal(err)
	}
	if libPath != "m/84/1/0/0/0" {
		t.Fatalf("DerivationPathForLibtss: got %q want m/84/1/0/0/0", libPath)
	}
}

func TestResolveInputDerivePathRelativeToXpub(t *testing.T) {
	packet := &psbt.Packet{
		XPubs: []psbt.XPub{
			{Bip32Path: []uint32{84 + 0x80000000, 1 + 0x80000000, 0 + 0x80000000}},
		},
	}
	full := resolveInputDerivePath(packet, []uint32{0, 0})
	want := "m/84'/1'/0'/0/0"
	if full != want {
		t.Fatalf("relative path: got %q want %q", full, want)
	}
}

func TestResolveInputDerivePathKeepsFullPath(t *testing.T) {
	packet := &psbt.Packet{}
	path := []uint32{
		84 + 0x80000000,
		1 + 0x80000000,
		0 + 0x80000000,
		0,
		1,
	}
	full := resolveInputDerivePath(packet, path)
	want := "m/84'/1'/0'/0/1"
	if full != want {
		t.Fatalf("full path: got %q want %q", full, want)
	}
}

func TestPathCandidatesSparrowRelativeWithoutXPubs(t *testing.T) {
	_btc_net = "testnet3"
	packet := &psbt.Packet{} // no XPubs — common in Sparrow PSBTs
	candidates := pathCandidates(packet, []uint32{0, 1})
	want := "m/84'/1'/0'/0/1"
	found := false
	for _, c := range candidates {
		if c == want {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected %q in candidates, got %v", want, candidates)
	}
}

func TestPathCandidatesSingleIndex(t *testing.T) {
	_btc_net = "testnet3"
	packet := &psbt.Packet{}
	candidates := pathCandidates(packet, []uint32{3})
	if !containsPath(candidates, "m/84'/1'/0'/0/3") && !containsPath(candidates, "m/3") {
		t.Fatalf("expected account-prefixed or raw path for index 3, got %v", candidates)
	}
}

func TestPathCandidatesSparrowBIP44RelativeWithoutXPubs(t *testing.T) {
	_btc_net = "testnet3"
	packet := &psbt.Packet{}
	candidates := pathCandidates(packet, []uint32{0, 1})
	want := "m/44'/1'/0'/0/1"
	if !containsPath(candidates, want) {
		t.Fatalf("expected %q in candidates for legacy-path Sparrow PSBT, got %v", want, candidates)
	}
}

func TestEnumerateStandardWalletPathsIncludesBIP44(t *testing.T) {
	_btc_net = "testnet3"
	paths := enumerateStandardWalletPaths(0)
	if !containsPath(paths, "m/44'/1'/0'/0/0") {
		t.Fatalf("expected BIP44 receive path in enumeration, got sample %v", paths[:min(6, len(paths))])
	}
}

func containsPath(paths []string, want string) bool {
	for _, p := range paths {
		if p == want {
			return true
		}
	}
	return false
}
