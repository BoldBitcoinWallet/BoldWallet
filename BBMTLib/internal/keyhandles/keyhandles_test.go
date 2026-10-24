package keyhandles

import (
	"encoding/json"
	"strings"
	"testing"
)

var dklsJSON = []byte(`{"tss_backend":"dkls23","suite":1,` +
	`"pub_key":"03aa","chain_code_hex":"bb","local_party_key":"KeyShare1",` +
	`"keygen_committee_keys":["KeyShare1","KeyShare2"],` +
	`"share_b64":"F15B-SECRET-SHARE","created_at":1720000000000,` +
	`"nostr_npub":"npub1x","nsec":"6e736563"}`)

var gg18JSON = []byte(`{"tss_backend":"gg18","pub_key":"02bb",` +
	`"local_party_key":"party1","ecdsa_local_data":{"Alpha":"F15B-GG18-SECRET"}}`)

func TestF15b1_StageLookupDestroy(t *testing.T) {
	DestroyAll()
	id, err := Stage(BackendDKLS23, dklsJSON)
	if err != nil {
		t.Fatalf("stage: %v", err)
	}
	if len(id) != 32 {
		t.Fatalf("id len %d, want 32 hex chars", len(id))
	}
	got, backend, ok := Lookup(id)
	if !ok || backend != BackendDKLS23 || string(got) != string(dklsJSON) {
		t.Fatal("lookup mismatch")
	}
	if _, _, ok := Lookup("deadbeef" + id[8:]); ok {
		t.Fatal("unknown id resolved")
	}
	if !Destroy(id) {
		t.Fatal("destroy live id failed")
	}
	if _, _, ok := Lookup(id); ok {
		t.Fatal("destroyed id still resolves")
	}
	if Destroy(id) {
		t.Fatal("double destroy reported success")
	}
	DestroyAll() // idempotent, must not panic
}

func TestF15b1_StageReplacesPrior(t *testing.T) {
	DestroyAll()
	first, _ := Stage(BackendDKLS23, dklsJSON)
	second, _ := Stage(BackendGG18, gg18JSON)
	if first == second {
		t.Fatal("ids collided")
	}
	if _, _, ok := Lookup(first); ok {
		t.Fatal("prior staged entry survived replacement")
	}
	if _, backend, ok := Lookup(second); !ok || backend != BackendGG18 {
		t.Fatal("replacement entry missing")
	}
	DestroyAll()
}

func TestF15b1_RedactedStructure(t *testing.T) {
	raw, err := RedactedStructure(dklsJSON)
	if err != nil {
		t.Fatalf("redact: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if m["pub_key"] != "03aa" {
		t.Error("public field altered")
	}
	if s, _ := m["share_b64"].(string); !strings.HasPrefix(s, "<redacted len=") {
		t.Errorf("share_b64 not redacted: %v", m["share_b64"])
	}
	if s, _ := m["nsec"].(string); !strings.HasPrefix(s, "<redacted len=") {
		t.Errorf("nsec not redacted: %v", m["nsec"])
	}
	full := string(raw)
	for _, secret := range []string{"F15B-SECRET-SHARE", "6e736563"} {
		if strings.Contains(full, secret) {
			t.Errorf("redacted output leaks %q", secret)
		}
	}
	graw, err := RedactedStructure(gg18JSON)
	if err != nil {
		t.Fatalf("gg18 redact: %v", err)
	}
	if !strings.Contains(string(graw), "<redacted object>") ||
		strings.Contains(string(graw), "F15B-GG18-SECRET") {
		t.Error("gg18 ecdsa subtree not redacted")
	}
	if _, err := RedactedStructure([]byte(`{oops`)); err == nil {
		t.Error("invalid JSON accepted")
	}
}

func TestF15b1_SniffBackend(t *testing.T) {
	cases := []struct {
		name string
		json []byte
		want Backend
	}{
		{"dkls explicit", dklsJSON, BackendDKLS23},
		{"gg18 explicit", gg18JSON, BackendGG18},
		{"share cue", []byte(`{"share_b64":"eA=="}`), BackendDKLS23},
		{"ecdsa cue", []byte(`{"ecdsa_local_data":{}}`), BackendGG18},
		{"default", []byte(`{"pub_key":"02bb"}`), BackendGG18},
		{"garbage", []byte(`not json`), BackendGG18},
	}
	for _, c := range cases {
		if got := SniffBackend(c.json); got != c.want {
			t.Errorf("%s: got %s want %s", c.name, got, c.want)
		}
	}
}

func TestF15b1_MetadataProjection(t *testing.T) {
	raw, err := MetadataJSON(dklsJSON)
	if err != nil {
		t.Fatalf("metadata: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, k := range []string{"pub_key", "chain_code_hex",
		"keygen_committee_keys", "local_party_key", "nostr_npub",
		"created_at", "tss_backend", "suite"} {
		if _, ok := m[k]; !ok {
			t.Errorf("allowlisted key %q missing", k)
		}
	}
	s := string(raw)
	for _, secret := range append(SecretKeys,
		"F15B-SECRET-SHARE", "6e736563") {
		if strings.Contains(s, secret) {
			t.Errorf("metadata leaks %q", secret)
		}
	}
	if _, err := MetadataJSON([]byte(`{oops`)); err == nil {
		t.Error("invalid JSON accepted")
	}
	// GG18 projects without error and without ecdsa material.
	graw, err := MetadataJSON(gg18JSON)
	if err != nil {
		t.Fatalf("gg18 metadata: %v", err)
	}
	if strings.Contains(string(graw), "ecdsa_local_data") ||
		strings.Contains(string(graw), "F15B-GG18-SECRET") {
		t.Error("gg18 metadata leaks share material")
	}
}
