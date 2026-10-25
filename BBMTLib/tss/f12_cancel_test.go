package tss

import (
	"context"
	"testing"
)

// F12: cancellation is exact-match. Prefix matching and the 15-minute poison
// window are gone; multi-input derived sessions are reached via the explicit
// parent link registered by deriveUtxoSession.

func f12Reset(t *testing.T) {
	t.Helper()
	resetCancelStateForTest()
	t.Cleanup(resetCancelStateForTest)
}

func TestF12_DeriveFormatUnchanged(t *testing.T) {
	f12Reset(t)
	// Relay/peer session naming must not change: base + decimal index.
	if got := deriveUtxoSession("sess", 3); got != "sess3" {
		t.Fatalf("deriveUtxoSession(sess,3) = %q, want sess3", got)
	}
	if got := deriveUtxoSession("sess", 0); got != "sess0" {
		t.Fatalf("deriveUtxoSession(sess,0) = %q, want sess0", got)
	}
}

func TestF12_ExactMatchKillsTarget(t *testing.T) {
	f12Reset(t)
	getOrCreateCancelCh("f12-target")
	if _, err := CancelMpcSession("f12-target"); err != nil {
		t.Fatalf("CancelMpcSession: %v", err)
	}
	if !sessionIsCancelled("f12-target") {
		t.Fatalf("exact cancel did not cancel the target session")
	}
}

func TestF12_ExactMatchDoesNotKillSiblings(t *testing.T) {
	f12Reset(t)
	getOrCreateCancelCh("f12-ab")
	getOrCreateCancelCh("f12-abc123")
	if _, err := CancelMpcSession("f12-ab"); err != nil {
		t.Fatalf("CancelMpcSession: %v", err)
	}
	if !sessionIsCancelled("f12-ab") {
		t.Fatalf("cancel target not cancelled")
	}
	if sessionIsCancelled("f12-abc123") {
		t.Fatalf("prefix sibling f12-abc123 killed by cancel(f12-ab): prefix matching lives")
	}
}

func TestF12_NoPoisonWindow(t *testing.T) {
	f12Reset(t)
	if _, err := CancelMpcSession("f12-A"); err != nil {
		t.Fatalf("CancelMpcSession: %v", err)
	}
	// A different session starting after the cancel runs unaffected,
	// even one sharing a string prefix with the cancelled ID.
	getOrCreateCancelCh("f12-B")
	if sessionIsCancelled("f12-B") {
		t.Fatalf("unrelated session poisoned by cancel of another ID")
	}
	getOrCreateCancelCh("f12-A2")
	if sessionIsCancelled("f12-A2") {
		t.Fatalf("prefix-sharing session f12-A2 poisoned by cancel(f12-A)")
	}
}

func TestF12_CancelBeforeStart(t *testing.T) {
	f12Reset(t)
	if _, err := CancelMpcSession("f12-pre"); err != nil {
		t.Fatalf("CancelMpcSession: %v", err)
	}
	// Session starting after its exact ID was cancelled starts cancelled.
	if !sessionIsCancelled("f12-pre") {
		t.Fatalf("session starting after exact cancel did not start cancelled")
	}
}

func TestF12_DerivedSessionsCancelled(t *testing.T) {
	f12Reset(t)
	d0 := deriveUtxoSession("f12-base", 0)
	getOrCreateCancelCh(d0) // input 0 signing now
	if _, err := CancelMpcSession("f12-base"); err != nil {
		t.Fatalf("CancelMpcSession: %v", err)
	}
	if !sessionIsCancelled(d0) {
		t.Fatalf("running derived session %q not cancelled via base", d0)
	}
	// Input 1 derives and starts AFTER the cancel: still starts cancelled
	// via the parent link, with no prefix scan.
	d1 := deriveUtxoSession("f12-base", 1)
	if !sessionIsCancelled(d1) {
		t.Fatalf("late-derived session %q did not start cancelled", d1)
	}
	// And the base itself is recorded.
	if !sessionIsCancelled("f12-base") {
		t.Fatalf("cancelled base session not reported cancelled")
	}
}

func TestF12_CtxRegisterAfterCancelObservesImmediately(t *testing.T) {
	f12Reset(t)
	if _, err := CancelMpcSession("f12-ctx"); err != nil {
		t.Fatalf("CancelMpcSession: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	registerCtxCancel("f12-ctx", cancel)
	select {
	case <-ctx.Done():
	default:
		t.Fatalf("ctx loop registering after cancel did not observe cancellation")
	}
	unregisterCtxCancel("f12-ctx")
}

func TestF12_EmptyRejected(t *testing.T) {
	f12Reset(t)
	if _, err := CancelMpcSession(""); err == nil {
		t.Fatalf("empty sessionID cancel must fail")
	}
}
