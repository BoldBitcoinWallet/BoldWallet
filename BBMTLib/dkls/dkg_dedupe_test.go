package dkls

import (
	"testing"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

func TestDedupeDKGInboundBySender(t *testing.T) {
	self := libtss.Identifier(1)
	msgs := []libtss.Message{
		{From: 2, To: 1, Data: []byte("a")},
		{From: 2, To: 1, Data: []byte("b")},
		{From: 3, To: 1, Data: []byte("c")},
	}
	out := dedupeDKGInboundBySender(self, msgs)
	if len(out) != 2 {
		t.Fatalf("expected 2 messages after sender dedupe, got %d", len(out))
	}
	if string(out[0].Data) != "a" {
		t.Fatalf("expected first sender fragment to be kept, got %q", string(out[0].Data))
	}
}

func TestMergeDKGPeerMessagesDuplicateSender(t *testing.T) {
	self := libtss.Identifier(1)
	batch := mergeDKGPeerMessages(nil, []libtss.Message{
		{From: 2, To: 1, Data: []byte("old")},
		{From: 3, To: 1, Data: []byte("c")},
	}, self)
	batch = mergeDKGPeerMessages(batch, []libtss.Message{
		{From: 2, To: 1, Data: []byte("new")},
	}, self)
	if len(batch) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(batch))
	}
}

func TestDedupeDKGBatchBySender(t *testing.T) {
	self := libtss.Identifier(2)
	batch := []libtss.Message{
		{From: 1, To: 2, Data: []byte("x")},
		{From: 3, To: 2, Data: []byte("y")},
		{From: 1, To: 2, Data: []byte("z")},
	}
	out := dedupeDKGBatchBySender(batch, self)
	if len(out) != 2 {
		t.Fatalf("expected 2, got %d", len(out))
	}
	if string(out[0].Data) != "x" {
		t.Fatalf("expected earliest sender fragment to be kept, got %q", string(out[0].Data))
	}
}
