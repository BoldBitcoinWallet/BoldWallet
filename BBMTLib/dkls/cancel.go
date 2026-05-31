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
// Empty sessionID cancels all registered sessions (mobile abort).
func CancelMpcSession(sessionID string) {
	cancelMu.Lock()
	defer cancelMu.Unlock()
	if sessionID == "" {
		for id, fn := range cancelFuncs {
			if fn != nil {
				fn()
			}
			delete(cancelFuncs, id)
		}
		return
	}
	fn, ok := cancelFuncs[sessionID]
	delete(cancelFuncs, sessionID)
	if ok && fn != nil {
		fn()
	}
}
