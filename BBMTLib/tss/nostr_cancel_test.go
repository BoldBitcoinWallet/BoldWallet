package tss

import (
	"context"
	"testing"
	"time"
)

func TestCancelNostrMpc_NoActiveOperation(t *testing.T) {
	resetNostrCancelStateForTest()
	_, err := CancelNostrMpc()
	if err == nil {
		t.Fatal("expected error when no active operation")
	}
	if err.Error() != "no active nostr mpc operation" {
		t.Fatalf("unexpected error: %v", err)
	}
	if nostrAbortedAt.IsZero() {
		t.Fatal("expected abort timestamp even when no active operation")
	}
}

func TestCancelNostrMpc_ActiveOperation(t *testing.T) {
	resetNostrCancelStateForTest()
	ctx, cancel := context.WithCancel(context.Background())
	setActiveNostrCtx(ctx, cancel)

	out, err := CancelNostrMpc()
	if err != nil {
		t.Fatalf("cancel failed: %v", err)
	}
	if out != "ok" {
		t.Fatalf("expected ok, got %q", out)
	}

	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("context not cancelled")
	}
}

func TestCancelNostrMpc_RepeatedCalls(t *testing.T) {
	resetNostrCancelStateForTest()
	ctx, cancel := context.WithCancel(context.Background())
	setActiveNostrCtx(ctx, cancel)

	if _, err := CancelNostrMpc(); err != nil {
		t.Fatalf("first cancel: %v", err)
	}
	// Second call: cancel func still set until clearActiveNostrCtx
	if _, err := CancelNostrMpc(); err != nil {
		t.Fatalf("second cancel should be best-effort ok: %v", err)
	}
	resetNostrCancelStateForTest()
	_, err := CancelNostrMpc()
	if err == nil {
		t.Fatal("expected error after clear")
	}
}

func TestGetActiveNostrCtx_FallbackBackground(t *testing.T) {
	resetNostrCancelStateForTest()
	c := getActiveNostrCtx()
	if c == nil {
		t.Fatal("expected non-nil context")
	}
}

func TestGetActiveNostrCtx_IgnoresCanceled(t *testing.T) {
	resetNostrCancelStateForTest()
	ctx, cancel := context.WithCancel(context.Background())
	setActiveNostrCtx(ctx, cancel)
	cancel()
	c := getActiveNostrCtx()
	if c.Err() != nil {
		t.Fatal("getActiveNostrCtx should not return canceled context")
	}
}

func TestNostrMpcAbortCooldown_BlocksRestart(t *testing.T) {
	resetNostrCancelStateForTest()
	markNostrMpcAborted()
	err := CheckNostrMpcCanStart()
	if err == nil {
		t.Fatal("expected cooldown error")
	}
	if _, err := beginNostrMpcOperation(); err == nil {
		t.Fatal("expected begin to fail during cooldown")
	}
}

func TestNostrMpcAbortCooldown_AllowsAfterWait(t *testing.T) {
	resetNostrCancelStateForTest()
	nostrCancelMu.Lock()
	nostrAbortedAt = time.Now().Add(-NostrMpcAbortCooldown - time.Second)
	nostrCancelMu.Unlock()

	if err := CheckNostrMpcCanStart(); err != nil {
		t.Fatalf("expected cooldown expired: %v", err)
	}
	rootCtx, err := beginNostrMpcOperation()
	if err != nil {
		t.Fatalf("begin failed after cooldown: %v", err)
	}
	if rootCtx.Err() != nil {
		t.Fatal("expected live root context")
	}
	endNostrMpcOperation()
}
