package tss

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// MPC session cancellation (mobile-triggered)
// ---------------------------------------------------------------------------

// We key cancellation by "sessionID prefix" because multi-input signing uses
// derived session IDs like: sessionID + strconv(i). Mobile only knows the base.

var cancelMu sync.Mutex

// Per-session cancel channel. Closed means "cancel requested".
var cancelChBySession = map[string]chan struct{}{}

// Optional context cancel funcs (used by nostrtransport / other ctx-based loops).
var ctxCancelBySession = map[string]context.CancelFunc{}

// Prefixes that have been cancelled (so future derived session IDs start cancelled).
var cancelledPrefixes = map[string]time.Time{}

const cancelPrefixTTL = 15 * time.Minute

func pruneCancelledPrefixesLocked(now time.Time) {
	for p, t := range cancelledPrefixes {
		if now.Sub(t) > cancelPrefixTTL {
			delete(cancelledPrefixes, p)
		}
	}
}

func isPrefixCancelledLocked(sessionID string) bool {
	for p := range cancelledPrefixes {
		if strings.HasPrefix(sessionID, p) {
			return true
		}
	}
	return false
}

func getOrCreateCancelCh(sessionID string) chan struct{} {
	cancelMu.Lock()
	defer cancelMu.Unlock()

	now := time.Now()
	pruneCancelledPrefixesLocked(now)

	if ch, ok := cancelChBySession[sessionID]; ok {
		return ch
	}

	ch := make(chan struct{})
	cancelChBySession[sessionID] = ch

	// If a prefix cancellation already happened, start cancelled immediately.
	if isPrefixCancelledLocked(sessionID) {
		close(ch)
	}

	return ch
}

func sessionIsCancelled(sessionID string) bool {
	ch := getOrCreateCancelCh(sessionID)
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

func registerCtxCancel(sessionID string, cancel context.CancelFunc) {
	if cancel == nil {
		return
	}
	cancelMu.Lock()
	defer cancelMu.Unlock()
	ctxCancelBySession[sessionID] = cancel
}

func unregisterCtxCancel(sessionID string) {
	cancelMu.Lock()
	defer cancelMu.Unlock()
	delete(ctxCancelBySession, sessionID)
}

func cleanupCancelState(sessionID string) {
	cancelMu.Lock()
	defer cancelMu.Unlock()
	delete(cancelChBySession, sessionID)
	delete(ctxCancelBySession, sessionID)
}

// CancelMpcSession requests cancellation for a given base session ID.
// It cancels any currently-running derived sessions (prefix match) and ensures
// any future derived sessions start cancelled.
//
// Exposed to mobile via gomobile bind.
func CancelMpcSession(sessionID string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("sessionID is empty")
	}

	cancelMu.Lock()
	now := time.Now()
	pruneCancelledPrefixesLocked(now)
	cancelledPrefixes[sessionID] = now

	// Cancel all known sessions with this prefix.
	for sid, ch := range cancelChBySession {
		if strings.HasPrefix(sid, sessionID) {
			select {
			case <-ch:
				// already closed
			default:
				close(ch)
			}
		}
	}
	for sid, cancel := range ctxCancelBySession {
		if strings.HasPrefix(sid, sessionID) {
			// Best-effort; cancel should be idempotent.
			cancel()
			// Keep entry; callers may still unregister on exit.
		}
	}
	cancelMu.Unlock()

	return "ok", nil
}

