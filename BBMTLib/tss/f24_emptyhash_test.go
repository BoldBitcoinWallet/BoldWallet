package tss

import (
	"strings"
	"testing"
)

// F24: no legitimate producer emits an empty hash (the sender always sets
// d1/h1; the relay stores verbatim). Empty or unknown-format hashes must be
// rejected exactly like every other class: uniform same-poll DELETE (F6),
// never applied.

func TestF24_EmptyHashRejected(t *testing.T) {
	key := f6SessionKey(t)
	payload := strings.Repeat("f24-empty-", 64)
	body, err := AesEncrypt(payload, key)
	if err != nil {
		t.Fatalf("fixture encrypt: %v", err)
	}
	events, imp := f6Drive(t, "f24-empty", key, "", f6Msg("attacker", body, "1", ""))
	if len(events) < 1 || events[0].getsSeen != 1 {
		t.Fatalf("empty hash not deleted same-poll like other rejects: %v", events)
	}
	select {
	case got := <-imp.inboundMessageCh:
		t.Fatalf("empty-hash message was applied: %q", got)
	default:
	}
}

func TestF24_UnknownHashFormatRejected(t *testing.T) {
	key := f6SessionKey(t)
	payload := strings.Repeat("f24-unknown-", 64)
	body, err := AesEncrypt(payload, key)
	if err != nil {
		t.Fatalf("fixture encrypt: %v", err)
	}
	events, imp := f6Drive(t, "f24-unknown", key, "", f6Msg("attacker", body, "1", "xx:deadbeef"))
	if len(events) != 1 || events[0].getsSeen != 1 {
		t.Fatalf("unknown hash not deleted same-poll: %v", events)
	}
	select {
	case got := <-imp.inboundMessageCh:
		t.Fatalf("unknown-format message was applied: %q", got)
	default:
	}
}
