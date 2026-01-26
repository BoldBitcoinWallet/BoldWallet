package tss

import "sync"

type HookListener interface {
	OnMessage(message string)
}

var (
	hookListener HookListener
	hookMutex    sync.RWMutex
)

func SetHookListener(h HookListener) {
	hookMutex.Lock()
	defer hookMutex.Unlock()
	hookListener = h
}

func Hook(message string) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				// Log panic but don't crash the app
				Logf("BBMTLog: PANIC in Hook goroutine: %v", r)
			}
		}()
		hookMutex.RLock()
		listener := hookListener
		hookMutex.RUnlock()
		if listener != nil {
			listener.OnMessage(message)
		}
		Logln(message)
	}()
}
