package tss

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// NostrMpcAbortCooldown is how long to wait after abort before starting a new Nostr MPC flow.
const NostrMpcAbortCooldown = 15 * time.Second

// Global cancellation for the currently-running Nostr MPC operation.
// Mobile does not provide an explicit sessionID to Nostr MPC entrypoints today,
// so we keep a single active cancel handle (UI guarantees only one operation).

var nostrCancelMu sync.Mutex
var nostrActiveCtx context.Context
var nostrActiveCancel context.CancelFunc
var nostrAbortedAt time.Time

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

// getActiveNostrCtx returns the active Nostr MPC context, never a canceled one.
func getActiveNostrCtx() context.Context {
	nostrCancelMu.Lock()
	defer nostrCancelMu.Unlock()
	if nostrActiveCtx != nil && nostrActiveCtx.Err() == nil {
		return nostrActiveCtx
	}
	return context.Background()
}

// CheckNostrMpcCanStart returns an error if a recent abort is still within the cooldown window.
func CheckNostrMpcCanStart() error {
	nostrCancelMu.Lock()
	defer nostrCancelMu.Unlock()
	if nostrAbortedAt.IsZero() {
		return nil
	}
	rem := NostrMpcAbortCooldown - time.Since(nostrAbortedAt)
	if rem > 0 {
		sec := int(rem.Seconds()) + 1
		if sec < 1 {
			sec = 1
		}
		return fmt.Errorf(
			"nostr mpc aborted: wait %d seconds before retrying",
			sec,
		)
	}
	nostrAbortedAt = time.Time{}
	return nil
}

// beginNostrMpcOperation installs a fresh cancel context for a new Nostr MPC flow (send, PSBT, keygen, keysign).
func beginNostrMpcOperation() (context.Context, error) {
	if err := CheckNostrMpcCanStart(); err != nil {
		return nil, err
	}
	nostrCancelMu.Lock()
	defer nostrCancelMu.Unlock()
	if nostrActiveCancel != nil {
		nostrActiveCancel()
	}
	rootCtx, rootCancel := context.WithCancel(context.Background())
	nostrActiveCtx = rootCtx
	nostrActiveCancel = rootCancel
	return rootCtx, nil
}

// endNostrMpcOperation clears the active Nostr MPC context when a flow finishes.
func endNostrMpcOperation() {
	clearActiveNostrCtx()
}

func markNostrMpcAborted() {
	nostrCancelMu.Lock()
	defer nostrCancelMu.Unlock()
	nostrAbortedAt = time.Now()
}

// CancelNostrMpc cancels the currently running Nostr MPC operation (best-effort).
// Exposed to mobile via gomobile bind.
func CancelNostrMpc() (string, error) {
	nostrCancelMu.Lock()
	cancel := nostrActiveCancel
	nostrCancelMu.Unlock()

	markNostrMpcAborted()

	if cancel == nil {
		return "", fmt.Errorf("no active nostr mpc operation")
	}
	cancel()
	return "ok", nil
}

// resetNostrCancelStateForTest clears cancel handles and abort cooldown (tests only).
func resetNostrCancelStateForTest() {
	nostrCancelMu.Lock()
	defer nostrCancelMu.Unlock()
	if nostrActiveCancel != nil {
		nostrActiveCancel()
	}
	nostrActiveCtx = nil
	nostrActiveCancel = nil
	nostrAbortedAt = time.Time{}
}
