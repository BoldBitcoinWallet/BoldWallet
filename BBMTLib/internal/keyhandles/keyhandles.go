// Package keyhandles is the F15b-1 staged-share registry: Go-held
// keyshare bytes referenced from JS by opaque handle ID. JS never
// sees share bytes — only IDs plus allowlisted metadata.
//
// Scope note (3a): staged BYTES only (single slot). No live
// libtss handles and no active-cache: nothing in 3a/3b consumes
// a live handle (persist/import are byte flows; signing imports
// per-call from native bytes). If a live-handle consumer ever
// appears, extend Entry — do not resolve bytes to JS.
package keyhandles

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
)

// Backend mirrors JS detectKeyshareTssBackend cues.
type Backend string

const (
	BackendDKLS23 Backend = "dkls23"
	BackendGG18   Backend = "gg18"
)

// MetadataAllowlist is the §3 superset both platforms return
// verbatim. NEVER add share_b64, ecdsa_local_data, nsec, or any
// session/transport key here.
var MetadataAllowlist = []string{
	"pub_key",
	"chain_code_hex",
	"keygen_committee_keys",
	"local_party_key",
	"nostr_npub",
	"created_at",
	"tss_backend",
	"suite",
}

// SecretKeys must never appear in metadata output. Tests assert
// absence on every extraction path.
var SecretKeys = []string{
	"share_b64",
	"ecdsa_local_data",
	"nsec",
	"sessionKeyHex",
	"encKey",
	"decKey",
	"sessionKey",
}

type entry struct {
	id      string
	backend Backend
	// json holds the full keyshare JSON. Wiped (clear + drop) on
	// destroy. Short-lived: setup→commit and import→persist only.
	json []byte
}

var (
	mu     sync.Mutex
	staged *entry
)

// newID returns 16 crypto-random bytes, hex-encoded.
func newID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("handle id: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}

// wipe clears and drops the staged entry. Caller must hold mu.
func wipeLocked() {
	if staged == nil {
		return
	}
	clear(staged.json)
	staged = nil
}

// Stage stores keyshare JSON bytes under a fresh handle ID,
// destroying any prior staged entry. Backend-agnostic (DKLs and
// GG18 import/persist share this path; see F19 for the GG18
// method carve-out).
func Stage(backend Backend, fullJSON []byte) (string, error) {
	if len(fullJSON) == 0 {
		return "", fmt.Errorf("stage: empty keyshare")
	}
	id, err := newID()
	if err != nil {
		return "", err
	}
	cp := make([]byte, len(fullJSON))
	copy(cp, fullJSON)
	mu.Lock()
	defer mu.Unlock()
	wipeLocked()
	staged = &entry{id: id, backend: backend, json: cp}
	return id, nil
}

// Lookup returns a COPY of staged bytes for id, or false. Copies
// are transient; callers must clear them after use.
func Lookup(id string) (jsonBytes []byte, backend Backend, ok bool) {
	mu.Lock()
	defer mu.Unlock()
	if staged == nil {
		return nil, "", false
	}
	// Single slot: id match is required but the slot holds one
	// entry — compare against the live id.
	if id == "" || id != liveIDLocked() {
		return nil, "", false
	}
	cp := make([]byte, len(staged.json))
	copy(cp, staged.json)
	return cp, staged.backend, true
}

// StagedID reports the live staged handle ID, if any.
func StagedID() (string, bool) {
	mu.Lock()
	defer mu.Unlock()
	if staged == nil {
		return "", false
	}
	return liveIDLocked(), true
}

// Destroy wipes the staged entry if id matches. Returns false
// for unknown ids (fail closed, never a stale share).
func Destroy(id string) bool {
	mu.Lock()
	defer mu.Unlock()
	if staged == nil || id == "" || id != liveIDLocked() {
		return false
	}
	wipeLocked()
	return true
}

// DestroyAll wipes any staged entry. Idempotent.
func DestroyAll() {
	mu.Lock()
	defer mu.Unlock()
	wipeLocked()
}

// liveIDLocked derives the current slot id. Caller holds mu.
//
// The id lives alongside the entry so a destroy/persist cycle
// can never resurrect a prior id: ids are single-generation.
func liveIDLocked() string {
	if staged == nil || staged.id == "" {
		return ""
	}
	return staged.id
}

// SniffBackend mirrors JS detectKeyshareTssBackend: explicit
// tss_backend wins; else ecdsa_local_data → gg18; else
// non-empty share_b64 → dkls23; default gg18.
func SniffBackend(fullJSON []byte) Backend {
	var m map[string]any
	if err := json.Unmarshal(fullJSON, &m); err != nil {
		return BackendGG18
	}
	if b, _ := m["tss_backend"].(string); b == string(BackendDKLS23) {
		return BackendDKLS23
	} else if b == string(BackendGG18) {
		return BackendGG18
	}
	if m["ecdsa_local_data"] != nil {
		return BackendGG18
	}
	if s, _ := m["share_b64"].(string); s != "" {
		return BackendDKLS23
	}
	return BackendGG18
}

// RedactedStructure walks keyshare JSON for the dev tree view,
// replacing secret leaves with "<redacted len=N>" (scalars) or
// "<redacted object>" (the ecdsa_local_data subtree). All other
// values pass through verbatim.
func RedactedStructure(fullJSON []byte) ([]byte, error) {
	var m map[string]any
	if err := json.Unmarshal(fullJSON, &m); err != nil {
		return nil, fmt.Errorf("redact: %w", err)
	}
	redactValue := func(key string, v any) any {
		switch key {
		case "share_b64", "nsec":
			if s, ok := v.(string); ok {
				return fmt.Sprintf("<redacted len=%d>", len(s))
			}
			return "<redacted>"
		case "ecdsa_local_data":
			return "<redacted object>"
		default:
			return v
		}
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = redactValue(k, v)
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, fmt.Errorf("redact marshal: %w", err)
	}
	return raw, nil
}

// MetadataJSON projects full keyshare JSON onto the allowlist.
// Unknown/absent keys are omitted; secret keys can never appear
// (projection, not redaction).
func MetadataJSON(fullJSON []byte) ([]byte, error) {
	var m map[string]any
	if err := json.Unmarshal(fullJSON, &m); err != nil {
		return nil, fmt.Errorf("metadata: %w", err)
	}
	out := make(map[string]any, len(MetadataAllowlist))
	for _, k := range MetadataAllowlist {
		if v, ok := m[k]; ok {
			out[k] = v
		}
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, fmt.Errorf("metadata marshal: %w", err)
	}
	return raw, nil
}
