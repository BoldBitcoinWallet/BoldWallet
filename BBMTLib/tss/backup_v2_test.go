package tss

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

// Fast KDF cost for unit tests. Production cost is covered structurally by
// TestF1_ProductionParams plus a measured timing log (reference-device gate).
var testBackupParams = BackupKDFParams{Time: 1, Memory: 8 * 1024, Threads: 1}

const testBackupPlaintext = `{"tss_backend":"dkls23","pub_key":"03aa","share_b64":"dGVzdA=="}`

func TestF1_V2RoundTrip(t *testing.T) {
	blob, err := BackupEncryptWithParams(testBackupPlaintext, "correct horse 12!", testBackupParams)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !strings.HasPrefix(blob, backupV2Prefix) {
		t.Fatalf("missing v2 prefix: %q", blob[:8])
	}
	got, err := BackupDecrypt(blob, "correct horse 12!")
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got.Legacy {
		t.Fatal("v2 blob reported as legacy")
	}
	if got.Plaintext != testBackupPlaintext {
		t.Fatal("round-trip mismatch")
	}
}

func TestF1_TamperByte_Rejects(t *testing.T) {
	blob, err := BackupEncryptWithParams(testBackupPlaintext, "pw-12-chars!!", testBackupParams)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(blob, backupV2Prefix))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Flip one byte near the end (ciphertext/tag region).
	raw[len(raw)-1] ^= 0x01
	tampered := backupV2Prefix + base64.StdEncoding.EncodeToString(raw)
	if _, err := BackupDecrypt(tampered, "pw-12-chars!!"); err == nil {
		t.Fatal("tampered backup accepted")
	}
	// Flip one header byte (KDF params region) — AAD binding must fail it.
	raw[len(raw)-1] ^= 0x01
	raw[7] ^= 0x80
	tampered = backupV2Prefix + base64.StdEncoding.EncodeToString(raw)
	if _, err := BackupDecrypt(tampered, "pw-12-chars!!"); err == nil {
		t.Fatal("header-tampered backup accepted")
	}
}

func TestF1_WrongPassword_Rejects(t *testing.T) {
	blob, err := BackupEncryptWithParams(testBackupPlaintext, "right-password-1!", testBackupParams)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if _, err := BackupDecrypt(blob, "wrong-password-2?"); err == nil {
		t.Fatal("wrong password accepted")
	}
}

func TestF1_UnknownVersion_Rejects(t *testing.T) {
	blob, err := BackupEncryptWithParams(testBackupPlaintext, "pw-12-chars!!", testBackupParams)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	raw, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(blob, backupV2Prefix))
	raw[4] = 9 // version byte
	forged := backupV2Prefix + base64.StdEncoding.EncodeToString(raw)
	if _, err := BackupDecrypt(forged, "pw-12-chars!!"); err == nil {
		t.Fatal("unknown version accepted")
	}
}

func TestF1_SaltRandomized(t *testing.T) {
	a, err := BackupEncryptWithParams(testBackupPlaintext, "same-password-1!", testBackupParams)
	if err != nil {
		t.Fatalf("encrypt a: %v", err)
	}
	b, err := BackupEncryptWithParams(testBackupPlaintext, "same-password-1!", testBackupParams)
	if err != nil {
		t.Fatalf("encrypt b: %v", err)
	}
	if a == b {
		t.Fatal("identical ciphertexts for identical inputs: salt/nonce not randomized")
	}
}

func legacyTestBlob(t *testing.T, plaintext, password string) string {
	t.Helper()
	sum := sha256.Sum256([]byte(password))
	blob, err := AesEncrypt(plaintext, hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatalf("legacy encrypt: %v", err)
	}
	return blob
}

func TestF1_LegacyImport_WorksWithWarningFlag(t *testing.T) {
	blob := legacyTestBlob(t, testBackupPlaintext, "legacy-pass-12!")
	got, err := BackupDecrypt(blob, "legacy-pass-12!")
	if err != nil {
		t.Fatalf("legacy decrypt: %v", err)
	}
	if !got.Legacy {
		t.Fatal("legacy blob not flagged")
	}
	if got.Plaintext != testBackupPlaintext {
		t.Fatal("legacy round-trip mismatch")
	}
}

func TestF1_LegacyTamper_NoPanic(t *testing.T) {
	// Legacy CBC has no MAC: a flipped byte usually breaks padding (error)
	// but can occasionally still unpad to garbage. Either outcome is fine
	// here — the JS content check rejects garbage one layer up. Never panic.
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("legacy tamper panicked: %v", r)
		}
	}()
	blob := legacyTestBlob(t, testBackupPlaintext, "legacy-pass-12!")
	raw, _ := base64.StdEncoding.DecodeString(blob)
	raw[len(raw)-1] ^= 0x01
	tampered := base64.StdEncoding.EncodeToString(raw)
	_, _ = BackupDecrypt(tampered, "legacy-pass-12!")
}

func TestF1_LegacyGarbage_NoPanic(t *testing.T) {
	// Legacy CBC has no MAC: garbage and wrong passwords are indistinguishable
	// here and may yield garbage plaintext. The JS content check (pub_key +
	// JSON parse) rejects those one layer up. This layer must never panic.
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("legacy garbage panicked: %v", r)
		}
	}()
	structural := []string{
		"!!!not-base64!!!",
		base64.StdEncoding.EncodeToString([]byte("short")),
		base64.StdEncoding.EncodeToString(make([]byte, 33)), // bad block alignment
	}
	for _, blob := range structural {
		if _, err := BackupDecrypt(blob, "some-password-1!"); err == nil {
			t.Fatalf("structurally invalid blob accepted: %q", blob[:16])
		}
	}
	mayBeGarbage := []string{
		strings.Repeat("A", 4096), // aligned zeros: decrypts to garbage, no panic
	}
	for _, blob := range mayBeGarbage {
		_, _ = BackupDecrypt(blob, "some-password-1!")
	}
}

func TestF1_EmptyPassword_Rejects(t *testing.T) {
	if _, err := BackupEncryptWithParams(testBackupPlaintext, "", testBackupParams); err == nil {
		t.Fatal("empty password accepted on encrypt")
	}
	blob, _ := BackupEncryptWithParams(testBackupPlaintext, "pw-12-chars!!", testBackupParams)
	if _, err := BackupDecrypt(blob, ""); err == nil {
		t.Fatal("empty password accepted on decrypt")
	}
}

func TestF1_ProductionParams_MeetMinimums(t *testing.T) {
	p := ProductionBackupKDFParams
	if p.Time < 3 {
		t.Fatalf("argon2 time %d < 3", p.Time)
	}
	if p.Memory < 64*1024 {
		t.Fatalf("argon2 memory %d KiB < 64 MiB", p.Memory)
	}
	if p.Threads < 1 {
		t.Fatalf("argon2 threads %d < 1", p.Threads)
	}
	start := time.Now()
	blob, err := BackupEncrypt(testBackupPlaintext, "production-cost-probe-1!")
	if err != nil {
		t.Fatalf("production encrypt: %v", err)
	}
	elapsed := time.Since(start)
	t.Logf("production KDF+encrypt took %s on this host (reference-device gate: >=100ms on mid-range Android)", elapsed)
	if elapsed < 100*time.Millisecond {
		t.Fatalf("production KDF took %s, below the 100ms floor", elapsed)
	}
	got, err := BackupDecrypt(blob, "production-cost-probe-1!")
	if err != nil {
		t.Fatalf("production decrypt: %v", err)
	}
	if got.Plaintext != testBackupPlaintext || got.Legacy {
		t.Fatal("production round-trip mismatch")
	}
}
