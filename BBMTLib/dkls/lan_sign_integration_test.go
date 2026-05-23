package dkls

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

func startTestRelay(t *testing.T, port string) {
	t.Helper()
	_, err := tss.RunRelay(port)
	if err != nil {
		t.Fatalf("RunRelay: %v", err)
	}
	t.Cleanup(func() { _, _ = tss.StopRelay() })
	waitForRelayHTTP("http://127.0.0.1:"+port, 3*time.Second)
}

func lanKeygenAll(t *testing.T, server, session, sessionKey, chaincode string, keys []string, partiesCSV string) map[string]string {
	t.Helper()
	type result struct {
		key string
		js  string
	}
	var wg sync.WaitGroup
	errs := make(chan error, len(keys))
	results := make(chan result, len(keys))
	run := func(key string) {
		defer wg.Done()
		out, e := JoinKeygen(key, partiesCSV, session, server, chaincode, sessionKey, "", "")
		if e != nil {
			errs <- e
			return
		}
		results <- result{key: key, js: out}
	}
	if os.Getenv("DKLS_LAN_SEQUENTIAL") == "1" {
		for _, key := range keys {
			out, e := JoinKeygen(key, partiesCSV, session, server, chaincode, sessionKey, "", "")
			if e != nil {
				errs <- e
				continue
			}
			results <- result{key: key, js: out}
		}
	} else {
		for i, key := range keys {
			wg.Add(1)
			go run(key)
			if i < len(keys)-1 {
				time.Sleep(2 * time.Second)
			}
		}
		wg.Wait()
	}
	close(errs)
	close(results)
	var errList []error
	for e := range errs {
		errList = append(errList, e)
	}
	out := make(map[string]string, len(keys))
	for r := range results {
		out[r.key] = r.js
	}
	if len(errList) > 0 {
		t.Fatalf("JoinKeygen errors (%d ok): %v", len(out), errList)
	}
	if len(out) != len(keys) {
		t.Fatalf("expected %d keyshares, got %d", len(keys), len(out))
	}
	return out
}

func lanKeysignAll(
	t *testing.T,
	server, session, sessionKey, partiesCSV string,
	keys []string,
	keyshares []string,
	sighashB64 string,
) string {
	t.Helper()
	if len(keys) != len(keyshares) {
		t.Fatalf("keys/keyshares length mismatch")
	}
	var wg sync.WaitGroup
	errs := make(chan error, len(keys))
	results := make(chan string, len(keys))
	run := func(key, ksJSON string) {
		defer wg.Done()
		out, e := JoinKeysignWithSighash(
			server, key, partiesCSV, session, sessionKey, "", "", ksJSON, "", sighashB64,
		)
		if e != nil {
			errs <- e
			return
		}
		results <- out
	}
	for i := range keys {
		wg.Add(1)
		go run(keys[i], keyshares[i])
		if i < len(keys)-1 {
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
		t.Fatalf("JoinKeysignWithSighash errors (%d ok): %v", len(sigs), errList)
	}
	if len(sigs) != len(keys) {
		t.Fatalf("expected %d signatures, got %d", len(keys), len(sigs))
	}
	return sigs[0]
}

func verifyLanKeysignResult(t *testing.T, ksJSON, sigJSON string, msg []byte) {
	t.Helper()
	share, meta, err := ImportKeyshare(ksJSON)
	if err != nil {
		t.Fatalf("ImportKeyshare: %v", err)
	}
	defer share.Free()

	var resp struct {
		R string `json:"r"`
		S string `json:"s"`
	}
	if err := json.Unmarshal([]byte(sigJSON), &resp); err != nil {
		t.Fatalf("parse keysign response: %v", err)
	}
	if resp.R == "" || resp.S == "" {
		t.Fatalf("empty r/s in response")
	}

	groupKey, err := decodeGroupPubKey(meta.PubKey)
	if err != nil {
		t.Fatalf("group key: %v", err)
	}
	sigData, err := parseSigHex(resp.R, resp.S)
	if err != nil {
		t.Fatalf("parse sig: %v", err)
	}
	valid, err := libtss.Verify(libtss.CiphersuiteSecp256k1ECDSA, msg, sigData, groupKey)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !valid {
		t.Fatal("signature invalid")
	}
}

func decodeGroupPubKey(hexKey string) ([]byte, error) {
	return hex.DecodeString(hexKey)
}

func parseSigHex(rHex, sHex string) ([]byte, error) {
	r, err := hex.DecodeString(rHex)
	if err != nil {
		return nil, err
	}
	s, err := hex.DecodeString(sHex)
	if err != nil {
		return nil, err
	}
	if len(r) < 32 || len(s) < 32 {
		return nil, fmt.Errorf("short r/s")
	}
	out := make([]byte, 64)
	copy(out[:32], r[len(r)-32:])
	copy(out[32:], s[len(s)-32:])
	return out, nil
}

// testMpcLanKeysignDuo: 2-of-2 LAN keysign (Send BTC / PSBT sighash path).
func testMpcLanKeysignDuo(t *testing.T) {
	t.Helper()
	const port = "55997"
	startTestRelay(t, port)
	server := "http://127.0.0.1:" + port
	chaincode := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

	kgSession := "test-lan-kg-duo-sign"
	sessionKey := testSessionHex(t, 32)
	parties := "KeyShare1,KeyShare2"
	keys := []string{"KeyShare1", "KeyShare2"}
	shareByKey := lanKeygenAll(t, server, kgSession, sessionKey, chaincode, keys, parties)
	keyshares := []string{shareByKey["KeyShare1"], shareByKey["KeyShare2"]}

	msg := []byte("bitcoin-lan-sign-duo")
	hash := HashMessageForDKLs(msg)
	sighashB64 := base64.StdEncoding.EncodeToString(hash)

	signSession := "test-lan-sign-duo"
	sigJSON := lanKeysignAll(t, server, signSession, sessionKey, parties, keys, keyshares, sighashB64)
	verifyLanKeysignResult(t, keyshares[0], sigJSON, msg)
}

// testMpcLanKeysignTrioSubset: 2-of-3 LAN keysign with two participating KeyShares.
func testMpcLanKeysignTrioSubset(t *testing.T) {
	t.Helper()
	const port = "55996"
	startTestRelay(t, port)
	server := "http://127.0.0.1:" + port
	chaincode := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

	kgSession := "test-lan-kg-trio-sign"
	sessionKey := testSessionHex(t, 32)
	allParties := "KeyShare1,KeyShare2,KeyShare3"
	allKeys := []string{"KeyShare1", "KeyShare2", "KeyShare3"}
	shareByKey := lanKeygenAll(t, server, kgSession, sessionKey, chaincode, allKeys, allParties)

	msg := []byte("bitcoin-lan-sign-trio")
	hash := HashMessageForDKLs(msg)
	sighashB64 := base64.StdEncoding.EncodeToString(hash)

	signParties := "KeyShare1,KeyShare3"
	signKeys := []string{"KeyShare1", "KeyShare3"}
	signShares := []string{shareByKey["KeyShare1"], shareByKey["KeyShare3"]}

	signSession := "test-lan-sign-trio"
	sigJSON := lanKeysignAll(t, server, signSession, sessionKey, signParties, signKeys, signShares, sighashB64)
	verifyLanKeysignResult(t, signShares[0], sigJSON, msg)
}

// Duo LAN keysign (Send BTC / PSBT sighash path) after HTTP relay keygen.
func TestLanKeysignDuo(t *testing.T) {
	testMpcLanKeysignDuo(t)
}

// Trio 2-of-3 subset LAN keysign (KeyShare1 + KeyShare3), same as trio spend.
func TestLanKeysignTrioSubset(t *testing.T) {
	testMpcLanKeysignTrioSubset(t)
}
