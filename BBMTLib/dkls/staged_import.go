package dkls

// F15b-1 staged import/persist orchestration. All functions here are
// backend-agnostic by construction (DKLs + GG18 stage the same way)
// so GG18 import/persist cannot regress while GG18 setup stays out
// of Wave 3 (F19). Resolved-to-JS values contain handles and
// metadata ONLY — never share bytes (see keyhandles).

import (
	"encoding/json"
	"fmt"

	"github.com/BoldBitcoinWallet/BBMTLib/internal/keyhandles"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

// stagedHandleJSON is the JS-safe shape for staged setup/import
// results. metadata is embedded verbatim (already allowlisted).
type stagedHandleJSON struct {
	Handle   string          `json:"handle"`
	Metadata json.RawMessage `json:"metadata"`
	Legacy   bool            `json:"legacy,omitempty"`
}

// requireImportableJSON mirrors the JS import checks it replaces
// (keyshareImport.ts): valid JSON object with a non-empty pub_key.
// DKLs entries additionally pass full F2 binding verification in
// ImportBackupStaged.
func requireImportableJSON(plaintext string) (map[string]any, error) {
	var m map[string]any
	if err := json.Unmarshal([]byte(plaintext), &m); err != nil {
		return nil, fmt.Errorf("not a recognized backup format")
	}
	pub, _ := m["pub_key"].(string)
	if pub == "" {
		return nil, fmt.Errorf("not a recognized backup format")
	}
	return m, nil
}

// ImportBackupStaged decrypts a B1 backup (v2 or legacy), verifies
// it, and stages the plaintext for native persist. Error TEXT
// preserves B1 semantics: 'not a recognized backup format' for
// garbage (JS maps to InvalidKeyshareError), authentication
// failures otherwise (JS maps to WrongKeysharePasswordError).
func ImportBackupStaged(blob, password string) (string, error) {
	res, err := tss.BackupDecrypt(blob, password)
	if err != nil {
		return "", err
	}
	plain := []byte(res.Plaintext)
	if _, err := requireImportableJSON(res.Plaintext); err != nil {
		return "", err
	}
	backend := keyhandles.SniffBackend(plain)
	if backend == keyhandles.BackendDKLS23 {
		// Full F2 binding verification (pub_key + suite against
		// the imported share). The live handle is freed; staged
		// BYTES are what persist needs.
		share, _, err := ImportKeyshare(res.Plaintext)
		if err != nil {
			return "", err
		}
		share.Free()
	}
	id, err := keyhandles.Stage(backend, plain)
	if err != nil {
		return "", err
	}
	meta, err := keyhandles.MetadataJSON(plain)
	if err != nil {
		keyhandles.Destroy(id)
		return "", err
	}
	out, err := json.Marshal(stagedHandleJSON{
		Handle:   id,
		Metadata: meta,
		Legacy:   res.Legacy,
	})
	if err != nil {
		keyhandles.Destroy(id)
		return "", err
	}
	return string(out), nil
}

// StageKeygenOutput stages fresh DKG output (our own
// KeyshareJSONFromHandle bytes — no re-import needed) and returns
// the JS-safe {handle, metadata} shape.
func StageKeygenOutput(ksJSON string) (string, error) {
	plain := []byte(ksJSON)
	m, err := requireImportableJSON(ksJSON)
	if err != nil {
		return "", fmt.Errorf("keygen output invalid: %w", err)
	}
	_ = m
	id, err := keyhandles.Stage(keyhandles.SniffBackend(plain), plain)
	if err != nil {
		return "", err
	}
	meta, err := keyhandles.MetadataJSON(plain)
	if err != nil {
		keyhandles.Destroy(id)
		return "", err
	}
	out, err := json.Marshal(stagedHandleJSON{Handle: id, Metadata: meta})
	if err != nil {
		keyhandles.Destroy(id)
		return "", err
	}
	return string(out), nil
}

// FinalizeStagedForPersist merges Nostr credentials into staged
// JSON and returns the full JSON for NATIVE-ONLY envelope+RNES
// persist. The returned string MUST NEVER resolve to JS (L2
// schema tests + review enforce this).
//
// Merge semantics mirror JS finalizeKeyshareForStorage exactly:
// fill nsec/nostr_npub ONLY when absent. nsec encoding matches
// JS nsecFieldForKeyshareJson for bech32 input (hex of UTF-8);
// hex input is normalized to bech32 first (JS would store an
// undecodable value for hex — no working behavior changes).
//
// The staged entry is NOT destroyed here: native destroys it
// after a VERIFIED RNES write so failed persists are retryable
// with the same handle.
func FinalizeStagedForPersist(handle, nsec, npub string) (string, error) {
	raw, _, ok := keyhandles.Lookup(handle)
	if !ok {
		return "", fmt.Errorf("unknown or expired keyshare handle")
	}
	defer clear(raw)
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return "", fmt.Errorf("staged keyshare corrupt: %w", err)
	}
	if nsec != "" {
		if cur, _ := m["nsec"].(string); cur == "" {
			field, err := NsecFieldForKeyshareJSON(nsec)
			if err != nil {
				return "", err
			}
			m["nsec"] = field
		}
	}
	if npub != "" {
		if cur, _ := m["nostr_npub"].(string); cur == "" {
			m["nostr_npub"] = npub
		}
	}
	out, err := json.Marshal(m)
	if err != nil {
		return "", fmt.Errorf("finalize marshal: %w", err)
	}
	return string(out), nil
}
