package dkls

import (
	"testing"
	"time"
)

// F39: post-DKG group-key cross-check (nostr compare logic +
// collect timeout). Transport round-trips ride the existing DKG
// loopback suites; these pin the fail-closed semantics.

func TestF39_UnanimityMatch(t *testing.T) {
	want := map[string]bool{"peer1": true, "peer2": true}
	arrived := map[string]string{"peer1": "AA", "peer2": "aa"}
	if err := checkGroupKeyUnanimity(want, arrived, "aa"); err != nil {
		t.Fatalf("matching hashes must pass: %v", err)
	}
}

func TestF39_UnanimityMismatchFailsClosed(t *testing.T) {
	want := map[string]bool{"peer1": true, "peer2": true}
	arrived := map[string]string{"peer1": "aa", "peer2": "bb"}
	err := checkGroupKeyUnanimity(want, arrived, "aa")
	if err == nil {
		t.Fatal("divergent hashes must fail closed")
	}
	if got := err.Error(); len(got) < len("DKG_GROUP_KEY_MISMATCH") || got[:len("DKG_GROUP_KEY_MISMATCH")] != "DKG_GROUP_KEY_MISMATCH" {
		t.Fatalf("expected typed mismatch error, got: %v", err)
	}
}

func TestF39_UnanimityIgnoresUnknownSenders(t *testing.T) {
	want := map[string]bool{"peer1": true}
	arrived := map[string]string{"peer1": "aa", "stranger": "zz"}
	if err := checkGroupKeyUnanimity(want, arrived, "aa"); err != nil {
		t.Fatalf("unknown senders must not constrain consensus: %v", err)
	}
}

func TestF39_NostrCollectTimeoutEnv(t *testing.T) {
	t.Setenv("F39_GROUPKEY_SEC", "1")
	start := time.Now()
	if got := nostrGroupKeyCollectTimeout(); got != time.Second {
		t.Fatalf("env override must yield 1s, got %v", got)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("timeout helper must return immediately, took %v", elapsed)
	}
	if got := func() time.Duration {
		t.Setenv("F39_GROUPKEY_SEC", "")
		return nostrGroupKeyCollectTimeout()
	}(); got != 30*time.Second {
		t.Fatalf("default must be 30s, got %v", got)
	}
}
