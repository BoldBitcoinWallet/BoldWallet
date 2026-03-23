package tss

import (
	"context"
	"fmt"
	"sync"
)

// Global cancellation for the currently-running Nostr MPC operation.
// Mobile does not provide an explicit sessionID to Nostr MPC entrypoints today,
// so we keep a single active cancel handle (UI guarantees only one operation).

var nostrCancelMu sync.Mutex
var nostrActiveCtx context.Context
var nostrActiveCancel context.CancelFunc

func setActiveNostrCtx(ctx context.Context, cancel context.CancelFunc) {
	nostrCancelMu.Lock()
	defer nostrCancelMu.Unlock()
	nostrActiveCtx = ctx
	nostrActiveCancel = cancel
}

func clearActiveNostrCtx() {
	nostrCancelMu.Lock()
	defer nostrCancelMu.Unlock()
	nostrActiveCtx = nil
	nostrActiveCancel = nil
}

func getActiveNostrCtx() context.Context {
	nostrCancelMu.Lock()
	defer nostrCancelMu.Unlock()
	if nostrActiveCtx != nil {
		return nostrActiveCtx
	}
	return context.Background()
}

// CancelNostrMpc cancels the currently running Nostr MPC operation (best-effort).
// Exposed to mobile via gomobile bind.
func CancelNostrMpc() (string, error) {
	nostrCancelMu.Lock()
	cancel := nostrActiveCancel
	nostrCancelMu.Unlock()
	if cancel == nil {
		return "", fmt.Errorf("no active nostr mpc operation")
	}
	cancel()
	return "ok", nil
}
