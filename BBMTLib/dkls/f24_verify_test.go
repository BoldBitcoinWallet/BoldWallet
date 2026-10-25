package dkls

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

// F24 (dkls side): lan_pump previously verified nothing. The sender always
// tags (h1 with session key, d1 otherwise); the pump must accept exactly
// what the GG18 verify switch accepts. Fixtures come from the production
// sender to avoid forging the wire format in-test.

func f24CaptureSend(t *testing.T, sessionKey string) (postedBody, postedHash string) {
	t.Helper()
	var got struct {
		Body string `json:"body"`
		Hash string `json:"hash"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode posted message: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	m := tss.NewLANMessenger(srv.URL, "f24sess", sessionKey)
	if err := m.Send("a", "b", "f24-payload"); err != nil {
		t.Fatalf("production send: %v", err)
	}
	if got.Body == "" || got.Hash == "" {
		t.Fatalf("sender must always tag: body_len=%d hash=%q", len(got.Body), got.Hash)
	}
	return got.Body, got.Hash
}

func TestF24_DklsPumpAcceptsSenderOutput(t *testing.T) {
	key := strings.Repeat("ab", 32)
	postedBody, postedHash := f24CaptureSend(t, key)
	if !strings.HasPrefix(postedHash, "h1:") {
		t.Fatalf("session-key send must tag h1, got %q", postedHash)
	}
	plain, err := tss.DecryptLANRelayPayload(postedBody, key)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !lanPayloadHashValid(plain, key, postedHash) {
		t.Fatalf("pump rejects the production sender's own output")
	}
}

func TestF24_DklsPumpRejects(t *testing.T) {
	key := strings.Repeat("ab", 32)
	postedBody, postedHash := f24CaptureSend(t, key)
	plain, err := tss.DecryptLANRelayPayload(postedBody, key)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	badTag := postedHash[:len(postedHash)-1] + "0"
	cases := []struct {
		name string
		hash string
		key  string
	}{
		{"empty", "", key},
		{"tampered-tag", badTag, key},
		{"unknown-format", "xx:deadbeef", key},
		{"wrong-key", postedHash, strings.Repeat("cd", 32)},
	}
	for _, tc := range cases {
		if lanPayloadHashValid(plain, tc.key, tc.hash) {
			t.Fatalf("%s: pump accepted a message it must reject", tc.name)
		}
	}
}

func TestF24_DklsPumpAcceptsDigestPath(t *testing.T) {
	// No session key: sender ECIES-encrypts + d1 tags; pump verifies keyless.
	kpJSON, err := tss.GenerateKeyPair()
	if err != nil {
		t.Fatalf("keypair: %v", err)
	}
	var kp map[string]string
	if err := json.Unmarshal([]byte(kpJSON), &kp); err != nil {
		t.Fatalf("keypair json: %v", err)
	}
	if err := tss.ConfigureLANTransportKeys("", kp["publicKey"], kp["privateKey"]); err != nil {
		t.Fatalf("configure ECIES: %v", err)
	}
	t.Cleanup(tss.ClearLANTransportKeys)
	postedBody, postedHash := f24CaptureSend(t, "")
	if !strings.HasPrefix(postedHash, "d1:") {
		t.Fatalf("keyless send must tag d1, got %q", postedHash)
	}
	plain, err := tss.DecryptLANRelayPayload(postedBody, "")
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !lanPayloadHashValid(plain, "", postedHash) {
		t.Fatalf("pump rejects valid d1 message")
	}
	if lanPayloadHashValid(plain, "", "") {
		t.Fatalf("pump accepts empty hash on d1 path")
	}
}
