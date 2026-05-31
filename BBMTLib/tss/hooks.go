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
		defer RecoverGoroutine("Hook goroutine")
		hookMutex.RLock()
		listener := hookListener
		hookMutex.RUnlock()
		if listener != nil {
			listener.OnMessage(message)
		}
		Logln(message)
	}()
}
