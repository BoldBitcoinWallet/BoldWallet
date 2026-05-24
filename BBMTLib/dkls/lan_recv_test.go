package dkls

import (
	"context"
	"testing"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

func msgFrom(sender libtss.Identifier) libtss.Message {
	return libtss.Message{From: sender, To: 0}
}

func TestRecvPeerMessageBatch_StaggeredTrioSenders(t *testing.T) {
	ch := make(chan []libtss.Message, 8)
	selfID := libtss.Identifier(1)
	deadline := time.Now().Add(2 * time.Second)

	go func() {
		time.Sleep(30 * time.Millisecond)
		ch <- []libtss.Message{msgFrom(2)}
		time.Sleep(30 * time.Millisecond)
		ch <- []libtss.Message{msgFrom(3)}
	}()

	batch, err := recvPeerMessageBatch(context.Background(), ch, selfID, 2, deadline, 50*time.Millisecond)
	if err != nil {
		t.Fatalf("recvPeerMessageBatch: %v", err)
	}
	if len(batch) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(batch))
	}
}
