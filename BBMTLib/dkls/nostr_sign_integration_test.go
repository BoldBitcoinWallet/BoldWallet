package dkls

import (
	"encoding/base64"
	"testing"
)

func testMpcNostrKeysignDuo(t *testing.T) {
	t.Helper()
	relays := requireNostrRelay(t)
	p1 := nostrParty{}
	p2 := nostrParty{}
	p1.nsec, p1.npub = generateNostrKeypair(t)
	p2.nsec, p2.npub = generateNostrKeypair(t)
	parties := []nostrParty{p1, p2}
	allParties := nostrPartiesCSV(parties)

	kgSession := testSessionHex(t, 16)
	sessionKey := testSessionHex(t, 32)
	chaincode := testChaincodeHex(t)
	shareByNpub := nostrKeygenAll(t, relays, kgSession, sessionKey, chaincode, parties)
	keyshares := []string{shareByNpub[p1.npub], shareByNpub[p2.npub]}

	msg := []byte("bitcoin-nostr-sign-duo")
	hash := HashMessageForDKLs(msg)
	sighashB64 := base64.StdEncoding.EncodeToString(hash)

	signSession := testSessionHex(t, 16)
	sigJSON := nostrKeysignAll(t, relays, signSession, sessionKey, allParties, parties, keyshares, sighashB64)
	verifyLanKeysignResult(t, keyshares[0], sigJSON, msg)
}

// Duo raw-message Nostr keysign (scripts-dkls nostr-keysign CLI path).
func TestNostrKeysignDuoRaw(t *testing.T) {
	skipIntegrationIfShort(t, "Nostr keysign integration")
	relays := requireNostrRelay(t)
	p1 := nostrParty{}
	p2 := nostrParty{}
	p1.nsec, p1.npub = generateNostrKeypair(t)
	p2.nsec, p2.npub = generateNostrKeypair(t)
	parties := []nostrParty{p1, p2}
	allParties := nostrPartiesCSV(parties)

	kgSession := testSessionHex(t, 16)
	sessionKey := testSessionHex(t, 32)
	chaincode := testChaincodeHex(t)
	shareByNpub := nostrKeygenAll(t, relays, kgSession, sessionKey, chaincode, parties)
	keyshares := []string{shareByNpub[p1.npub], shareByNpub[p2.npub]}

	msg := "bitcoin-nostr-sign-duo-raw"
	signSession := testSessionHex(t, 16)
	sigJSON := nostrKeysignRawAll(t, relays, signSession, sessionKey, allParties, msg, parties, keyshares)
	verifyLanKeysignResult(t, keyshares[0], sigJSON, []byte(msg))
}

func testMpcNostrKeysignTrioSubset(t *testing.T) {
	t.Helper()
	relays := requireNostrRelay(t)
	var all [3]nostrParty
	for i := range all {
		all[i].nsec, all[i].npub = generateNostrKeypair(t)
	}

	kgSession := testSessionHex(t, 16)
	sessionKey := testSessionHex(t, 32)
	chaincode := testChaincodeHex(t)
	shareByNpub := nostrKeygenAll(t, relays, kgSession, sessionKey, chaincode, all[:])

	signParties := []nostrParty{all[0], all[2]}
	signCSV := nostrPartiesCSV(signParties)
	signShares := []string{shareByNpub[all[0].npub], shareByNpub[all[2].npub]}

	msg := []byte("bitcoin-nostr-sign-trio")
	hash := HashMessageForDKLs(msg)
	sighashB64 := base64.StdEncoding.EncodeToString(hash)

	signSession := testSessionHex(t, 16)
	sigJSON := nostrKeysignAll(t, relays, signSession, sessionKey, signCSV, signParties, signShares, sighashB64)
	verifyLanKeysignResult(t, signShares[0], sigJSON, msg)
}

// Duo Nostr keysign (PSBT / Send BTC sighash path) after Nostr keygen.
func TestNostrKeysignDuo(t *testing.T) {
	skipIntegrationIfShort(t, "Nostr keysign integration")
	testMpcNostrKeysignDuo(t)
}

// Trio 2-of-3 subset Nostr keysign (first + third npub), same as trio spend.
func TestNostrKeysignTrioSubset(t *testing.T) {
	skipIntegrationIfShort(t, "Nostr keysign integration")
	testMpcNostrKeysignTrioSubset(t)
}
