package nostrtransport

// TransportProgressFunc reports outbound/inbound transport progress to mobile UI.
type TransportProgressFunc func(sessionID, transport, direction string, chunk, total int, active bool)

var transportProgressHook TransportProgressFunc

// SetTransportProgressHook registers a callback for chunk/upload progress (set from tss).
func SetTransportProgressHook(fn TransportProgressFunc) {
	transportProgressHook = fn
}

func reportTransportProgress(sessionID string, chunk, total int, active bool) {
	if transportProgressHook == nil || sessionID == "" {
		return
	}
	transportProgressHook(sessionID, "nostr", "out", chunk, total, active)
}
