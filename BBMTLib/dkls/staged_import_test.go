package dkls

// F15b-1 staged import/persist orchestration tests. ONE in-process
// DKG feeds all subtests (DKG is slow); each subtest cleans the
// single staged slot when it stages.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/BoldBitcoinWallet/BBMTLib/internal/keyhandles"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

func legacyBlobForTest(t *testing.T, plaintext, password string) string {
	t.Helper()
	sum := sha256.Sum256([]byte(password))
	blob, err := tss.AesEncrypt(plaintext, hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatalf("legacy encrypt: %v", err)
	}
	return blob
}

func mustParseStaged(t *testing.T, raw string) (handle string, meta map[string]any, legacy bool) {
	t.Helper()
	var s struct {
		Handle   string          `json:"handle"`
		Metadata json.RawMessage `json:"metadata"`
		Legacy   bool            `json:"legacy"`
	}
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		t.Fatalf("staged shape: %v", err)
	}
	if err := json.Unmarshal(s.Metadata, &meta); err != nil {
		t.Fatalf("staged metadata: %v", err)
	}
	return s.Handle, meta, s.Legacy
}

func assertNoShareBytes(t *testing.T, where, s string) {
	t.Helper()
	for _, secret := range []string{"share_b64", "ecdsa_local_data",
		`"nsec"`, "nsec1", "sessionKeyHex"} {
		if strings.Contains(s, secret) {
			t.Errorf("%s leaks %q", where, secret)
		}
	}
}

func TestF15b1_NoUnstagedKeygenResolve(t *testing.T) {
	// Guardrail: bbmtmobile must never resolve raw DKG output
	// (share-bearing JSON) to the bridge. Keygen results flow
	// through StageKeygenOutput only.
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller unavailable")
	}
	root := filepath.Join(filepath.Dir(thisFile), "..", "bbmtmobile")
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") {
			return nil
		}
		if strings.HasSuffix(path, "_test.go") {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		for i, line := range strings.Split(string(body), "\n") {
			if strings.Contains(line, "cString(dkls.JoinKeygen(") ||
				strings.Contains(line, "cString(dkls.NostrJoinKeygen(") {
				t.Errorf("%s:%d: unstaged DKG output resolved", path, i+1)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
}

func TestF15b1_StagedFlows(t *testing.T) {
	shares, _, err := RunDKGInProcess([]byte("f15b1-staged"))
	if err != nil {
		t.Fatalf("dkg: %v", err)
	}
	defer shares[0].Free()
	defer shares[1].Free()

	ksJSON, err := KeyshareJSONFromHandle(shares[0], "bb",
		[]string{"party1", "party2"}, "party1", "", "")
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	t.Run("ImportV2RoundTrip", func(t *testing.T) {
		keyhandles.DestroyAll()
		blob, err := tss.BackupEncrypt(ksJSON, "staged-import-12!")
		if err != nil {
			t.Fatalf("backup encrypt: %v", err)
		}
		raw, err := ImportBackupStaged(blob, "staged-import-12!")
		if err != nil {
			t.Fatalf("staged import: %v", err)
		}
		assertNoShareBytes(t, "staged import", raw)
		handle, meta, legacy := mustParseStaged(t, raw)
		if legacy {
			t.Error("v2 flagged legacy")
		}
		if meta["pub_key"] == "" {
			t.Error("metadata missing pub_key")
		}
		staged, _, ok := keyhandles.Lookup(handle)
		if !ok || string(staged) != ksJSON {
			t.Error("staged bytes mismatch")
		}
		keyhandles.Destroy(handle)
	})

	t.Run("ImportTamperedPubKeyRejected", func(t *testing.T) {
		keyhandles.DestroyAll()
		var m map[string]any
		if err := json.Unmarshal([]byte(ksJSON), &m); err != nil {
			t.Fatal(err)
		}
		m["pub_key"] = strings.Repeat("0", 66)
		tampered, _ := json.Marshal(m)
		blob, err := tss.BackupEncrypt(string(tampered), "staged-import-12!")
		if err != nil {
			t.Fatalf("backup encrypt: %v", err)
		}
		if _, err := ImportBackupStaged(blob, "staged-import-12!"); err == nil {
			t.Fatal("tampered pub_key staged without F2 rejection")
		} else if !strings.Contains(err.Error(), "binding") {
			t.Fatalf("wrong rejection: %v", err)
		}
	})

	t.Run("ImportWrongPassword", func(t *testing.T) {
		blob, err := tss.BackupEncrypt(ksJSON, "staged-import-12!")
		if err != nil {
			t.Fatalf("backup encrypt: %v", err)
		}
		_, err = ImportBackupStaged(blob, "wrong-password-12!")
		if err == nil {
			t.Fatal("wrong password accepted")
		}
		// JS maps non-format errors to WrongKeysharePasswordError.
		if strings.Contains(err.Error(), "not a recognized backup format") {
			t.Fatalf("wrong-password misclassified as format error: %v", err)
		}
	})

	t.Run("ImportGarbageFormat", func(t *testing.T) {
		if _, err := ImportBackupStaged("@@@not-base64@@@", "pw-12345678!"); err == nil {
			t.Fatal("garbage accepted")
		} else if !strings.Contains(err.Error(), "not a recognized backup format") {
			t.Fatalf("garbage misclassified: %v", err)
		}
	})

	t.Run("ImportLegacyFlag", func(t *testing.T) {
		keyhandles.DestroyAll()
		blob := legacyBlobForTest(t, ksJSON, "legacy-pass-12!")
		raw, err := ImportBackupStaged(blob, "legacy-pass-12!")
		if err != nil {
			t.Fatalf("legacy staged import: %v", err)
		}
		assertNoShareBytes(t, "legacy staged import", raw)
		handle, _, legacy := mustParseStaged(t, raw)
		if !legacy {
			t.Error("legacy blob not flagged")
		}
		keyhandles.Destroy(handle)
	})

	t.Run("StageKeygenOutput", func(t *testing.T) {
		keyhandles.DestroyAll()
		raw, err := StageKeygenOutput(ksJSON)
		if err != nil {
			t.Fatalf("stage: %v", err)
		}
		assertNoShareBytes(t, "staged keygen", raw)
		handle, meta, _ := mustParseStaged(t, raw)
		if meta["pub_key"] == "" || meta["suite"] == nil {
			t.Error("keygen metadata incomplete")
		}
		keyhandles.Destroy(handle)
	})

	t.Run("FinalizeMergesNsecNpub", func(t *testing.T) {
		keyhandles.DestroyAll()
		raw, err := StageKeygenOutput(ksJSON)
		if err != nil {
			t.Fatalf("stage: %v", err)
		}
		handle, _, _ := mustParseStaged(t, raw)
		bech32 := "nsec1vl029mgpspedva04ghmrw0l2hdql0hvqpq43425ed0pc4dmfz8fqv59hy3"
		finalized, err := FinalizeStagedForPersist(handle, bech32, "npub1test")
		if err != nil {
			t.Fatalf("finalize: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(finalized), &m); err != nil {
			t.Fatalf("finalized json: %v", err)
		}
		// hex(utf8(bech32)) — identical to JS nsecFieldForKeyshareJson.
		wantNsec := hex.EncodeToString([]byte(bech32))
		if m["nsec"] != wantNsec {
			t.Errorf("nsec field %v want hex-of-bech32", m["nsec"])
		}
		if m["nostr_npub"] != "npub1test" {
			t.Error("npub not merged")
		}
		if m["share_b64"] == "" {
			t.Error("finalize dropped share bytes for native persist")
		}
		// Staged entry survives finalize (retryable persist).
		if _, _, ok := keyhandles.Lookup(handle); !ok {
			t.Error("finalize destroyed staged entry")
		}
		keyhandles.Destroy(handle)
		// Present values are NOT overwritten: stage JSON that
		// already carries nsec/npub, finalize with different
		// values, assert the originals survive.
		var withCreds map[string]any
		if err := json.Unmarshal([]byte(ksJSON), &withCreds); err != nil {
			t.Fatal(err)
		}
		withCreds["nsec"] = "6f726967696e616c"
		withCreds["nostr_npub"] = "npub1original"
		withCredsJSON, _ := json.Marshal(withCreds)
		raw2, err := StageKeygenOutput(string(withCredsJSON))
		if err != nil {
			t.Fatalf("stage 2: %v", err)
		}
		handle2, _, _ := mustParseStaged(t, raw2)
		finalized2, err := FinalizeStagedForPersist(handle2, bech32, "npub1test")
		if err != nil {
			t.Fatalf("finalize 2: %v", err)
		}
		var m2 map[string]any
		if err := json.Unmarshal([]byte(finalized2), &m2); err != nil {
			t.Fatal(err)
		}
		if m2["nsec"] != "6f726967696e616c" || m2["nostr_npub"] != "npub1original" {
			t.Error("finalize overwrote present credentials")
		}
		keyhandles.Destroy(handle2)
	})

	t.Run("FinalizeUnknownHandle", func(t *testing.T) {
		if _, err := FinalizeStagedForPersist("00", "", ""); err == nil {
			t.Fatal("unknown handle finalized")
		}
	})
}
