package dkls

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

// F25 (dkls side): lan_pump poll + delete share tss's bounded relay clients.

func TestF25_DklsUsesBoundedRelayClients(t *testing.T) {
	if c := tss.RelayPollClient(); c == nil || c.Timeout <= 0 {
		t.Fatalf("RelayPollClient unbounded: %+v", c)
	}
	if c := tss.RelayRequestClient(); c == nil || c.Timeout <= 0 {
		t.Fatalf("RelayRequestClient unbounded: %+v", c)
	}
}

func TestF25_LanDeleteHangingRelay(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(srv.Close)
	start := time.Now()
	lanDeleteMessage(srv.URL, "sess", "key", "hash") // must return, never hang
	elapsed := time.Since(start)
	want := tss.RelayRequestTimeout
	if elapsed < want-2*time.Second || elapsed > want+10*time.Second {
		t.Fatalf("lanDeleteMessage vs hanging relay: elapsed %v, want ~%v", elapsed, want)
	}
}
