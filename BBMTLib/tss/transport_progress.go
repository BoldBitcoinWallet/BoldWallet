package tss

import (
	"encoding/json"

	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
)

func init() {
	nostrtransport.SetTransportProgressHook(ReportTransportProgress)
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
