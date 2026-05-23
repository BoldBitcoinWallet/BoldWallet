package dkls

import (
	"crypto/rand"
	"encoding/hex"
	"testing"
)

func testChaincodeHex(t *testing.T) string {
	t.Helper()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return hex.EncodeToString(b)
}

func testSessionHex(t *testing.T, n int) string {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return hex.EncodeToString(b)
}

func testMpcNostrKeygenDuo(t *testing.T) {
	t.Helper()
	relays := requireNostrRelay(t)
	p1 := nostrParty{}
	p2 := nostrParty{}
	p1.nsec, p1.npub = generateNostrKeypair(t)
	p2.nsec, p2.npub = generateNostrKeypair(t)

	sessionID := testSessionHex(t, 16)
	sessionKey := testSessionHex(t, 32)
	chaincode := testChaincodeHex(t)

	shareByNpub := nostrKeygenAll(t, relays, sessionID, sessionKey, chaincode, []nostrParty{p1, p2})
	if shareByNpub[p1.npub] == "" || shareByNpub[p2.npub] == "" {
		t.Fatal("missing keyshare for a party")
	}
}

func testMpcNostrKeygenTrio(t *testing.T) {
	t.Helper()
	relays := requireNostrRelay(t)
	var parties [3]nostrParty
	for i := range parties {
		parties[i].nsec, parties[i].npub = generateNostrKeypair(t)
	}

	sessionID := testSessionHex(t, 16)
	sessionKey := testSessionHex(t, 32)
	chaincode := testChaincodeHex(t)

	shareByNpub := nostrKeygenAll(t, relays, sessionID, sessionKey, chaincode, parties[:])
	if len(shareByNpub) != 3 {
		t.Fatalf("expected 3 keyshares, got %d", len(shareByNpub))
	}
}

// Duo Nostr DKG against a local nostr-rs-relay (same path as mobile Nostr duo setup).
func TestNostrJoinKeygenDuo(t *testing.T) {
	testMpcNostrKeygenDuo(t)
}

// Three-party Nostr DKG (same path as mobile Nostr trio setup).
func TestNostrJoinKeygenTrio(t *testing.T) {
	testMpcNostrKeygenTrio(t)
}
