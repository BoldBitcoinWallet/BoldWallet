package dkls

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

func TestF15_SecureBytes_DestroyWipes(t *testing.T) {
	shares, _, err := RunDKGInProcess([]byte("f15-wipe"))
	if err != nil {
		t.Fatalf("dkg: %v", err)
	}
	defer shares[0].Free()
	defer shares[1].Free()

	secure, err := libtss.ExportKeyShareSecure(shares[0])
	if err != nil {
		t.Fatalf("secure export: %v", err)
	}
	if secure.Size() == 0 || len(secure.Bytes()) == 0 {
		t.Fatal("empty secure export")
	}
	secure.Destroy()
	if secure.Bytes() != nil || secure.Size() != 0 {
		t.Fatal("Destroy did not release the buffer")
	}
	secure.Destroy() // idempotent, must not panic
}

func TestF15_ExportRoundTrip_ViaSecure(t *testing.T) {
	shares, _, err := RunDKGInProcess([]byte("f15-roundtrip"))
	if err != nil {
		t.Fatalf("dkg: %v", err)
	}
	defer shares[0].Free()
	defer shares[1].Free()

	jsonStr, err := KeyshareJSONFromHandle(shares[0], "aa", []string{"party1", "party2"}, "party1", "", "")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	loaded, meta, err := ImportKeyshare(jsonStr)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	defer loaded.Free()
	if meta.PubKey == "" {
		t.Fatal("empty pubkey after secure export round-trip")
	}
}

func TestF15_BackupBlob_CiphertextOnly(t *testing.T) {
	shares, _, err := RunDKGInProcess([]byte("f15-ciphertext"))
	if err != nil {
		t.Fatalf("dkg: %v", err)
	}
	defer shares[0].Free()
	defer shares[1].Free()

	jsonStr, err := KeyshareJSONFromHandle(shares[0], "aa", []string{"party1", "party2"}, "party1", "", "")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	// Plaintext share bytes, obtained here in-test only for comparison.
	raw, err := libtss.ExportKeyShare(shares[0])
	if err != nil {
		t.Fatalf("raw export: %v", err)
	}
	blob, err := tss.BackupEncrypt(jsonStr, "ciphertext-only-12!")
	if err != nil {
		t.Fatalf("backup encrypt: %v", err)
	}
	if strings.Contains(blob, "share_b64") {
		t.Fatal("backup blob leaks field label")
	}
	if strings.Contains(blob, base64.StdEncoding.EncodeToString(raw)) {
		t.Fatal("backup blob leaks share bytes")
	}
	res, err := tss.BackupDecrypt(blob, "ciphertext-only-12!")
	if err != nil {
		t.Fatalf("backup decrypt: %v", err)
	}
	if res.Plaintext != jsonStr || res.Legacy {
		t.Fatal("backup round-trip mismatch")
	}
}

func TestF15_NoPlaintextExportCallers(t *testing.T) {
	// Guardrail: our Go code must use ExportKeyShareSecure, never the
	// GC-heap ExportKeyShare (libtss itself is third-party and exempt).
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller unavailable")
	}
	roots := []string{
		filepath.Dir(thisFile), // BBMTLib/dkls
		filepath.Join(filepath.Dir(thisFile), "..", "tss"),
		filepath.Join(filepath.Dir(thisFile), "..", "bbmtmobile"),
	}
	for _, root := range roots {
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
				// "ExportKeyShare(" with paren excludes ExportKeyShareSecure(.
				if strings.Contains(line, "ExportKeyShare(") {
					t.Errorf("%s:%d: plaintext ExportKeyShare use", path, i+1)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", root, err)
		}
	}
}
