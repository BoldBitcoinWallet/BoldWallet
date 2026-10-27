package dkls

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	nostr "github.com/nbd-wtf/go-nostr"
)

// freshTestKeyshareJSON runs an in-process DKG and exports share 0.
func freshTestKeyshareJSON(t *testing.T) string {
	t.Helper()
	shares, _, err := RunDKGInProcess([]byte("f2-binding"))
	if err != nil {
		t.Fatalf("dkg: %v", err)
	}
	defer shares[0].Free()
	defer shares[1].Free()
	jsonStr, err := KeyshareJSONFromHandle(shares[0], "aa", []string{"party1", "party2"}, "party1", "", "")
	if err != nil {
		t.Fatalf("export json: %v", err)
	}
	return jsonStr
}

func retagKeyshareJSON(t *testing.T, jsonStr string, mutate func(*KeyshareJSON)) string {
	t.Helper()
	var ks KeyshareJSON
	if err := json.Unmarshal([]byte(jsonStr), &ks); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	mutate(&ks)
	out, err := json.Marshal(ks)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(out)
}

func TestF2_CorrectPubKey_Accepts(t *testing.T) {
	share, ks, err := ImportKeyshare(freshTestKeyshareJSON(t))
	if err != nil {
		t.Fatalf("valid import rejected: %v", err)
	}
	defer share.Free()
	if ks.PubKey == "" {
		t.Fatal("empty pubkey on valid import")
	}
}

func TestF2_PubKeyMismatch_Rejects(t *testing.T) {
	good := freshTestKeyshareJSON(t)
	tampered := retagKeyshareJSON(t, good, func(ks *KeyshareJSON) {
		b := []byte(ks.PubKey)
		if b[len(b)-1] == '0' {
			b[len(b)-1] = '1'
		} else {
			b[len(b)-1] = '0'
		}
		ks.PubKey = string(b)
	})
	share, _, err := ImportKeyshare(tampered)
	if err == nil {
		share.Free()
		t.Fatal("tampered pub_key accepted")
	}
	if !strings.Contains(err.Error(), "keyshare binding") {
		t.Fatalf("wrong error: %v", err)
	}
}

func TestF2_EmptyPubKey_Rejects(t *testing.T) {
	good := freshTestKeyshareJSON(t)
	tampered := retagKeyshareJSON(t, good, func(ks *KeyshareJSON) { ks.PubKey = "" })
	if _, _, err := ImportKeyshare(tampered); err == nil {
		t.Fatal("empty pub_key accepted")
	}
}

func TestF2_SuiteMismatch_Rejects(t *testing.T) {
	good := freshTestKeyshareJSON(t)
	tampered := retagKeyshareJSON(t, good, func(ks *KeyshareJSON) { ks.Suite = 2 })
	if _, _, err := ImportKeyshare(tampered); err == nil {
		t.Fatal("wrong suite label accepted")
	}
}

func TestF2_SuiteAbsent_Accepts(t *testing.T) {
	// Documented leniency: field-absent (0) skips the suite check, but the
	// pubkey binding still applies.
	good := freshTestKeyshareJSON(t)
	noSuite := retagKeyshareJSON(t, good, func(ks *KeyshareJSON) { ks.Suite = 0 })
	share, _, err := ImportKeyshare(noSuite)
	if err != nil {
		t.Fatalf("suite-absent import rejected: %v", err)
	}
	share.Free()
}

func TestF2_CallerPaths_RejectTampered(t *testing.T) {
	good := freshTestKeyshareJSON(t)
	tampered := retagKeyshareJSON(t, good, func(ks *KeyshareJSON) {
		ks.PubKey = strings.Repeat("ab", 33) // valid-looking compressed key
	})
	nsec := nostr.GeneratePrivateKey()
	sighash := base64.StdEncoding.EncodeToString(make([]byte, 32))

	cases := []struct {
		name string
		call func() (string, error)
	}{
		{"nostr.go keysign", func() (string, error) {
			return NostrJoinKeysign("wss://relay.test", nsec, "npub1x,npub1y", "sess", "key", tampered, "msg")
		}},
		{"lan.go keysign", func() (string, error) {
			// F32: explicit session key (all-empty no longer derives) so
			// the tampered share still reaches the binding check.
			return JoinKeysign("http://127.0.0.1:9", "k", "KeyShare1,KeyShare2", "sess", strings.Repeat("cd", 32), "", "", tampered, "msg")
		}},
		{"keysign.go nostr sighash", func() (string, error) {
			return NostrJoinKeysignWithSighash("wss://relay.test", nsec, "npub1x,npub1y", "sess", "key", tampered, "m/0", sighash)
		}},
		{"keysign.go lan sighash", func() (string, error) {
			// F32: explicit session key (all-empty no longer derives) so
			// the tampered share still reaches the binding check.
			return JoinKeysignWithSighash("http://127.0.0.1:9", "k", "KeyShare1,KeyShare2", "sess", strings.Repeat("cd", 32), "", "", tampered, "m/0", sighash)
		}},
	}
	for _, tc := range cases {
		if _, err := tc.call(); err == nil {
			t.Fatalf("%s: tampered keyshare accepted", tc.name)
		} else if !strings.Contains(err.Error(), "keyshare binding") {
			t.Fatalf("%s: wrong error: %v", tc.name, err)
		}
	}
}
