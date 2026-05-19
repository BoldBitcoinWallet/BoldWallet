package dkls

import (
	"encoding/hex"
	"testing"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

func TestDerivePathMatchesAppBIP32(t *testing.T) {
	shares, pub, err := RunDKGInProcess([]byte("derive-path-match"))
	if err != nil {
		t.Fatal(err)
	}
	defer shares[0].Free()
	defer shares[1].Free()

	chaincode := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	path := "m/84'/1'/0'/0/0"
	libPath, err := derivationPathForLibtss(path)
	if err != nil {
		t.Fatal(err)
	}
	if libPath != "m/84/1/0/0/0" {
		t.Fatalf("libtss path: got %q want m/84/1/0/0/0", libPath)
	}

	derived, err := deriveShareForSigning(shares[0], path, chaincode)
	if err != nil {
		t.Fatalf("deriveShareForSigning: %v", err)
	}
	defer derived.Free()

	groupKey, err := derived.GroupKey()
	if err != nil {
		t.Fatal(err)
	}
	wantHex, err := tss.GetDerivedPubKey(
		hex.EncodeToString(pub.VerifyingKey),
		chaincode,
		path,
		false,
	)
	if err != nil {
		t.Fatalf("GetDerivedPubKey: %v", err)
	}
	want, _ := hex.DecodeString(wantHex)
	if hex.EncodeToString(groupKey) != hex.EncodeToString(want) {
		t.Fatalf("pubkey mismatch:\n  libtss %x\n  app    %x", groupKey, want)
	}
}

func TestSignWithDerivedShareVerifies(t *testing.T) {
	shares, pub, err := RunDKGInProcess([]byte("derive-sign-verify"))
	if err != nil {
		t.Fatal(err)
	}
	defer shares[0].Free()
	defer shares[1].Free()

	chaincode := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	path := "m/84'/1'/0'/0/0"
	derived0, err := deriveShareForSigning(shares[0], path, chaincode)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	defer derived0.Free()
	derived1, err := deriveShareForSigning(shares[1], path, chaincode)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	defer derived1.Free()

	msg := []byte("bitcoin-test-derived")
	hash := HashMessageForDKLs(msg)
	sig, err := RunSignInProcess([]*libtss.KeyShareHandle{derived0, derived1}, hash)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	wantHex, err := tss.GetDerivedPubKey(
		hex.EncodeToString(pub.VerifyingKey),
		chaincode,
		path,
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	wantPub, _ := hex.DecodeString(wantHex)
	valid, err := libtss.Verify(libtss.CiphersuiteSecp256k1ECDSA, msg, sig.Data, wantPub)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !valid {
		t.Fatal("signature invalid for derived pubkey")
	}
}
