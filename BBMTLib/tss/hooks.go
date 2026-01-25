package tss

type HookListener interface {
	OnMessage(message string)
}

var hookListener HookListener

func SetHookListener(h HookListener) {
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
		if hookListener != nil {
			hookListener.OnMessage(message)
		}
		Logln(message)
	}()
}
