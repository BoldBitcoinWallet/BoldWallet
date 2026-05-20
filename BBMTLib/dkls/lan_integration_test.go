package dkls

import (
	"sync"
	"testing"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

// Two-party LAN DKG against the HTTP relay (same path as mobile duo setup).
func TestLanJoinKeygenDuo(t *testing.T) {
	const port = "55999"
	_, err := tss.RunRelay(port)
	if err != nil {
		t.Fatalf("RunRelay: %v", err)
	}
	defer func() { _, _ = tss.StopRelay() }()
	time.Sleep(2 * time.Second)

	server := "http://127.0.0.1:" + port
	chaincode := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	session := "test-lan-session-duo"
	sessionKey := testSessionHex(t, 32)

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	results := make(chan string, 2)

	run := func(key, parties string) {
		defer wg.Done()
		out, e := JoinKeygen(key, parties, session, server, chaincode, sessionKey, "", "")
		if e != nil {
			errs <- e
			return
		}
		results <- out
	}

	// Sequential join (master then peer) mirrors mobile: Start Setup before Join Setup.
	wg.Add(2)
	go run("KeyShare1", "KeyShare1,KeyShare2")
	time.Sleep(2 * time.Second)
	go run("KeyShare2", "KeyShare2,KeyShare1")
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
	if len(jsons) != 2 {
		t.Fatalf("expected 2 keyshares, got %d (errors %v)", len(jsons), errList)
	}
	for _, js := range jsons {
		if err := ValidateKeyshareJSON(js); err != nil {
			t.Fatalf("invalid keyshare: %v", err)
		}
	}
}

// Three-party LAN DKG against the HTTP relay (same path as mobile trio setup).
func TestLanJoinKeygenTrio(t *testing.T) {
	const port = "55998"
	_, err := tss.RunRelay(port)
	if err != nil {
		t.Fatalf("RunRelay: %v", err)
	}
	defer func() { _, _ = tss.StopRelay() }()
	time.Sleep(2 * time.Second)

	server := "http://127.0.0.1:" + port
	chaincode := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	session := "test-lan-session-trio"
	parties := "KeyShare1,KeyShare2,KeyShare3"
	sessionKey := testSessionHex(t, 32)

	var wg sync.WaitGroup
	errs := make(chan error, 3)
	results := make(chan string, 3)

	run := func(key string) {
		defer wg.Done()
		out, e := JoinKeygen(key, parties, session, server, chaincode, sessionKey, "", "")
		if e != nil {
			errs <- e
			return
		}
		results <- out
	}

	wg.Add(3)
	go run("KeyShare1")
	time.Sleep(2 * time.Second)
	go run("KeyShare2")
	time.Sleep(2 * time.Second)
	go run("KeyShare3")
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
	if len(jsons) != 3 {
		t.Fatalf("expected 3 keyshares, got %d (errors %v)", len(jsons), errList)
	}
	for _, js := range jsons {
		if err := ValidateKeyshareJSON(js); err != nil {
			t.Fatalf("invalid keyshare: %v", err)
		}
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

// In-process channels only (no HTTP) — validates runDKGWithSender.
func TestRunDKGWithSenderInProcess(t *testing.T) {
	threshold := ThresholdDuo()
	sessionID := []byte("router-dkg-test")
	ch1 := make(chan []libtss.Message, 16)
	ch2 := make(chan []libtss.Message, 16)
	errs := make(chan error, 2)
	run := func(id libtss.Identifier, inCh <-chan []libtss.Message, runner *localDKGRunner) {
		_, _, err := runDKGWithSender(
			"s", id, sessionID, threshold,
			runner,
			inCh,
		)
		errs <- err
	}
	go run(libtss.Identifier(1), ch1, &localDKGRunner{selfID: 1, peerCh: map[libtss.Identifier]chan []libtss.Message{2: ch2}})
	go run(libtss.Identifier(2), ch2, &localDKGRunner{selfID: 2, peerCh: map[libtss.Identifier]chan []libtss.Message{1: ch1}})
	var errList []error
	for i := 0; i < 2; i++ {
		if e := <-errs; e != nil {
			errList = append(errList, e)
		}
	}
	if len(errList) > 0 {
		t.Fatalf("runDKGWithSender in-process duo: %v", errList)
	}
}

