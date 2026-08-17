package nostrtransport

// TransportProgressFunc reports outbound/inbound transport progress to mobile UI.
type TransportProgressFunc func(sessionID, transport, direction string, chunk, total int, active bool)

// RelayFidelityFunc reports per-relay publish OK/fail and RTT to mobile logs.
type RelayFidelityFunc func(sessionID, op, relay, mode, errMsg string, ok bool, rttMs int64)

var transportProgressHook TransportProgressFunc
var relayFidelityHook RelayFidelityFunc

// SetTransportProgressHook registers a callback for chunk/upload progress (set from tss).
func SetTransportProgressHook(fn TransportProgressFunc) {
	transportProgressHook = fn
}

// SetRelayFidelityHook registers a callback for per-relay publish telemetry (set from tss).
func SetRelayFidelityHook(fn RelayFidelityFunc) {
	relayFidelityHook = fn
}

func reportTransportProgress(sessionID string, chunk, total int, active bool) {
	if transportProgressHook == nil || sessionID == "" {
		return
	}
	transportProgressHook(sessionID, "nostr", "out", chunk, total, active)
}

func reportRelayFidelity(sessionID, op, relay, mode, errMsg string, ok bool, rttMs int64) {
	if relayFidelityHook == nil || sessionID == "" {
		return
	}
	relayFidelityHook(sessionID, op, relay, mode, errMsg, ok, rttMs)
}
