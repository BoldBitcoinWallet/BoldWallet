package tss

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
)

// F32 (Option A): SAS-authenticated ECDH for trio LAN keygen.
// Full exchange over a real relay; MITM divergence; outdated-peer
// timeout; legacy-derivation refusal; handle one-shot semantics.

func runF32Relay(t *testing.T) string {
	t.Helper()
	port := freeTestPort(t)
	_, _ = StopRelay()
	if _, err := RunRelay(port); err != nil {
		t.Fatalf("RunRelay: %v", err)
	}
	t.Cleanup(func() { _, _ = StopRelay() })
	return "http://127.0.0.1:" + port
}

func postF32Pub(t *testing.T, server, session, party, pub string) int {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"party": party, "pubkey": pub})
	resp, err := http.Post(server+"/ecdh/keygen/"+session, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST ecdh: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func f32ValidPub() string {
	return "04" + strings.Repeat("ab", 64)
}

type f32Phase1Result struct {
	handle string
	sas    string
	err    error
}

func TestF32_ECDHRelayRejectsGarbage(t *testing.T) {
	server := runF32Relay(t)
	session := "test-f32-garbage"
	if code := postF32Pub(t, server, session, "", f32ValidPub()); code != http.StatusBadRequest {
		t.Fatalf("empty party must 400, got %d", code)
	}
	if code := postF32Pub(t, server, session, "KeyShare1", "not-hex!!"); code != http.StatusBadRequest {
		t.Fatalf("non-hex pub must 400, got %d", code)
	}
	if code := postF32Pub(t, server, session, "KeyShare1", "0211"); code != http.StatusBadRequest {
		t.Fatalf("short pub must 400, got %d", code)
	}
	// 130 hex but compressed prefix 02 must 400 (uncompressed only).
	if code := postF32Pub(t, server, session, "KeyShare1", "02"+strings.Repeat("ab", 64)); code != http.StatusBadRequest {
		t.Fatalf("compressed pub must 400, got %d", code)
	}
	if code := postF32Pub(t, server, session, "KeyShare1", f32ValidPub()); code != http.StatusCreated {
		t.Fatalf("valid pub must 201, got %d", code)
	}
}

func postF32X(t *testing.T, server, session, party, x string) int {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"party": party, "x": x})
	resp, err := http.Post(server+"/ecdh/xchg/"+session, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST ecdh-x: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func TestF32_ECDHXRelayRejectsGarbage(t *testing.T) {
	server := runF32Relay(t)
	session := "test-f32-x-garbage"
	if code := postF32X(t, server, session, "", strings.Repeat("ab", 32)); code != http.StatusBadRequest {
		t.Fatalf("empty party must 400, got %d", code)
	}
	if code := postF32X(t, server, session, "KeyShare1", "zz"); code != http.StatusBadRequest {
		t.Fatalf("short x must 400, got %d", code)
	}
	if code := postF32X(t, server, session, "KeyShare1", strings.Repeat("ab", 32)); code != http.StatusCreated {
		t.Fatalf("valid x must 201, got %d", code)
	}
}

func TestF32_XMismatchFailsClosed(t *testing.T) {
	// a^b^c == 0 passes; flipping one bit fails.
	xs := map[string]string{
		"KeyShare1": strings.Repeat("11", 32),
		"KeyShare2": strings.Repeat("22", 32),
		"KeyShare3": "33" + strings.Repeat("11", 31),
	}
	// Fix the third so XOR is zero: x3 = x1^x2.
	x3 := make([]byte, 32)
	for i := range x3 {
		x3[i] = 0x11 ^ 0x22
	}
	xs["KeyShare3"] = hex.EncodeToString(x3)
	if err := verifyTrioXXor(xs); err != nil {
		t.Fatalf("consistent X set must verify: %v", err)
	}
	xs["KeyShare3"] = strings.Repeat("99", 32)
	if err := verifyTrioXXor(xs); err == nil {
		t.Fatalf("forged X must fail the invariant")
	} else if !strings.Contains(err.Error(), "TRIO_X_MISMATCH") {
		t.Fatalf("must be TRIO_X_MISMATCH, got: %v", err)
	}
}

func TestF32_TrioExchangeAgrees(t *testing.T) {
	t.Setenv("TRIO_ECDH_SEC", "30")
	server := runF32Relay(t)
	session := "test-f32-trio-agree"
	parties := []string{"KeyShare1", "KeyShare2", "KeyShare3"}
	partiesCSV := strings.Join(parties, ",")

	var wg sync.WaitGroup
	results := make([]f32Phase1Result, len(parties))
	for i, p := range parties {
		wg.Add(1)
		go func(i int, party string) {
			defer wg.Done()
			out, err := TrioECDHPhase1(server, session, party, partiesCSV)
			if err != nil {
				results[i] = f32Phase1Result{err: err}
				return
			}
			var decoded map[string]string
			if jerr := json.Unmarshal([]byte(out), &decoded); jerr != nil {
				results[i] = f32Phase1Result{err: jerr}
				return
			}
			results[i] = f32Phase1Result{handle: decoded["handle"], sas: decoded["sas"]}
		}(i, p)
	}
	wg.Wait()

	sas := ""
	keys := make([]string, 0, len(parties))
	for i, r := range results {
		if r.err != nil {
			t.Fatalf("party %s phase1 failed: %v", parties[i], r.err)
		}
		if len(r.sas) != 6 {
			t.Fatalf("party %s SAS must be 6 digits, got %q", parties[i], r.sas)
		}
		if sas == "" {
			sas = r.sas
		} else if r.sas != sas {
			t.Fatalf("SAS divergence: %q vs %q (honest parties must agree)", sas, r.sas)
		}
		k, err := TrioECDHConfirm(r.handle, session)
		if err != nil {
			t.Fatalf("party %s confirm failed: %v", parties[i], err)
		}
		if len(k) != 64 {
			t.Fatalf("party %s session key must be 64 hex, got %d chars", parties[i], len(k))
		}
		keys = append(keys, k)
		// Handles are one-shot: second confirm must fail.
		if _, err := TrioECDHConfirm(r.handle, session); err == nil {
			t.Fatalf("party %s second confirm must fail (one-shot handle)", parties[i])
		}
	}
	for _, k := range keys[1:] {
		if k != keys[0] {
			t.Fatalf("session key divergence across honest parties")
		}
	}
}

func TestF32_MITMDivergesSAS(t *testing.T) {
	// Attacker feeds a different pubkey set to one victim: the SAS
	// codes visibly differ, which is exactly what the user compare
	// step catches. Unit-level: same session, different pub sets.
	honest := []string{"04" + strings.Repeat("11", 64), "04" + strings.Repeat("22", 64), "04" + strings.Repeat("33", 64)}
	rogue := []string{"04" + strings.Repeat("11", 64), "04" + strings.Repeat("22", 64), "04" + strings.Repeat("99", 64)}
	sasHonest, err := trioECDSAS(sortedCopy(honest), "sess-1")
	if err != nil {
		t.Fatalf("sas honest: %v", err)
	}
	sasRogue, err := trioECDSAS(sortedCopy(rogue), "sess-1")
	if err != nil {
		t.Fatalf("sas rogue: %v", err)
	}
	if sasHonest == sasRogue {
		t.Fatalf("MITM pubkey swap must change the SAS (got identical %q)", sasHonest)
	}
}

func sortedCopy(in []string) []string {
	out := append([]string{}, in...)
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func TestF32_OutdatedPeerFailsClosed(t *testing.T) {
	t.Setenv("TRIO_ECDH_SEC", "2")
	server := runF32Relay(t)
	session := "test-f32-outdated"
	// Only KeyShare1 posts (itself, inside Phase1); KeyShare2/3 never
	// arrive — pre-ECDH app versions. Must fail closed, not derive.
	_, err := TrioECDHPhase1(server, session, "KeyShare1", "KeyShare1,KeyShare2,KeyShare3")
	if err == nil {
		t.Fatalf("missing peers must fail closed")
	}
	if !strings.Contains(err.Error(), "TRIO_PEER_OUTDATED") {
		t.Fatalf("must be TRIO_PEER_OUTDATED, got: %v", err)
	}
}

func TestF32_LegacyDerivationRefused(t *testing.T) {
	if _, err := DeriveLANSessionKey("any-session", "192.168.1.20"); err == nil {
		t.Fatalf("public derivation must be refused")
	} else if !strings.Contains(err.Error(), "TRIO_LEGACY_KEY_REFUSED") {
		t.Fatalf("must be TRIO_LEGACY_KEY_REFUSED, got: %v", err)
	}
}

func TestF32_AbortWipesHandle(t *testing.T) {
	t.Setenv("TRIO_ECDH_SEC", "30")
	server := runF32Relay(t)
	session := "test-f32-abort"
	partiesCSV := "KeyShare1,KeyShare2"
	// Real duo exchange in the background; abort party 1's handle
	// (user saw a SAS mismatch) while party 2 confirms normally.
	type pres struct {
		out string
		err error
	}
	ch := make(chan pres, 2)
	var wg sync.WaitGroup
	for _, p := range []string{"KeyShare1", "KeyShare2"} {
		wg.Add(1)
		go func(party string) {
			defer wg.Done()
			out, err := TrioECDHPhase1(server, session, party, partiesCSV)
			ch <- pres{out: out, err: err}
		}(p)
	}
	wg.Wait()
	close(ch)
	handles := []string{}
	for r := range ch {
		if r.err != nil {
			t.Fatalf("phase1: %v", r.err)
		}
		var decoded map[string]string
		if err := json.Unmarshal([]byte(r.out), &decoded); err != nil {
			t.Fatalf("decode: %v", err)
		}
		handles = append(handles, decoded["handle"])
	}
	if len(handles) != 2 {
		t.Fatalf("need 2 handles, got %d", len(handles))
	}
	if _, err := TrioECDHAbort(handles[0]); err != nil {
		t.Fatalf("abort: %v", err)
	}
	if _, err := TrioECDHConfirm(handles[0], session); err == nil {
		t.Fatalf("confirm after abort must fail (handle wiped)")
	}
	if _, err := TrioECDHConfirm(handles[1], session); err != nil {
		t.Fatalf("unaborted peer must still confirm: %v", err)
	}
}
