package dkls

import (
	"strings"
	"testing"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

// TestLanAwaitJoinersPartialTrio verifies join barrier fails when only 2/3 register.
func TestLanAwaitJoinersPartialTrio(t *testing.T) {
	if testing.Short() {
		t.Skip("join barrier integration")
	}
	t.Setenv("DKLS_TEST_AWAIT_SEC", "6")

	port := freeTestPort(t)
	_, _ = tss.StopRelay()
	time.Sleep(300 * time.Millisecond)
	_, err := tss.RunRelay(port)
	if err != nil {
		t.Fatalf("RunRelay: %v", err)
	}
	defer func() { _, _ = tss.StopRelay() }()
	time.Sleep(1500 * time.Millisecond)

	server := "http://127.0.0.1:" + port
	session := "test-await-partial-trio"
	parties := []string{"KeyShare1", "KeyShare2", "KeyShare3"}

	for _, key := range []string{"KeyShare1", "KeyShare2"} {
		if err := tss.LANJoinSession(server, session, key); err != nil {
			t.Fatalf("LANJoinSession %s: %v", key, err)
		}
	}

	err = tss.LANAwaitJoiners(parties, server, session)
	if err == nil {
		t.Fatal("expected await timeout with only 2 parties")
	}
	if !strings.Contains(err.Error(), "timeout waiting for all parties") {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(err.Error(), "KeyShare3") {
		t.Fatalf("expected missing KeyShare3 in error, got: %v", err)
	}
}
