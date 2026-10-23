package tss

// Versioned backup format (F1 fix).
//
//   v2 string form: "BW2$" + base64(header || GCM ciphertext+tag)
//   header: magic "BBW2" (4) | version u8 (1) | argon memory KiB u32be |
//     argon time u32be | argon threads u8 | salt length u8 | salt (16) | nonce (12)
//   key = Argon2id(password, salt, time, memory, threads, 32); AES-256-GCM,
//   AAD = header bytes (binds KDF params to the ciphertext).
//
// Anything without the "BW2$" prefix takes the legacy read-only path:
// base64(IV || AES-CBC ciphertext), key = hex(SHA-256(password)). Legacy is
// import-only and never written by current code. AesEncrypt/AesDecrypt are
// intentionally untouched: LAN transport and CLI tools share them, and the
// MPC wire format is out of scope for this change.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/argon2"
)

// backupDecryptEnvelopeJSON is the bridge return shape for BackupDecrypt:
// {"format":"v2"|"legacy","plaintext":"..."}.
type backupDecryptEnvelopeJSON struct {
	Format    string `json:"format"`
	Plaintext string `json:"plaintext"`
}

// BackupDecryptEnvelope is the bridge entry: decrypt plus format envelope.
func BackupDecryptEnvelope(blob, password string) (result string, err error) {
	defer RecoverAsError("BackupDecryptEnvelope", &err, &result)
	res, err := BackupDecrypt(blob, password)
	if err != nil {
		return "", err
	}
	format := "v2"
	if res.Legacy {
		format = "legacy"
	}
	out, err := json.Marshal(backupDecryptEnvelopeJSON{Format: format, Plaintext: res.Plaintext})
	if err != nil {
		return "", err
	}
	return string(out), nil
}

const (
	backupV2Prefix   = "BW2$"
	backupV2Magic    = "BBW2"
	backupV2Version  = 1
	backupV2SaltLen  = 16
	backupV2NonceLen = 12
	backupV2KeyLen   = 32

	maxBackupBlobBytes = 4 << 20 // 4 MiB input cap at the decrypt seam
	maxBackupPlaintext = 1 << 20 // 1 MiB plaintext cap (keyshares are ~KB)

	// DoS caps for header-declared KDF cost on decrypt.
	maxBackupArgonMemoryKB = 1 << 20 // 1 GiB
	maxBackupArgonTime     = 64
	maxBackupArgonThreads  = 16
)

// BackupKDFParams carries Argon2id cost. ProductionEncrypt uses
// ProductionBackupKDFParams; tests use fast params via BackupEncryptWithParams.
type BackupKDFParams struct {
	Time    uint32
	Memory  uint32 // KiB
	Threads uint8
}

var ProductionBackupKDFParams = BackupKDFParams{Time: 3, Memory: 64 * 1024, Threads: 1}

func (p BackupKDFParams) validForDecrypt() error {
	if p.Time == 0 || p.Time > maxBackupArgonTime {
		return fmt.Errorf("unsupported argon2 time cost %d", p.Time)
	}
	if p.Memory == 0 || p.Memory > maxBackupArgonMemoryKB {
		return fmt.Errorf("unsupported argon2 memory cost %d KiB", p.Memory)
	}
	if p.Threads == 0 || p.Threads > maxBackupArgonThreads {
		return fmt.Errorf("unsupported argon2 parallelism %d", p.Threads)
	}
	return nil
}

// BackupEncrypt encrypts plaintext with password using the v2 format.
func BackupEncrypt(plaintext, password string) (result string, err error) {
	defer RecoverAsError("BackupEncrypt", &err, &result)
	return BackupEncryptWithParams(plaintext, password, ProductionBackupKDFParams)
}

// BackupEncryptWithParams is BackupEncrypt with explicit KDF cost (test hook).
func BackupEncryptWithParams(plaintext, password string, p BackupKDFParams) (string, error) {
	if password == "" {
		return "", fmt.Errorf("backup password is required")
	}
	if len(plaintext) == 0 || len(plaintext) > maxBackupPlaintext {
		return "", fmt.Errorf("backup plaintext size out of range")
	}
	if err := p.validForDecrypt(); err != nil {
		return "", err
	}
	salt := make([]byte, backupV2SaltLen)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return "", fmt.Errorf("backup salt: %w", err)
	}
	nonce := make([]byte, backupV2NonceLen)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("backup nonce: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, p.Time, p.Memory, p.Threads, backupV2KeyLen)
	defer clear(key)

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("backup cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("backup gcm: %w", err)
	}
	header := buildBackupV2Header(p, salt, nonce)
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), header)
	out := make([]byte, 0, len(header)+len(sealed))
	out = append(out, header...)
	out = append(out, sealed...)
	return backupV2Prefix + base64.StdEncoding.EncodeToString(out), nil
}

// BackupDecryptResult carries the v2/legacy outcome. Legacy reports
// Legacy=true so the UI can warn and prompt re-export.
type BackupDecryptResult struct {
	Plaintext string
	Legacy    bool
}

// BackupDecrypt detects the format by header and decrypts. Unknown v2
// versions and tampered ciphertexts fail closed with no partial output.
func BackupDecrypt(blob, password string) (result BackupDecryptResult, err error) {
	defer RecoverAsErrorClear("BackupDecrypt", &err, func() { result = BackupDecryptResult{} })
	if password == "" {
		return BackupDecryptResult{}, fmt.Errorf("backup password is required")
	}
	if len(blob) == 0 || len(blob) > maxBackupBlobBytes+64 {
		return BackupDecryptResult{}, fmt.Errorf("backup blob size out of range")
	}
	if !strings.HasPrefix(blob, backupV2Prefix) {
		plain, err := backupDecryptLegacy(blob, password)
		if err != nil {
			return BackupDecryptResult{}, err
		}
		return BackupDecryptResult{Plaintext: plain, Legacy: true}, nil
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(blob, backupV2Prefix))
	if err != nil {
		return BackupDecryptResult{}, fmt.Errorf("backup encoding: %w", err)
	}
	p, salt, nonce, ciphertext, err := parseBackupV2Header(raw)
	if err != nil {
		return BackupDecryptResult{}, err
	}
	key := argon2.IDKey([]byte(password), salt, p.Time, p.Memory, p.Threads, backupV2KeyLen)
	defer clear(key)

	block, err := aes.NewCipher(key)
	if err != nil {
		return BackupDecryptResult{}, fmt.Errorf("backup cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return BackupDecryptResult{}, fmt.Errorf("backup gcm: %w", err)
	}
	headerLen := backupV2HeaderLen()
	plain, err := gcm.Open(nil, nonce, ciphertext, raw[:headerLen])
	if err != nil {
		return BackupDecryptResult{}, fmt.Errorf("backup authentication failed")
	}
	if len(plain) == 0 || len(plain) > maxBackupPlaintext {
		return BackupDecryptResult{}, fmt.Errorf("backup plaintext size out of range")
	}
	return BackupDecryptResult{Plaintext: string(plain)}, nil
}

func backupV2HeaderLen() int {
	// magic(4) + ver(1) + mem(4) + time(4) + threads(1) + saltlen(1) + salt(16) + nonce(12)
	return 4 + 1 + 4 + 4 + 1 + 1 + backupV2SaltLen + backupV2NonceLen
}

func buildBackupV2Header(p BackupKDFParams, salt, nonce []byte) []byte {
	h := make([]byte, 0, backupV2HeaderLen())
	h = append(h, backupV2Magic...)
	h = append(h, backupV2Version)
	var u32 [4]byte
	binary.BigEndian.PutUint32(u32[:], p.Memory)
	h = append(h, u32[:]...)
	binary.BigEndian.PutUint32(u32[:], p.Time)
	h = append(h, u32[:]...)
	h = append(h, p.Threads, byte(len(salt)))
	h = append(h, salt...)
	h = append(h, nonce...)
	return h
}

func parseBackupV2Header(raw []byte) (BackupKDFParams, []byte, []byte, []byte, error) {
	var zero BackupKDFParams
	if len(raw) < backupV2HeaderLen()+1 {
		return zero, nil, nil, nil, fmt.Errorf("backup header truncated")
	}
	if string(raw[:4]) != backupV2Magic {
		return zero, nil, nil, nil, fmt.Errorf("backup magic mismatch")
	}
	if raw[4] != backupV2Version {
		return zero, nil, nil, nil, fmt.Errorf("unsupported backup version %d", raw[4])
	}
	p := BackupKDFParams{
		Memory:  binary.BigEndian.Uint32(raw[5:9]),
		Time:    binary.BigEndian.Uint32(raw[9:13]),
		Threads: raw[13],
	}
	if err := p.validForDecrypt(); err != nil {
		return zero, nil, nil, nil, err
	}
	if int(raw[14]) != backupV2SaltLen {
		return zero, nil, nil, nil, fmt.Errorf("unsupported backup salt length %d", raw[14])
	}
	off := 15
	salt := raw[off : off+backupV2SaltLen]
	off += backupV2SaltLen
	nonce := raw[off : off+backupV2NonceLen]
	off += backupV2NonceLen
	return p, salt, nonce, raw[off:], nil
}

// backupDecryptLegacy is the read-only import path for pre-v2 backups:
// base64(IV || AES-CBC). It has no MAC, so wrong passwords and tampered
// files surface as padding/content errors; every path returns a clean error.
func backupDecryptLegacy(blob, password string) (result string, err error) {
	defer RecoverAsError("backupDecryptLegacy", &err, &result)
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(blob))
	if err != nil {
		return "", fmt.Errorf("not a recognized backup format")
	}
	if len(raw) < 2*aes.BlockSize || (len(raw)-aes.BlockSize)%aes.BlockSize != 0 {
		return "", fmt.Errorf("not a recognized backup format")
	}
	sum := sha256.Sum256([]byte(password))
	hexKey := hex.EncodeToString(sum[:])
	plain, err := AesDecrypt(strings.TrimSpace(blob), hexKey)
	if err != nil {
		return "", fmt.Errorf("legacy backup decrypt failed: %w", err)
	}
	if len(plain) == 0 || len(plain) > maxBackupPlaintext {
		return "", fmt.Errorf("legacy backup content out of range")
	}
	return plain, nil
}
