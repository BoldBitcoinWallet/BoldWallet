package dkls

import (
	"sync"
)

var (
	cancelMu    sync.Mutex
	cancelFuncs = map[string]func(){}
)

// RegisterCancel stores a cancel function for a session id.
func RegisterCancel(sessionID string, cancel func()) {
	cancelMu.Lock()
	defer cancelMu.Unlock()
	cancelFuncs[sessionID] = cancel
}

// CancelMpcSession cancels an active DKLs MPC session.
func CancelMpcSession(sessionID string) {
	cancelMu.Lock()
	fn, ok := cancelFuncs[sessionID]
	delete(cancelFuncs, sessionID)
	cancelMu.Unlock()
	if ok && fn != nil {
		fn()
	}
}
