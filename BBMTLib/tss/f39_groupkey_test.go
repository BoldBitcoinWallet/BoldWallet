package tss

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// F39: post-DKG group-key cross-check (LAN relay transport).
// Mismatch fails closed; old relays / timed-out peers warn and
// proceed (mixed-version ceremonies must keep working).

func runF39Relay(t *testing.T) string {
	t.Helper()
	port := freeTestPort(t)
	_, _ = StopRelay()
	time.Sleep(150 * time.Millisecond)
	if _, err := RunRelay(port); err != nil {
		t.Fatalf("RunRelay: %v", err)
	}
	t.Cleanup(func() { _, _ = StopRelay() })
	time.Sleep(1200 * time.Millisecond)
	return "http://127.0.0.1:" + port
}

func postF39Hash(t *testing.T, server, session, party, gkhash string) int {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"party": party, "gkhash": gkhash})
	resp, err := http.Post(server+"/groupkey/keygen/"+session, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST groupkey: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func TestF39_GroupKeyRelayRoundTrip(t *testing.T) {
	server := runF39Relay(t)
	session := "test-f39-roundtrip"
	if code := postF39Hash(t, server, session, "KeyShare1", "aa"); code != http.StatusCreated {
		t.Fatalf("post party1 status %d", code)
	}
	if code := postF39Hash(t, server, session, "KeyShare2", "aa"); code != http.StatusCreated {
		t.Fatalf("post party2 status %d", code)
	}
	hashes, err := fetchGroupKeygenHashes(server, session)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(hashes) != 2 || hashes["KeyShare1"] != "aa" || hashes["KeyShare2"] != "aa" {
		t.Fatalf("unexpected hashes %v", hashes)
	}
}

func TestF39_GroupKeyRelayRejectsGarbage(t *testing.T) {
	server := runF39Relay(t)
	session := "test-f39-garbage"
	if code := postF39Hash(t, server, session, "", "aa"); code != http.StatusBadRequest {
		t.Fatalf("empty party must 400, got %d", code)
	}
	if code := postF39Hash(t, server, session, "KeyShare1", "not-hex!!"); code != http.StatusBadRequest {
		t.Fatalf("non-hex hash must 400, got %d", code)
	}
	if code := postF39Hash(t, server, session, "KeyShare1", ""); code != http.StatusBadRequest {
		t.Fatalf("empty hash must 400, got %d", code)
	}
}

func TestF39_ExchangeConsensusMatch(t *testing.T) {
	t.Setenv("DKLS_TEST_AWAIT_SEC", "10")
	server := runF39Relay(t)
	session := "test-f39-match"
	parties := []string{"KeyShare1", "KeyShare2"}
	// Simulate the peer having posted the same hash already.
	if code := postF39Hash(t, server, session, "KeyShare2", "bb"); code != http.StatusCreated {
		t.Fatalf("peer post status %d", code)
	}
	if err := exchangeGroupKeyConsensus(server, session, "KeyShare1", parties, "bb"); err != nil {
		t.Fatalf("matching hashes must reach consensus: %v", err)
	}
}

func TestF39_ExchangeConsensusMismatchFailsClosed(t *testing.T) {
	t.Setenv("DKLS_TEST_AWAIT_SEC", "10")
	server := runF39Relay(t)
	session := "test-f39-mismatch"
	parties := []string{"KeyShare1", "KeyShare2"}
	if code := postF39Hash(t, server, session, "KeyShare2", "cc"); code != http.StatusCreated {
		t.Fatalf("peer post status %d", code)
	}
	err := exchangeGroupKeyConsensus(server, session, "KeyShare1", parties, "dd")
	if err == nil {
		t.Fatal("divergent group keys must fail closed")
	}
	if !strings.Contains(err.Error(), "DKG_GROUP_KEY_MISMATCH") {
		t.Fatalf("expected typed mismatch error, got: %v", err)
	}
}

func TestF39_ExchangeOldRelayWarnsAndProceeds(t *testing.T) {
	// A relay that predates the endpoint (old app as master) 404s:
	// warn-and-proceed preserves mixed-version ceremonies.
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()
	if err := exchangeGroupKeyConsensus(srv.URL, "sess", "KeyShare1", []string{"KeyShare1"}, "aa"); err != nil {
		t.Fatalf("old relay must warn-and-proceed, got: %v", err)
	}
}

func TestF39_ExchangeTimeoutWarnsAndProceeds(t *testing.T) {
	t.Setenv("DKLS_TEST_AWAIT_SEC", "2")
	server := runF39Relay(t)
	session := "test-f39-timeout"
	// Only self posts; the (old-version) peer never does.
	if err := exchangeGroupKeyConsensus(server, session, "KeyShare1", []string{"KeyShare1", "KeyShare2"}, "aa"); err != nil {
		t.Fatalf("timed-out peer must warn-and-proceed, got: %v", err)
	}
}
