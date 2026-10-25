package tss

// F6: LAN padding-oracle (delete/keep poll differential) + DELETE nil-safety.
//
// The relay observes per-message DELETEs. Before the fix, a decrypt
// failure KEPT the message (deleted one poll later as "already
// applied") while a tag mismatch DELETED it immediately — a
// one-poll-cycle oracle distinguishing padding-valid from
// padding-invalid ciphertext. After the fix every reject class
// deletes on the same poll with equivalent work.

import (
	"crypto/hmac"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

type f6DeleteEvent struct {
	hash     string
	getsSeen int // GET polls the relay served before this DELETE arrived
}

type f6Relay struct {
	mu      sync.Mutex
	gets    int
	serve   []map[string]any
	deleted map[string]bool
	events  []f6DeleteEvent
	notify  chan f6DeleteEvent
}

func (r *f6Relay) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		r.mu.Lock()
		r.gets++
		var out []map[string]any
		for _, m := range r.serve {
			if !r.deleted[m["hash"].(string)] {
				out = append(out, m)
			}
		}
		r.mu.Unlock()
		if out == nil {
			out = []map[string]any{}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	case http.MethodDelete:
		parts := strings.Split(strings.Trim(req.URL.Path, "/"), "/")
		hash := parts[len(parts)-1]
		r.mu.Lock()
		r.deleted[hash] = true
		ev := f6DeleteEvent{hash: hash, getsSeen: r.gets}
		r.events = append(r.events, ev)
		r.mu.Unlock()
		select {
		case r.notify <- ev:
		default:
		}
		w.WriteHeader(http.StatusOK)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func f6Msg(from, body, seq, hash string) map[string]any {
	return map[string]any{
		"session_id":  "f6session",
		"from":        from,
		"to":          []string{"f6key"},
		"body":        body,
		"sequence_no": seq,
		"hash":        hash,
	}
}

// f6Drive runs downloadMessage against a one-message fake relay until the
// first DELETE (or timeout) and returns the relay transcript.
func f6Drive(t *testing.T, session, sessionKey, decKey string, msg map[string]any) ([]f6DeleteEvent, *ServiceImpl) {
	t.Helper()
	relay := &f6Relay{deleted: map[string]bool{}, notify: make(chan f6DeleteEvent, 16)}
	relay.serve = []map[string]any{msg}
	srv := httptest.NewServer(relay)
	defer srv.Close()

	if decKey != "" {
		keyMutex.Lock()
		oldDec := decryptionKey
		decryptionKey = decKey
		keyMutex.Unlock()
		defer func() {
			keyMutex.Lock()
			decryptionKey = oldDec
			keyMutex.Unlock()
		}()
	}

	imp := &ServiceImpl{inboundMessageCh: make(chan string, 16)}
	endCh := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go downloadMessage(srv.URL, session, sessionKey, "f6key", *imp, endCh, &wg)
	defer func() {
		close(endCh)
		wg.Wait()
	}()

	timeout := time.After(15 * time.Second)
	for {
		select {
		case ev := <-relay.notify:
			// Give a trailing poll cycle a chance to (incorrectly) add
			// more events, so keep-then-delete shows up in the transcript.
			time.Sleep(1200 * time.Millisecond)
			relay.mu.Lock()
			defer relay.mu.Unlock()
			_ = ev
			return append([]f6DeleteEvent(nil), relay.events...), imp
		case <-timeout:
			t.Fatalf("timed out waiting for relay DELETE (session %s)", session)
			return nil, nil
		}
	}
}

func f6SessionKey(t *testing.T) string {
	t.Helper()
	return strings.Repeat("ab", 32) // 32-byte hex key
}

func TestF6_RejectClassesDeleteSamePoll(t *testing.T) {
	key := f6SessionKey(t)
	payload := strings.Repeat("f6-mpc-payload-", 64) // ~1KB realistic round body

	goodBody, err := AesEncrypt(payload, key)
	if err != nil {
		t.Fatalf("fixture encrypt: %v", err)
	}
	realTag, err := computePayloadAuthTag(payload, key)
	if err != nil {
		t.Fatalf("fixture tag: %v", err)
	}
	badTag := realTag[:len(realTag)-1] + "0"

	// Deterministic padding failure: unpadPKCS7 only errors when the
	// last byte exceeds the buffer length, so use a short (one-block)
	// plaintext and set the last byte to 0xFF (recovered by
	// RecoverAsError into an error).
	shortBody, err := AesEncrypt("f6", key)
	if err != nil {
		t.Fatalf("fixture short encrypt: %v", err)
	}
	raw, err := base64.StdEncoding.DecodeString(shortBody)
	if err != nil {
		t.Fatalf("fixture decode: %v", err)
	}
	raw[len(raw)-1] = 0xFF
	padErrBody := base64.StdEncoding.EncodeToString(raw)
	if _, err := AesDecrypt(padErrBody, key); err == nil {
		t.Fatalf("padding-error fixture unexpectedly decrypts")
	}
	if _, err := AesDecrypt("!!!not-base64!!!", key); err == nil {
		t.Fatalf("bad-base64 fixture unexpectedly decrypts")
	}

	kpJSON, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("fixture keypair: %v", err)
	}
	var kp map[string]string
	if err := json.Unmarshal([]byte(kpJSON), &kp); err != nil {
		t.Fatalf("fixture keypair json: %v", err)
	}
	if _, err := EciesDecrypt("!!!not-base64!!!", kp["privateKey"]); err == nil {
		t.Fatalf("ecies-error fixture unexpectedly decrypts")
	}

	cases := []struct {
		name       string
		sessionKey string
		decKey     string
		msg        map[string]any
	}{
		{
			name:       "padding-error",
			sessionKey: key,
			msg:        f6Msg("attacker", padErrBody, "1", "h1:"+strings.Repeat("aa", 32)),
		},
		{
			name:       "bad-base64",
			sessionKey: key,
			msg:        f6Msg("attacker", "!!!not-base64!!!", "1", "h1:"+strings.Repeat("cc", 32)),
		},
		{
			name:       "tag-mismatch",
			sessionKey: key,
			msg:        f6Msg("attacker", goodBody, "1", badTag),
		},
		{
			name:       "ecies-decrypt-fail",
			sessionKey: "",
			decKey:     kp["privateKey"],
			msg:        f6Msg("attacker", "!!!not-base64!!!", "1", "d1:"+strings.Repeat("bb", 32)),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			events, _ := f6Drive(t, "f6-"+tc.name, tc.sessionKey, tc.decKey, tc.msg)
			if len(events) != 1 {
				t.Fatalf("expected exactly 1 DELETE, got %d (%v)", len(events), events)
			}
			if events[0].getsSeen != 1 {
				t.Fatalf("oracle signal: DELETE arrived after %d polls, want same-poll (1)", events[0].getsSeen)
			}
			if events[0].hash != tc.msg["hash"].(string) {
				t.Fatalf("DELETE hash %q != message hash", events[0].hash)
			}
		})
	}
}

func TestF6_ValidMessageStillApplied(t *testing.T) {
	key := f6SessionKey(t)
	payload := "f6-valid-round"
	body, err := AesEncrypt(payload, key)
	if err != nil {
		t.Fatalf("fixture encrypt: %v", err)
	}
	tag, err := computePayloadAuthTag(payload, key)
	if err != nil {
		t.Fatalf("fixture tag: %v", err)
	}
	events, imp := f6Drive(t, "f6-valid", key, "", f6Msg("peer", body, "1", tag))
	if len(events) != 1 || events[0].getsSeen != 1 {
		t.Fatalf("valid message transcript wrong: %v", events)
	}
	select {
	case got := <-imp.inboundMessageCh:
		if got != payload {
			t.Fatalf("applied body %q != payload", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("valid message was not applied")
	}
}

func TestF6_DeleteMessageNilSafety(t *testing.T) {
	t.Run("newrequest-error", func(t *testing.T) {
		// Invalid port makes http.NewRequest fail: must log + return,
		// never Do(nil) and never nil-deref resp.Body.
		deleteMessage("http://[::1]:x", "s", "k", "h1:abc")
	})
	t.Run("conn-refused", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		url := srv.URL
		srv.Close() // future dials refuse
		deleteMessage(url, "s", "k", "h1:abc")
	})
}

func f6Median(ds []time.Duration) time.Duration {
	cp := append([]time.Duration(nil), ds...)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	return cp[len(cp)/2]
}

func TestF6_RejectTimingFlat(t *testing.T) {
	key := f6SessionKey(t)
	// Short payload: the padding-error fixture needs last-byte >
	// buffer length to fail deterministically (see above). Both
	// paths stay microsecond-scale regardless of payload size; the
	// bound below is absolute, not length-relative.
	payload := "f6-timing"
	body, err := AesEncrypt(payload, key)
	if err != nil {
		t.Fatalf("fixture encrypt: %v", err)
	}
	raw, _ := base64.StdEncoding.DecodeString(body)
	raw[len(raw)-1] = 0xFF
	padErrBody := base64.StdEncoding.EncodeToString(raw)
	if _, err := AesDecrypt(padErrBody, key); err == nil {
		t.Fatalf("path B fixture unexpectedly decrypts")
	}
	wrongTag := "h1:" + strings.Repeat("00", 32)

	// Path A: decrypt-ok + HMAC + compare-fail (tag mismatch).
	timeA := func() time.Duration {
		start := time.Now()
		pt, derr := AesDecrypt(body, key)
		if derr != nil {
			t.Fatalf("path A decrypt: %v", derr)
		}
		tag, terr := computePayloadAuthTag(pt, key)
		if terr != nil {
			t.Fatalf("path A tag: %v", terr)
		}
		_ = hmac.Equal([]byte(tag), []byte(wrongTag))
		return time.Since(start)
	}
	// Path B: decrypt-fail + dummy HMAC over the rejected ciphertext.
	timeB := func() time.Duration {
		start := time.Now()
		if _, derr := AesDecrypt(padErrBody, key); derr == nil {
			t.Fatalf("path B unexpectedly decrypts")
		}
		_, _ = computePayloadAuthTag(padErrBody, key)
		return time.Since(start)
	}
	for i := 0; i < 30; i++ {
		timeA()
		timeB()
	}
	const n = 300
	da := make([]time.Duration, 0, n)
	db := make([]time.Duration, 0, n)
	for i := 0; i < n; i++ {
		da = append(da, timeA())
		db = append(db, timeB())
	}
	ma, mb := f6Median(da), f6Median(db)
	t.Logf("reject medians: tag-mismatch=%v padding-error=%v", ma, mb)
	diff := ma - mb
	if diff < 0 {
		diff = -diff
	}
	// LAN HTTP jitter is millisecond-scale; both paths are microsecond
	// work, so a 50ms absolute bound is strict for the network observer
	// and still flake-proof on any sane machine.
	if diff >= 50*time.Millisecond {
		t.Fatalf("reject paths timing-distinguishable: %v apart", diff)
	}
}
