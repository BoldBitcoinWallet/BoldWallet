package dkls

import (
	"encoding/hex"
	"strings"
	"testing"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	nostr "github.com/nbd-wtf/go-nostr"
)

func TestHelloDkg(t *testing.T) {
	result, err := HelloDkg()
	if err != nil {
		t.Fatalf("HelloDkg: %v", err)
	}
	if result == "" {
		t.Fatal("empty result")
	}
	t.Log(result)
}

func TestDKGAndSignInProcess(t *testing.T) {
	shares, pubkeys, err := RunDKGInProcess([]byte("test-session"))
	if err != nil {
		t.Fatalf("RunDKGInProcess: %v", err)
	}
	defer func() {
		for _, s := range shares {
			if s != nil {
				s.Free()
			}
		}
	}()

	msg := []byte("bitcoin-test")
	hash := HashMessageForDKLs(msg)
	sig, err := RunSignInProcess(shares, hash)
	if err != nil {
		t.Fatalf("RunSignInProcess: %v", err)
	}

	valid, err := libtss.Verify(libtss.CiphersuiteSecp256k1ECDSA, msg, sig.Data, pubkeys.VerifyingKey)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !valid {
		t.Fatal("signature invalid")
	}
	t.Log("group key", hex.EncodeToString(pubkeys.VerifyingKey))
}

func TestDKGAndSignInProcessTrio(t *testing.T) {
	shares, pubkeys, err := RunDKGInProcessWithThreshold([]byte("test-session-trio"), ThresholdTrio())
	if err != nil {
		t.Fatalf("RunDKGInProcessWithThreshold trio: %v", err)
	}
	defer func() {
		for _, s := range shares {
			if s != nil {
				s.Free()
			}
		}
	}()
	if len(shares) != 3 {
		t.Fatalf("expected 3 shares, got %d", len(shares))
	}

	// 2-of-3 sign with parties 1 and 3 (subset, like trio spend with selected peer)
	msg := []byte("bitcoin-test-trio")
	hash := HashMessageForDKLs(msg)
	sig, err := RunSignInProcess([]*libtss.KeyShareHandle{shares[0], shares[2]}, hash)
	if err != nil {
		t.Fatalf("RunSignInProcess (2 of 3): %v", err)
	}

	valid, err := libtss.Verify(libtss.CiphersuiteSecp256k1ECDSA, msg, sig.Data, pubkeys.VerifyingKey)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !valid {
		t.Fatal("signature invalid")
	}
}

func TestPartyIDFromKey(t *testing.T) {
	if partyIDFromKey("KeyShare1") != 1 {
		t.Fatal("KeyShare1")
	}
	if partyIDFromKey("KeyShare3") != 3 {
		t.Fatal("KeyShare3")
	}
	if partyKeyForID(2) != "KeyShare2" {
		t.Fatal("partyKeyForID")
	}
}

func TestKeyshareRoundTrip(t *testing.T) {
	shares, _, err := RunDKGInProcess([]byte("roundtrip"))
	if err != nil {
		t.Fatalf("dkg: %v", err)
	}
	defer shares[0].Free()
	defer shares[1].Free()

	jsonStr, err := KeyshareJSONFromHandle(shares[0], "aa", []string{"party1", "party2"}, "party1", "", "")
	if err != nil {
		t.Fatalf("export json: %v", err)
	}
	loaded, meta, err := ImportKeyshare(jsonStr)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	defer loaded.Free()
	if meta.TssBackend != BackendName {
		t.Fatalf("backend %q", meta.TssBackend)
	}
}

func TestNsecFieldRoundTrip(t *testing.T) {
	const sample = "nsec1samplekeyfortestonlynotreal"
	field, err := NsecFieldForKeyshareJSON(sample)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	got, err := NsecFromKeyshareField(field)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got != sample {
		t.Fatalf("round-trip mismatch")
	}
	got2, err := NsecFromKeyshareField(sample)
	if err != nil || got2 != sample {
		t.Fatalf("bech32 passthrough: got %q err %v", got2, err)
	}
}

func TestNsecFieldRoundTripFromHexSk(t *testing.T) {
	skHex := nostr.GeneratePrivateKey()
	field, err := NsecFieldForKeyshareJSON(skHex)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	got, err := NsecFromKeyshareField(field)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !strings.HasPrefix(got, "nsec1") {
		t.Fatalf("expected bech32 nsec, got %q", got)
	}
	wantNpub, err := nostr.GetPublicKey(skHex)
	if err != nil {
		t.Fatalf("pubkey: %v", err)
	}
	gotNpub, err := nostr.GetPublicKey(got)
	if err != nil {
		t.Fatalf("pubkey from nsec: %v", err)
	}
	if gotNpub != wantNpub {
		t.Fatalf("npub mismatch")
	}
}
