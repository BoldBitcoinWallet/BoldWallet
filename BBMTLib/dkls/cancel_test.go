package dkls

import (
	"context"
	"testing"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

func TestCancelMpcSessionEmptyCancelsAll(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	RegisterCancel("session-a", cancel)
	RegisterCancel("session-b", func() {})

	CancelMpcSession("")

	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("expected session-a cancel")
	}
}

func TestRecvPeerMessageBatchRespectsCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	ch := make(chan []libtss.Message)
	_, err := recvPeerMessageBatch(
		ctx,
		ch,
		libtss.Identifier(1),
		1,
		time.Now().Add(time.Minute),
		50*time.Millisecond,
	)
	if err == nil {
		t.Fatal("expected cancel error")
	}
}
