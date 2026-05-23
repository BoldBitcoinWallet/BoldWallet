package dkls

import (
	"testing"
)

func TestResolveSigningSessionLANTrioSubset(t *testing.T) {
	shares, _, err := RunDKGInProcessWithThreshold([]byte("sign-resolve-lan"), ThresholdTrio())
	if err != nil {
		t.Fatalf("dkg: %v", err)
	}
	defer shares[0].Free()
	defer shares[1].Free()
	defer shares[2].Free()

	committee := []string{"KeyShare1", "KeyShare2", "KeyShare3"}
	ksJSON, err := KeyshareJSONFromHandle(shares[0], "ab", committee, "KeyShare1", "", "")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	share, ks, err := ImportKeyshare(ksJSON)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	defer share.Free()

	// Two-of-three spend: local KeyShare1 + peer KeyShare3 (GG18 nostr/LAN subset pattern)
	sess, err := ResolveSigningSessionLAN(share, ks, "KeyShare1,KeyShare3")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if sess.SelfID != 1 {
		t.Fatalf("selfID=%d want 1", sess.SelfID)
	}
	if len(sess.SigningIDs) != 2 || sess.SigningIDs[0] != 1 || sess.SigningIDs[1] != 3 {
		t.Fatalf("signingIDs=%v want [1 3]", sess.SigningIDs)
	}
	if len(sess.LANPeerIDs) != 1 || sess.LANPeerIDs[0] != 3 {
		t.Fatalf("LANPeerIDs=%v want [3]", sess.LANPeerIDs)
	}

	ks3JSON, _ := KeyshareJSONFromHandle(shares[2], "ab", committee, "KeyShare3", "", "")
	share3, ks3, _ := ImportKeyshare(ks3JSON)
	defer share3.Free()
	sess3, err := ResolveSigningSessionLAN(share3, ks3, "KeyShare1,KeyShare3")
	if err != nil {
		t.Fatalf("resolve peer3: %v", err)
	}
	if sess3.SelfID != 3 {
		t.Fatalf("selfID=%d want 3", sess3.SelfID)
	}
}

func TestResolveSigningSessionLAN_RejectsDuplicateParties(t *testing.T) {
	shares, _, err := RunDKGInProcess([]byte("sign-resolve-dup"))
	if err != nil {
		t.Fatalf("dkg: %v", err)
	}
	defer shares[0].Free()
	defer shares[1].Free()

	committee := []string{"KeyShare1", "KeyShare2"}
	ksJSON, err := KeyshareJSONFromHandle(shares[0], "ab", committee, "KeyShare1", "", "")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	share, ks, err := ImportKeyshare(ksJSON)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	defer share.Free()

	if _, err := ResolveSigningSessionLAN(share, ks, "KeyShare1,KeyShare1"); err == nil {
		t.Fatal("expected error for duplicate participating parties")
	}
}

func TestResolveSigningSessionNostr_RejectsDuplicateNpubs(t *testing.T) {
	_, npubAlice := generateNostrKeypair(t)
	_, npubBob := generateNostrKeypair(t)
	committee := []string{npubAlice, npubBob}

	shares, _, err := RunDKGInProcess([]byte("nostr-dup"))
	if err != nil {
		t.Fatalf("dkg: %v", err)
	}
	defer shares[0].Free()
	defer shares[1].Free()

	ksJSON, err := KeyshareJSONFromHandle(shares[0], "00", committee, npubAlice, npubAlice, "")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	share, ks, err := ImportKeyshare(ksJSON)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	defer share.Free()

	dupCSV := npubAlice + "," + npubAlice
	if _, err := ResolveSigningSessionNostr(share, ks, npubAlice, dupCSV); err == nil {
		t.Fatal("expected error for duplicate participating npubs")
	}
}

func TestResolveSigningSessionNostrMapsCommitteeIndex(t *testing.T) {
	// Committee npub order defines DKG ids 1..3; signing subset uses ids 1 and 3.
	_, npubAlice := generateNostrKeypair(t)
	_, npubBob := generateNostrKeypair(t)
	_, npubCarol := generateNostrKeypair(t)
	committee := []string{npubAlice, npubBob, npubCarol}

	shares, pub, err := RunDKGInProcessWithThreshold([]byte("nostr-map"), ThresholdTrio())
	if err != nil {
		t.Fatalf("dkg: %v", err)
	}
	defer shares[0].Free()
	defer shares[2].Free()
	_ = pub

	ksJSON, err := KeyshareJSONFromHandle(shares[0], "00", committee, npubAlice, npubAlice, "")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	share, ksImported, err := ImportKeyshare(ksJSON)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	defer share.Free()

	sess, err := ResolveSigningSessionNostr(share, ksImported, npubAlice, npubAlice+","+npubCarol)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(sess.SigningIDs) != 2 || sess.SigningIDs[1] != 3 {
		t.Fatalf("signingIDs=%v want [1 3]", sess.SigningIDs)
	}
	if len(sess.NostrPeers) != 1 || sess.NostrPeers[0] != npubCarol {
		t.Fatalf("peers=%v", sess.NostrPeers)
	}
}
