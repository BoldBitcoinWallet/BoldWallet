package dkls

import (
	"encoding/json"
	"net"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	nostr "github.com/nbd-wtf/go-nostr"
)

const defaultNostrTestRelay = "ws://127.0.0.1:7777"

// requireNostrRelay skips unless a Nostr relay is reachable (e.g. scripts/start-local-relay.sh).
func requireNostrRelay(t *testing.T) string {
	t.Helper()
	relays := os.Getenv("RELAYS")
	if relays == "" {
		relays = defaultNostrTestRelay
	}
	host, port, ok := relayTCPAddr(strings.Split(relays, ",")[0])
	if !ok {
		t.Fatalf("invalid relay URL %q", relays)
	}
	addr := net.JoinHostPort(host, port)
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		t.Skipf("nostr relay not reachable at %s (%s): %v — run BBMTLib/scripts/start-local-relay.sh", relays, addr, err)
	}
	_ = conn.Close()
	return relays
}

func relayTCPAddr(relayURL string) (host, port string, ok bool) {
	relayURL = strings.TrimSpace(relayURL)
	relayURL = strings.TrimPrefix(relayURL, "ws://")
	relayURL = strings.TrimPrefix(relayURL, "wss://")
	if relayURL == "" {
		return "", "", false
	}
	if strings.Contains(relayURL, "/") {
		relayURL = strings.SplitN(relayURL, "/", 2)[0]
	}
	host, port, err := net.SplitHostPort(relayURL)
	if err != nil {
		// host only, default ws port
		return relayURL, "7777", true
	}
	return host, port, true
}

func generateNostrKeypair(t *testing.T) (nsec, npub string) {
	t.Helper()
	nsec = nostr.GeneratePrivateKey()
	var err error
	npub, err = tss.DeriveNpubFromNsec(nsec)
	if err != nil {
		t.Fatalf("DeriveNpubFromNsec: %v", err)
	}
	return nsec, npub
}

type nostrParty struct {
	nsec string
	npub string
}

func nostrPartiesCSV(parties []nostrParty) string {
	npubs := make([]string, len(parties))
	for i, p := range parties {
		npubs[i] = p.npub
	}
	return strings.Join(sortedPartiesNpubs(npubs), ",")
}

func nostrKeygenAll(
	t *testing.T,
	relays, sessionID, sessionKey, chaincode string,
	parties []nostrParty,
) map[string]string {
	t.Helper()
	allParties := nostrPartiesCSV(parties)
	type result struct {
		npub string
		js   string
	}
	var wg sync.WaitGroup
	errs := make(chan error, len(parties))
	results := make(chan result, len(parties))
	run := func(p nostrParty) {
		defer wg.Done()
		out, e := NostrJoinKeygen(relays, p.nsec, allParties, sessionID, sessionKey, chaincode)
		if e != nil {
			errs <- e
			return
		}
		results <- result{npub: p.npub, js: out}
	}
	for i, p := range parties {
		wg.Add(1)
		go run(p)
		if i < len(parties)-1 {
			time.Sleep(2 * time.Second)
		}
	}
	wg.Wait()
	close(errs)
	close(results)
	var errList []error
	for e := range errs {
		errList = append(errList, e)
	}
	out := make(map[string]string, len(parties))
	for r := range results {
		out[r.npub] = r.js
	}
	if len(errList) > 0 {
		t.Fatalf("NostrJoinKeygen errors (%d ok): %v", len(out), errList)
	}
	if len(out) != len(parties) {
		t.Fatalf("expected %d keyshares, got %d", len(parties), len(out))
	}
	for npub, js := range out {
		if err := ValidateKeyshareJSON(js); err != nil {
			t.Fatalf("invalid keyshare: %v", err)
		}
		assertNostrKeyshareHasNsec(t, npub, parties, js)
	}
	return out
}

func assertNostrKeyshareHasNsec(t *testing.T, npub string, parties []nostrParty, js string) {
	t.Helper()
	var ks KeyshareJSON
	if err := json.Unmarshal([]byte(js), &ks); err != nil {
		t.Fatalf("parse keyshare for %s: %v", npub, err)
	}
	if ks.NostrNpub == "" {
		t.Fatalf("keyshare for %s: missing nostr_npub", npub)
	}
	if ks.NsecHex == "" {
		t.Fatalf("keyshare for %s: missing nsec", npub)
	}
	var wantNsec string
	for _, p := range parties {
		if p.npub == npub {
			wantNsec = p.nsec
			break
		}
	}
	if wantNsec == "" {
		t.Fatalf("no party nsec for npub %s", npub)
	}
	got, err := NsecFromKeyshareField(ks.NsecHex)
	if err != nil {
		t.Fatalf("keyshare for %s: decode nsec: %v", npub, err)
	}
	if got != wantNsec {
		t.Fatalf("keyshare for %s: nsec mismatch", npub)
	}
}

func nostrKeysignAll(
	t *testing.T,
	relays, sessionID, sessionKey, partiesCSV string,
	parties []nostrParty,
	keyshares []string,
	sighashB64 string,
) string {
	t.Helper()
	if len(parties) != len(keyshares) {
		t.Fatalf("parties/keyshares length mismatch")
	}
	var wg sync.WaitGroup
	errs := make(chan error, len(parties))
	results := make(chan string, len(parties))
	run := func(p nostrParty, ksJSON string) {
		defer wg.Done()
		out, e := NostrJoinKeysignWithSighash(
			relays, p.nsec, partiesCSV, sessionID, sessionKey, ksJSON, "", sighashB64,
		)
		if e != nil {
			errs <- e
			return
		}
		results <- out
	}
	for i, p := range parties {
		wg.Add(1)
		go run(p, keyshares[i])
		if i < len(parties)-1 {
			time.Sleep(2 * time.Second)
		}
	}
	wg.Wait()
	close(errs)
	close(results)
	var errList []error
	for e := range errs {
		errList = append(errList, e)
	}
	var sigs []string
	for s := range results {
		sigs = append(sigs, s)
	}
	if len(errList) > 0 {
		t.Fatalf("NostrJoinKeysignWithSighash errors (%d ok): %v", len(sigs), errList)
	}
	if len(sigs) != len(parties) {
		t.Fatalf("expected %d signatures, got %d", len(parties), len(sigs))
	}
	return sigs[0]
}

func nostrKeysignRawAll(
	t *testing.T,
	relays, sessionID, sessionKey, partiesCSV, message string,
	parties []nostrParty,
	keyshares []string,
) string {
	t.Helper()
	if len(parties) != len(keyshares) {
		t.Fatalf("parties/keyshares length mismatch")
	}
	var wg sync.WaitGroup
	errs := make(chan error, len(parties))
	results := make(chan string, len(parties))
	run := func(p nostrParty, ksJSON string) {
		defer wg.Done()
		out, e := NostrJoinKeysign(
			relays, p.nsec, partiesCSV, sessionID, sessionKey, ksJSON, message,
		)
		if e != nil {
			errs <- e
			return
		}
		results <- out
	}
	for i, p := range parties {
		wg.Add(1)
		go run(p, keyshares[i])
		if i < len(parties)-1 {
			time.Sleep(2 * time.Second)
		}
	}
	wg.Wait()
	close(errs)
	close(results)
	var errList []error
	for e := range errs {
		errList = append(errList, e)
	}
	var sigs []string
	for s := range results {
		sigs = append(sigs, s)
	}
	if len(errList) > 0 {
		t.Fatalf("NostrJoinKeysign errors (%d ok): %v", len(sigs), errList)
	}
	if len(sigs) != len(parties) {
		t.Fatalf("expected %d signatures, got %d", len(parties), len(sigs))
	}
	return sigs[0]
}
