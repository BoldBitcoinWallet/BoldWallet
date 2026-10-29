package tss

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

// F25: a relay that never responds must not hang the client. Every relay
// call goes through relayPollClient / relayRequestClient, both bounded.

// f25HangingServer simulates a malicious relay: accepts the connection,
// never writes a byte, releases the handler when the client gives up.
func f25HangingServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestF25_RelayClientsAreBounded(t *testing.T) {
	if relayPollClient.Timeout <= 0 || relayPollClient.Timeout > 30*time.Second {
		t.Fatalf("relayPollClient.Timeout out of sane bounds: %v", relayPollClient.Timeout)
	}
	if relayRequestClient.Timeout <= 0 || relayRequestClient.Timeout > 30*time.Second {
		t.Fatalf("relayRequestClient.Timeout out of sane bounds: %v", relayRequestClient.Timeout)
	}
	if RelayPollClient() != relayPollClient || RelayRequestClient() != relayRequestClient {
		t.Fatalf("exported accessors must return the shared singletons")
	}
}

func TestF25_PollClientTimesOut(t *testing.T) {
	srv := f25HangingServer(t)
	start := time.Now()
	_, err := relayPollClient.Get(srv.URL + "/message/sess/key")
	elapsed := time.Since(start)
	if err == nil {
		t.Fatalf("hanging relay: expected timeout error, got nil")
	}
	if !os.IsTimeout(err) {
		t.Fatalf("hanging relay: expected timeout error, got %v", err)
	}
	if elapsed < RelayPollTimeout-2*time.Second || elapsed > RelayPollTimeout+10*time.Second {
		t.Fatalf("hanging relay: elapsed %v, want ~%v", elapsed, RelayPollTimeout)
	}
}

func TestF25_DeleteMessageHangingRelay(t *testing.T) {
	srv := f25HangingServer(t)
	start := time.Now()
	deleteMessage(srv.URL, "sess", "key", "hash") // must log + return, never hang/panic
	elapsed := time.Since(start)
	if elapsed < RelayRequestTimeout-2*time.Second || elapsed > RelayRequestTimeout+10*time.Second {
		t.Fatalf("deleteMessage vs hanging relay: elapsed %v, want ~%v", elapsed, RelayRequestTimeout)
	}
}
