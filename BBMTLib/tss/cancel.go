package tss

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// MPC session cancellation (mobile-triggered)
// ---------------------------------------------------------------------------
//
// F12: cancellation is EXACT-match. A previous design keyed cancellation by
// sessionID prefix, so cancelMpcSession("ab") killed every "ab*" session and
// poisoned future matching sessions for 15 minutes.
//
// Multi-input signing still needs group cancel: mobile knows only the BASE
// session, while Go derives per-input sessions base+"0", base+"1", ... via
// deriveUtxoSession. The parent→child mapping is registered explicitly at
// derivation time, and CancelMpcSession enumerates the registered children —
// never a prefix scan. No prefix logic exists in this file.

var cancelMu sync.Mutex

// Per-session cancel channel. Closed means "cancel requested".
var cancelChBySession = map[string]chan struct{}{}

// Optional context cancel funcs (used by nostrtransport / other ctx-based loops).
var ctxCancelBySession = map[string]context.CancelFunc{}

// Exact session IDs that were cancelled. Consulted when a session registers,
// so cancel-before-start still takes effect. TTL bounds memory only: IDs are
// fresh per ceremony, so an exact entry can never poison another session.
var cancelledSessions = map[string]time.Time{}

// Parent of each derived session (child -> base), with registration time for
// TTL pruning. Written by deriveUtxoSession only.
type derivedLink struct {
	parent string
	at     time.Time
}

var derivedParents = map[string]derivedLink{}

const cancelledSessionTTL = 15 * time.Minute

func pruneCancelStateLocked(now time.Time) {
	for id, t := range cancelledSessions {
		if now.Sub(t) > cancelledSessionTTL {
			delete(cancelledSessions, id)
		}
	}
	for child, link := range derivedParents {
		if now.Sub(link.at) > cancelledSessionTTL {
			delete(derivedParents, child)
		}
	}
}

// isCancelledLocked reports whether id was cancelled exactly, or its
// registered parent was. Exact equality only — no prefix matching.
func isCancelledLocked(id string) bool {
	if _, ok := cancelledSessions[id]; ok {
		return true
	}
	if link, ok := derivedParents[id]; ok {
		if _, ok := cancelledSessions[link.parent]; ok {
			return true
		}
	}
	return false
}

// deriveUtxoSession formats a per-input derived session ID (base + index)
// and registers the parent link so CancelMpcSession(base) reaches it via
// explicit enumeration. Format is unchanged from the previous inline
// fmt.Sprintf("%s%d", ...) at each call site.
func deriveUtxoSession(base string, i int) string {
	derived := fmt.Sprintf("%s%d", base, i)
	if base == "" {
		return derived
	}
	cancelMu.Lock()
	defer cancelMu.Unlock()
	pruneCancelStateLocked(time.Now())
	derivedParents[derived] = derivedLink{parent: base, at: time.Now()}
	return derived
}

func closeCancelChLocked(ch chan struct{}) {
	select {
	case <-ch:
		// already closed
	default:
		close(ch)
	}
}

func getOrCreateCancelCh(sessionID string) chan struct{} {
	cancelMu.Lock()
	defer cancelMu.Unlock()

	now := time.Now()
	pruneCancelStateLocked(now)

	if ch, ok := cancelChBySession[sessionID]; ok {
		return ch
	}

	ch := make(chan struct{})
	cancelChBySession[sessionID] = ch

	// If this exact session (or its parent) was already cancelled,
	// start cancelled immediately.
	if isCancelledLocked(sessionID) {
		close(ch)
		cancelledSessions[sessionID] = now
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
	pruneCancelStateLocked(time.Now())
	ctxCancelBySession[sessionID] = cancel
	// Cancel-before-start: a ctx loop registering for an already-cancelled
	// session (or child of one) must observe cancellation immediately.
	if isCancelledLocked(sessionID) {
		cancel()
	}
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

// CancelMpcSession requests cancellation for a given session ID.
//
// Exact match only: it cancels the named session plus its explicitly
// registered derived children (see deriveUtxoSession). It records the exact
// IDs so sessions that start later still start cancelled. It never affects
// any other session, however similar its ID.
//
// Exposed to mobile via c-shared bind (BbmtCancelMpcSession). The ceremony
// token is consumed/revoked natively in the bridge layer before this runs.
func CancelMpcSession(sessionID string) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("sessionID is empty")
	}

	cancelMu.Lock()
	now := time.Now()
	pruneCancelStateLocked(now)
	cancelledSessions[sessionID] = now

	cancelOneLocked := func(sid string) {
		if ch, ok := cancelChBySession[sid]; ok {
			closeCancelChLocked(ch)
		}
		if cancel, ok := ctxCancelBySession[sid]; ok {
			// Best-effort; cancel should be idempotent.
			cancel()
			// Keep entry; callers may still unregister on exit.
		}
	}

	cancelOneLocked(sessionID)

	// Explicit enumeration of registered children — not a prefix scan.
	for child, link := range derivedParents {
		if link.parent == sessionID {
			cancelOneLocked(child)
			cancelledSessions[child] = now
		}
	}
	cancelMu.Unlock()

	return "ok", nil
}

// resetCancelStateForTest clears all cancellation maps (tests only).
func resetCancelStateForTest() {
	cancelMu.Lock()
	defer cancelMu.Unlock()
	cancelChBySession = map[string]chan struct{}{}
	ctxCancelBySession = map[string]context.CancelFunc{}
	cancelledSessions = map[string]time.Time{}
	derivedParents = map[string]derivedLink{}
}
