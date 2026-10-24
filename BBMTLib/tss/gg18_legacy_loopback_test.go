package tss

// 3b-6 follow-up (F10-GG18/F19): the JS legacy e2e proves routing
// (detection → gg18 branch → tokenized ceremony). This test proves
// the Go chain end-to-end: a tss_backend-less GG18 keyshare — the
// exact shape saveLocalStateData writes for production legacy
// users — loads through the real keysign path and produces a
// signature that verifies against the group pubkey.
//
// Two in-process GG18 parties talk over a loopback Messenger (no
// network); the test runs DKG, then threshold-signs, then verifies
// each party's response independently with crypto/ecdsa (on top of
// the in-Verify inside KeysignECDSA itself).
//
// Heavy (Paillier preparams + DKG + keysign): skipped under -short
// like the other ceremony integration tests.

import (
	"crypto/ecdsa"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"strings"
	"sync"
	"testing"

	"github.com/bnb-chain/tss-lib/v3/tss"
)

type loopbackAccessor struct {
	mu    sync.Mutex
	store map[string]string
}

func (a *loopbackAccessor) GetLocalState(pubKey string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.store[pubKey], nil
}

func (a *loopbackAccessor) SaveLocalState(pubkey, localState string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.store[pubkey] = localState
	return nil
}

type loopbackMessenger struct {
	peer  *ServiceImpl
	queue chan string
}

func newLoopbackMessenger() *loopbackMessenger {
	m := &loopbackMessenger{queue: make(chan string, 128)}
	go m.dispatch()
	return m
}

func (m *loopbackMessenger) setPeer(peer *ServiceImpl) {
	m.peer = peer
}

// Send enqueues for the loopback peer and returns immediately —
// like a real network transport. Synchronous delivery deadlocks:
// both parties' process loops call Send from inside their outbox
// case, so neither would be selecting its inbox (two-party
// ceremony, so from/to routing is exact without the envelope).
// A single dispatcher preserves FIFO per peer.
func (m *loopbackMessenger) Send(_, _, body string) error {
	m.queue <- body
	return nil
}

func (m *loopbackMessenger) dispatch() {
	for body := range m.queue {
		// Blocks until the peer's process loop receives; the
		// dispatcher is dedicated, so the sender never stalls.
		_ = m.peer.ApplyData(body)
	}
}

func TestF19_LegacyGG18LoopbackKeysign(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live GG18 ceremony under -short")
	}

	chainCode := strings.Repeat("cc", 32)
	accA := &loopbackAccessor{store: map[string]string{}}
	accB := &loopbackAccessor{store: map[string]string{}}
	msgAB := newLoopbackMessenger()
	msgBA := newLoopbackMessenger()

	// Preparams dominate runtime (safe-prime generation); build both
	// services concurrently. Distinct ppm files: each party needs
	// its own Paillier/DSA secrets.
	dir := t.TempDir()
	var svcA, svcB *ServiceImpl
	var errA, errB error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		svcA, errA = NewService(msgAB, accA, true, dir+"/a.ppm")
	}()
	go func() {
		defer wg.Done()
		svcB, errB = NewService(msgBA, accB, true, dir+"/b.ppm")
	}()
	wg.Wait()
	if errA != nil {
		t.Fatalf("NewService A: %v", errA)
	}
	if errB != nil {
		t.Fatalf("NewService B: %v", errB)
	}
	msgAB.setPeer(svcB)
	msgBA.setPeer(svcA)

	// DKG: both parties concurrently over the loopback.
	var respA, respB *KeygenResponse
	var kgErrA, kgErrB error
	wg.Add(2)
	go func() {
		defer wg.Done()
		respA, kgErrA = svcA.KeygenECDSA(&KeygenRequest{
			LocalPartyID: "p1",
			AllParties:   "p1,p2",
			ChainCodeHex: chainCode,
		})
	}()
	go func() {
		defer wg.Done()
		respB, kgErrB = svcB.KeygenECDSA(&KeygenRequest{
			LocalPartyID: "p2",
			AllParties:   "p1,p2",
			ChainCodeHex: chainCode,
		})
	}()
	wg.Wait()
	if kgErrA != nil {
		t.Fatalf("keygen A: %v", kgErrA)
	}
	if kgErrB != nil {
		t.Fatalf("keygen B: %v", kgErrB)
	}
	if respA.PubKey == "" || respA.PubKey != respB.PubKey {
		t.Fatalf("DKG pubkey mismatch: %q vs %q", respA.PubKey, respB.PubKey)
	}

	// The stored keyshare is the legacy shape: LocalState JSON with
	// no tss_backend field, routed to the GG18 path.
	storedA, err := accA.GetLocalState(respA.PubKey)
	if err != nil {
		t.Fatalf("GetLocalState A: %v", err)
	}
	if storedA == "" {
		t.Fatal("party A stored nothing")
	}
	if strings.Contains(storedA, "tss_backend") {
		t.Fatal("stored keyshare unexpectedly carries tss_backend")
	}
	if IsDKLsKeyshareJSON(storedA) {
		t.Fatal("legacy GG18 keyshare misrouted to DKLs")
	}
	var legacy LocalState
	if err := json.Unmarshal([]byte(storedA), &legacy); err != nil {
		t.Fatalf("legacy keyshare unparsable: %v", err)
	}
	if legacy.ECDSALocalData.ECDSAPub == nil || legacy.ChainCodeHex == "" {
		t.Fatal("legacy keyshare missing ecdsa pub or chaincode")
	}

	// Threshold sign: both parties concurrently over the loopback.
	msg := []byte("3b-6 legacy gg18 loopback")
	msgB64 := base64.StdEncoding.EncodeToString(msg)
	var sigA, sigB *KeysignResponse
	var ksErrA, ksErrB error
	wg.Add(2)
	go func() {
		defer wg.Done()
		sigA, ksErrA = svcA.KeysignECDSA(&KeysignRequest{
			PubKey:               respA.PubKey,
			MessageToSign:        msgB64,
			KeysignCommitteeKeys: "p1,p2",
			LocalPartyKey:        "p1",
			DerivePath:           "m/0/0",
		})
	}()
	go func() {
		defer wg.Done()
		sigB, ksErrB = svcB.KeysignECDSA(&KeysignRequest{
			PubKey:               respB.PubKey,
			MessageToSign:        msgB64,
			KeysignCommitteeKeys: "p1,p2",
			LocalPartyKey:        "p2",
			DerivePath:           "m/0/0",
		})
	}()
	wg.Wait()
	if ksErrA != nil {
		t.Fatalf("keysign A: %v", ksErrA)
	}
	if ksErrB != nil {
		t.Fatalf("keysign B: %v", ksErrB)
	}

	// Independent verification of each response against the
	// derived signing key (KeysignECDSA already verified
	// internally; this is the external check).
	verify := func(name string, sig *KeysignResponse) {
		t.Helper()
		if sig.R == "" || sig.S == "" || sig.DerSignature == "" {
			t.Fatalf("%s: empty signature fields", name)
		}
		r, ok := new(big.Int).SetString(sig.R, 16)
		if !ok {
			t.Fatalf("%s: bad R hex", name)
		}
		s, ok := new(big.Int).SetString(sig.S, 16)
		if !ok {
			t.Fatalf("%s: bad S hex", name)
		}
		if _, err := hex.DecodeString(sig.DerSignature); err != nil {
			t.Fatalf("%s: bad DER hex: %v", name, err)
		}
		// NOTE: the signature is over the derived (m/0/0) key, not
		// the group key — recompute the derived pubkey the same
		// way the signer does and verify against it.
		chainCodeBuf, _ := hex.DecodeString(legacy.ChainCodeHex)
		pathBuf, err := GetDerivePathBytes("m/0/0")
		if err != nil {
			t.Fatalf("%s: derive path: %v", name, err)
		}
		_, derivedKey, err := derivingPubkeyFromPath(
			legacy.ECDSALocalData.ECDSAPub, chainCodeBuf, pathBuf, tss.S256())
		if err != nil {
			t.Fatalf("%s: derive pubkey: %v", name, err)
		}
		if !ecdsa.Verify(&derivedKey.PublicKey, msg, r, s) {
			t.Fatalf("%s: signature does not verify", name)
		}
	}
	verify("party A", sigA)
	verify("party B", sigB)
}
