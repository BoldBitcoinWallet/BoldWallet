package tss

import (
	"context"
	"testing"
	"time"
)

func TestRunNostrPreAgreementPSBTContextCanceled(t *testing.T) {
	resetNostrCancelStateForTest()
	root, cleanup, err := AttachNostrOperationRoot()
	if err != nil {
		t.Fatalf("attach failed: %v", err)
	}
	defer cleanup()

	go func() {
		time.Sleep(20 * time.Millisecond)
		nostrCancelMu.Lock()
		cancel := nostrActiveCancel
		nostrCancelMu.Unlock()
		if cancel != nil {
			cancel()
		}
	}()

	ctx, cancel := context.WithTimeout(root, time.Second)
	defer cancel()
	select {
	case <-ctx.Done():
		err := NostrMpcContextErr("pre-agreement", ctx.Err())
		if err == nil {
			t.Fatal("expected mapped error")
		}
		if err.Error() != "nostr mpc aborted during pre-agreement: context canceled" {
			t.Fatalf("unexpected: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected cancel")
	}
}
