package tss

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestNostrMpcContextErr_Canceled(t *testing.T) {
	err := NostrMpcContextErr("pre-agreement", context.Canceled)
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected wrapped cancel: %v", err)
	}
	if err.Error() != "nostr mpc aborted during pre-agreement: context canceled" {
		t.Fatalf("unexpected message: %v", err)
	}
}

func TestNostrMpcContextErr_Deadline(t *testing.T) {
	err := NostrMpcContextErr("keysign", context.DeadlineExceeded)
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline: %v", err)
	}
}

func TestAttachNostrOperationRoot_ReusesActive(t *testing.T) {
	resetNostrCancelStateForTest()
	root, cleanup, err := AttachNostrOperationRoot()
	if err != nil {
		t.Fatalf("attach failed: %v", err)
	}
	defer cleanup()

	_, childCleanup, err := AttachNostrOperationRoot()
	if err != nil {
		t.Fatalf("nested attach failed: %v", err)
	}
	childCleanup()
	if root.Err() != nil {
		t.Fatal("nested cleanup should not cancel parent root")
	}

	nostrCancelMu.Lock()
	active := nostrActiveCtx
	nostrCancelMu.Unlock()
	if active == nil {
		t.Fatal("expected active root")
	}
	cancel := nostrActiveCancel
	if cancel == nil {
		t.Fatal("expected active cancel func")
	}
	cancel()
	select {
	case <-root.Done():
	case <-time.After(time.Second):
		t.Fatal("root not canceled")
	}
}
