package dkls

import (
	"testing"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

func TestPartyIDFromKeyMoniker(t *testing.T) {
	id, err := partyIDFromKeyMoniker("KeyShare1")
	if err != nil || id != 1 {
		t.Fatalf("KeyShare1: id=%d err=%v", id, err)
	}
	if _, err := partyIDFromKeyMoniker("bogus"); err == nil {
		t.Fatal("expected error for unknown moniker")
	}
	if partyIDFromKey("bogus") != 0 {
		t.Fatal("partyIDFromKey unknown should return 0")
	}
}

func TestPartyIDFromParticipatingKey_KeyShareCommittee(t *testing.T) {
	committee := []string{"KeyShare1", "KeyShare2", "KeyShare3"}
	id, err := partyIDFromParticipatingKey("KeyShare2", committee)
	if err != nil || id != 2 {
		t.Fatalf("KeyShare2: id=%d err=%v", id, err)
	}
}

func TestPartyIDFromParticipatingKey_NpubCommittee_KeyShareLabel(t *testing.T) {
	_, npubAlice := generateNostrKeypair(t)
	_, npubBob := generateNostrKeypair(t)
	_, npubCarol := generateNostrKeypair(t)
	committee := []string{npubAlice, npubBob, npubCarol}

	sorted := sortedCommitteeKeys(committee)
	want, err := partyIDFromNpub(sorted[2], committee)
	if err != nil {
		t.Fatalf("expected npub: %v", err)
	}
	id, err := partyIDFromParticipatingKey("KeyShare3", committee)
	if err != nil || id != want {
		t.Fatalf("KeyShare3 on npub committee: id=%d want %d err=%v", id, want, err)
	}
}

func TestDedupeSigningIDs_RejectsDuplicate(t *testing.T) {
	_, err := dedupeSigningIDs([]libtss.Identifier{1, 1})
	if err == nil {
		t.Fatal("expected duplicate ids error")
	}
}

func TestEnsureLANRelayJoinKey_Mismatch(t *testing.T) {
	committee := []string{"KeyShare1", "KeyShare2"}
	_, err := ensureLANRelayJoinKey("KeyShare1", libtss.Identifier(2), committee)
	if err == nil {
		t.Fatal("expected relay key mismatch error")
	}
}
