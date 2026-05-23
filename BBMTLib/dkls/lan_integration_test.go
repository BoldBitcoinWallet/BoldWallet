package dkls

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

func TestMain(m *testing.M) {
	if os.Getenv("DKLS_TEST_DKG_SEC") == "" {
		_ = os.Setenv("DKLS_TEST_DKG_SEC", "90")
	}
	if os.Getenv("DKLS_LAN_PUMP_MS") == "" {
		_ = os.Setenv("DKLS_LAN_PUMP_MS", "100")
	}
	os.Exit(m.Run())
}

func freeTestPort(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("freeTestPort: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	return fmt.Sprintf("%d", port)
}

const trioPartiesCSV = "KeyShare1,KeyShare2,KeyShare3"

var trioCommittee = []string{"KeyShare1", "KeyShare2", "KeyShare3"}

type trioKeygenOpts struct {
	port       string
	session    string
	sessionKey string // empty derives AES key from session+server (mobile trio path)
	staggerMs  []int  // per-party delay before JoinKeygen (0 = simultaneous)
}

func assertTrioKeysharesConsistent(t *testing.T, jsons []string) {
	t.Helper()
	if len(jsons) != 3 {
		t.Fatalf("expected 3 keyshares, got %d", len(jsons))
	}
	var pub string
	for i, raw := range jsons {
		if err := ValidateKeyshareJSON(raw); err != nil {
			t.Fatalf("keyshare %d invalid: %v", i, err)
		}
		var ks KeyshareJSON
		if err := json.Unmarshal([]byte(raw), &ks); err != nil {
			t.Fatalf("parse keyshare %d: %v", i, err)
		}
		if ks.LocalPartyKey == "" {
			t.Fatalf("keyshare %d missing local_party_key", i)
		}
		if !containsAllParties(ks.KeygenCommitteeKeys, trioCommittee) {
			t.Fatalf("keyshare %d committee %v want %v", i, ks.KeygenCommitteeKeys, trioCommittee)
		}
		if pub == "" {
			pub = ks.PubKey
		} else if ks.PubKey != pub {
			t.Fatalf("pub_key mismatch: %s vs %s (party %s)", pub, ks.PubKey, ks.LocalPartyKey)
		}
	}
	roles := make([]string, 0, 3)
	for _, raw := range jsons {
		var ks KeyshareJSON
		_ = json.Unmarshal([]byte(raw), &ks)
		roles = append(roles, ks.LocalPartyKey)
	}
	sort.Strings(roles)
	want := append([]string(nil), trioCommittee...)
	sort.Strings(want)
	if strings.Join(roles, ",") != strings.Join(want, ",") {
		t.Fatalf("local_party_key set %v want one of each KeyShare1/2/3", roles)
	}
}

func containsAllParties(have, need []string) bool {
	m := make(map[string]int)
	for _, p := range have {
		m[p]++
	}
	for _, p := range need {
		if m[p] == 0 {
			return false
		}
		m[p]--
	}
	return true
}

// runLanJoinKeygenTrio runs 3-party LAN DKG (mobile trio path).
func runLanJoinKeygenTrio(t *testing.T, opts trioKeygenOpts) {
	t.Helper()
	if opts.port == "" {
		opts.port = freeTestPort(t)
	}
	if opts.session == "" {
		opts.session = "test-lan-session-trio"
	}
	if len(opts.staggerMs) == 0 {
		opts.staggerMs = []int{0, 2000, 4000}
	}

	server := "http://127.0.0.1:" + opts.port
	_, _ = tss.StopRelay()
	time.Sleep(300 * time.Millisecond)
	_, err := tss.RunRelay(opts.port)
	if err != nil {
		t.Fatalf("RunRelay: %v", err)
	}
	defer func() { _, _ = tss.StopRelay() }()
	waitForRelayHTTP(server, 3*time.Second)
	chaincode := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	keys := []string{"KeyShare1", "KeyShare2", "KeyShare3"}

	var wg sync.WaitGroup
	errs := make(chan error, 3)
	results := make(chan string, 3)

	run := func(key string) {
		defer wg.Done()
		out, e := JoinKeygen(
			key, trioPartiesCSV, opts.session, server, chaincode,
			opts.sessionKey, "", "",
		)
		if e != nil {
			errs <- e
			return
		}
		results <- out
	}

	for i, key := range keys {
		delay := 0
		if i < len(opts.staggerMs) {
			delay = opts.staggerMs[i]
		}
		wg.Add(1)
		go func(k string, ms int) {
			if ms > 0 {
				time.Sleep(time.Duration(ms) * time.Millisecond)
			}
			run(k)
		}(key, delay)
	}
	wg.Wait()
	close(errs)
	close(results)

	var errList []error
	for e := range errs {
		errList = append(errList, e)
	}
	var jsons []string
	for r := range results {
		jsons = append(jsons, r)
	}
	if len(errList) > 0 {
		t.Fatalf("JoinKeygen errors (%d ok): %v", len(jsons), errList)
	}
	assertTrioKeysharesConsistent(t, jsons)
}

// testMpcLanKeygenDuo runs 2-of-2 LAN DKG via HTTP relay (mobile duo setup path).
func testMpcLanKeygenDuo(t *testing.T) {
	t.Helper()
	port := freeTestPort(t)
	server := "http://127.0.0.1:" + port
	_, _ = tss.StopRelay()
	time.Sleep(300 * time.Millisecond)
	_, err := tss.RunRelay(port)
	if err != nil {
		t.Fatalf("RunRelay: %v", err)
	}
	defer func() { _, _ = tss.StopRelay() }()
	waitForRelayHTTP(server, 3*time.Second)
	chaincode := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	session := "test-lan-session-duo"
	sessionKey := testSessionHex(t, 32)
	keys := []string{"KeyShare1", "KeyShare2"}
	shareByKey := lanKeygenAll(t, server, session, sessionKey, chaincode, keys, "KeyShare1,KeyShare2")
	if len(shareByKey) != 2 {
		t.Fatalf("expected 2 keyshares, got %d", len(shareByKey))
	}
	for _, js := range shareByKey {
		if err := ValidateKeyshareJSON(js); err != nil {
			t.Fatalf("invalid keyshare: %v", err)
		}
	}
}

// testMpcLanKeygenTrio runs 2-of-3 LAN DKG via HTTP relay (mobile trio setup path).
func testMpcLanKeygenTrio(t *testing.T) {
	t.Helper()
	runLanJoinKeygenTrio(t, trioKeygenOpts{
		session:    "test-lan-session-trio",
		sessionKey: testSessionHex(t, 32),
		staggerMs:  []int{0, 2000, 4000},
	})
}

// Two-party LAN DKG against the HTTP relay (same path as mobile duo setup).
func TestLanJoinKeygenDuo(t *testing.T) {
	testMpcLanKeygenDuo(t)
}

func TestLanJoinKeygenTrio(t *testing.T) {
	testMpcLanKeygenTrio(t)
}

func TestLanJoinKeygenTrioSimultaneous(t *testing.T) {
	runLanJoinKeygenTrio(t, trioKeygenOpts{
		session:    "test-lan-trio-simul",
		sessionKey: testSessionHex(t, 32),
		staggerMs:  []int{0, 0, 0},
	})
}

func TestLanJoinKeygenTrioStaggerMobile(t *testing.T) {
	runLanJoinKeygenTrio(t, trioKeygenOpts{
		session:    "test-lan-trio-mobile-stagger",
		sessionKey: testSessionHex(t, 32),
		staggerMs:  []int{0, 2000, 4000},
	})
}

func TestLanJoinKeygenTrioDerivedSessionKey(t *testing.T) {
	runLanJoinKeygenTrio(t, trioKeygenOpts{
		session: "test-lan-trio-derived-session",
		sessionKey: "",
		staggerMs:  []int{0, 2000, 4000},
	})
}

func TestLanJoinKeygenTrioRepeated(t *testing.T) {
	if testing.Short() {
		t.Skip("trio LAN stress test")
	}
	for i := 0; i < 3; i++ {
		runLanJoinKeygenTrio(t, trioKeygenOpts{
			session:    fmt.Sprintf("test-lan-trio-stress-%d", i+1),
			sessionKey: testSessionHex(t, 32),
			staggerMs:  []int{0, 2000, 4000},
		})
		time.Sleep(500 * time.Millisecond)
	}
}

func ValidateKeyshareJSON(raw string) error {
	_, _, err := ImportKeyshare(raw)
	return err
}

type localDKGRunner struct {
	selfID libtss.Identifier
	peerCh map[libtss.Identifier]chan []libtss.Message
}

func (r *localDKGRunner) sendMessages(msgs []libtss.Message) error {
	for id, ch := range r.peerCh {
		if id == r.selfID {
			continue
		}
		if batch := filterMessagesFor(id, msgs); len(batch) > 0 {
			ch <- batch
		}
	}
	return nil
}

type routerDKGSender struct {
	selfID libtss.Identifier
	router *MessageRouter
}

func (s *routerDKGSender) sendMessages(msgs []libtss.Message) error {
	s.router.Post(s.selfID, msgs)
	return nil
}

func startRouterPump(router *MessageRouter, selfID libtss.Identifier, roundCh chan<- []libtss.Message, stop <-chan struct{}, wg *sync.WaitGroup) {
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			msgs := router.Drain(selfID)
			if len(msgs) > 0 {
				select {
				case roundCh <- msgs:
				case <-stop:
					return
				}
			}
			select {
			case <-router.notify[selfID]:
			case <-stop:
				return
			}
		}
	}()
}

func TestRunDKGWithSenderInProcess(t *testing.T) {
	threshold := ThresholdDuo()
	sessionID := []byte("router-dkg-test")
	router := NewMessageRouter([]libtss.Identifier{1, 2})
	stop := make(chan struct{})
	var pumpWG sync.WaitGroup
	ch1 := make(chan []libtss.Message, 256)
	ch2 := make(chan []libtss.Message, 256)
	startRouterPump(router, 1, ch1, stop, &pumpWG)
	startRouterPump(router, 2, ch2, stop, &pumpWG)
	errs := make(chan error, 2)
	run := func(id libtss.Identifier, inCh <-chan []libtss.Message) {
		_, _, err := runDKGWithSender(
			"s", id, sessionID, threshold,
			&routerDKGSender{selfID: id, router: router},
			inCh,
		)
		errs <- err
	}
	go run(libtss.Identifier(1), ch1)
	go run(libtss.Identifier(2), ch2)
	var errList []error
	for i := 0; i < 2; i++ {
		if e := <-errs; e != nil {
			errList = append(errList, e)
		}
	}
	close(stop)
	pumpWG.Wait()
	if len(errList) > 0 {
		t.Fatalf("runDKGWithSender in-process duo: %v", errList)
	}
}

func TestRunDKGWithSenderTrioInProcess(t *testing.T) {
	threshold := ThresholdTrio()
	sessionID := []byte("router-dkg-trio-test")
	router := NewMessageRouter([]libtss.Identifier{1, 2, 3})
	stop := make(chan struct{})
	var pumpWG sync.WaitGroup
	ch1 := make(chan []libtss.Message, 256)
	ch2 := make(chan []libtss.Message, 256)
	ch3 := make(chan []libtss.Message, 256)
	startRouterPump(router, 1, ch1, stop, &pumpWG)
	startRouterPump(router, 2, ch2, stop, &pumpWG)
	startRouterPump(router, 3, ch3, stop, &pumpWG)
	type partyResult struct {
		share *libtss.KeyShareHandle
		pub   libtss.PublicKeyPackage
		err   error
	}
	results := make(chan partyResult, 3)
	run := func(id libtss.Identifier, inCh <-chan []libtss.Message) {
		share, pub, err := runDKGWithSender(
			"s", id, sessionID, threshold,
			&routerDKGSender{selfID: id, router: router},
			inCh,
		)
		results <- partyResult{share: share, pub: pub, err: err}
	}
	go run(libtss.Identifier(1), ch1)
	go run(libtss.Identifier(2), ch2)
	go run(libtss.Identifier(3), ch3)
	chaincode := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	var jsons []string
	for i := 0; i < 3; i++ {
		r := <-results
		if r.err != nil {
			t.Fatalf("runDKGWithSender in-process trio party %d: %v", i+1, r.err)
		}
		if r.share == nil {
			t.Fatalf("party %d: nil share", i+1)
		}
		defer r.share.Free()
		key := trioCommittee[i]
		ks, err := KeyshareJSONFromHandle(r.share, chaincode, trioCommittee, key, "", "")
		if err != nil {
			t.Fatalf("export %s: %v", key, err)
		}
		jsons = append(jsons, ks)
	}
	close(stop)
	pumpWG.Wait()
	assertTrioKeysharesConsistent(t, jsons)
}

