package tss

import (
	"encoding/json"

	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
)

func init() {
	nostrtransport.SetTransportProgressHook(ReportTransportProgress)
	nostrtransport.SetRelayFidelityHook(ReportRelayFidelity)
}

// TransportHookMessage is emitted on TssHook for upload/download subprogress UI.
type TransportHookMessage struct {
	Type      string `json:"type"`
	Session   string `json:"session"`
	Transport string `json:"transport"`
	Direction string `json:"direction"`
	Chunk     int    `json:"chunk"`
	Total     int    `json:"total"`
	Active    bool   `json:"active"`
}

// ReportTransportProgress emits a transport hook for mobile subprogress UI.
func ReportTransportProgress(session, transport, direction string, chunk, total int, active bool) {
	session = trimSession(session)
	if session == "" {
		return
	}
	if total < 1 {
		total = 1
	}
	if chunk < 0 {
		chunk = 0
	}
	if chunk > total {
		chunk = total
	}
	payload, err := json.Marshal(TransportHookMessage{
		Type:      "transport",
		Session:   session,
		Transport: transport,
		Direction: direction,
		Chunk:     chunk,
		Total:     total,
		Active:    active,
	})
	if err != nil {
		return
	}
	Hook(string(payload))
}

// RelayHookMessage is emitted on TssHook for per-relay publish fidelity logs.
type RelayHookMessage struct {
	Type      string `json:"type"`
	Session   string `json:"session"`
	Transport string `json:"transport"`
	Op        string `json:"op"`
	Relay     string `json:"relay,omitempty"`
	Ok        bool   `json:"ok"`
	Err       string `json:"err,omitempty"`
	RttMs     int64  `json:"rtt_ms"`
	Mode      string `json:"mode,omitempty"`
}

// ReportRelayFidelity emits a relay hook for logcat (does not move MPC %).
func ReportRelayFidelity(session, op, relay, mode, errMsg string, ok bool, rttMs int64) {
	session = trimSession(session)
	if session == "" {
		return
	}
	if rttMs < 0 {
		rttMs = 0
	}
	payload, err := json.Marshal(RelayHookMessage{
		Type:      "relay",
		Session:   session,
		Transport: "nostr",
		Op:        op,
		Relay:     relay,
		Ok:        ok,
		Err:       errMsg,
		RttMs:     rttMs,
		Mode:      mode,
	})
	if err != nil {
		return
	}
	Hook(string(payload))
}

func trimSession(session string) string {
	for len(session) > 0 && (session[0] == ' ' || session[0] == '\t') {
		session = session[1:]
	}
	for len(session) > 0 {
		last := session[len(session)-1]
		if last != ' ' && last != '\t' {
			break
		}
		session = session[:len(session)-1]
	}
	return session
}
