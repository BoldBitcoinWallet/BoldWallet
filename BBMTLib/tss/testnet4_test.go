package tss

// Pins for the testnet3 -> testnet4 migration (local TestNet4Params
// + network-key aliases). Address-layer identity with testnet3 is
// the property the whole migration leans on: same HRP, version
// bytes, and HD magics, so existing tb1.../tpub fixtures stay
// valid and only Name/Net/Port identify testnet4.

import (
	"testing"

	"github.com/btcsuite/btcd/chaincfg"
)

func TestTestNet4ParamsIdentity(t *testing.T) {
	if TestNet4Params.Name != "testnet4" {
		t.Fatalf("Name = %q, want testnet4", TestNet4Params.Name)
	}
	if uint32(TestNet4Params.Net) != 0x283f161c {
		t.Fatalf("Net = %#x, want 0x283f161c (wire.TestNet4)", uint32(TestNet4Params.Net))
	}
	if TestNet4Params.DefaultPort != "48333" {
		t.Fatalf("DefaultPort = %q, want 48333", TestNet4Params.DefaultPort)
	}
}

func TestTestNet4AddressLayerMatchesTestNet3(t *testing.T) {
	t3 := chaincfg.TestNet3Params
	t4 := TestNet4Params
	if t4.Bech32HRPSegwit != t3.Bech32HRPSegwit {
		t.Fatalf("HRP %q != testnet3 %q", t4.Bech32HRPSegwit, t3.Bech32HRPSegwit)
	}
	if t4.PubKeyHashAddrID != t3.PubKeyHashAddrID ||
		t4.ScriptHashAddrID != t3.ScriptHashAddrID ||
		t4.PrivateKeyID != t3.PrivateKeyID {
		t.Fatal("address version bytes differ from testnet3")
	}
	if t4.HDPrivateKeyID != t3.HDPrivateKeyID ||
		t4.HDPublicKeyID != t3.HDPublicKeyID {
		t.Fatal("HD magics differ from testnet3")
	}
	if t4.HDCoinType != t3.HDCoinType {
		t.Fatal("HDCoinType differs from testnet3")
	}
}

func TestNormalizeNetworkAliases(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"mainnet", "mainnet"},
		{"testnet4", "testnet4"},
		{"testnet", "testnet4"},
		{"testnet3", "testnet4"},
		{"bogus", "bogus"},
	} {
		if got := normalizeNetwork(tc.in); got != tc.want {
			t.Fatalf("normalizeNetwork(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestSetNetworkTestnet4AndAliases(t *testing.T) {
	defer func() { _btc_net = "testnet4" }()
	for _, key := range []string{"testnet4", "testnet3", "testnet"} {
		url, err := SetNetwork(key)
		if err != nil {
			t.Fatalf("SetNetwork(%q): %v", key, err)
		}
		if _btc_net != "testnet4" {
			t.Fatalf("SetNetwork(%q) left _btc_net = %q", key, _btc_net)
		}
		if url != "https://mempool.space/testnet4/api" {
			t.Fatalf("SetNetwork(%q) url = %q", key, url)
		}
	}
	if _, err := SetNetwork("bogus"); err == nil {
		t.Fatal("SetNetwork(bogus) unexpectedly accepted")
	}
}
