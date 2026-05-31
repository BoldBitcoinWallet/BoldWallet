package tss

// ReportKeygenProgress updates session status for React Native progress listeners (type=keygen).
func ReportKeygenProgress(session string, step int, info string, done bool) {
	status := Status{
		Step:  step,
		SeqNo: 0,
		Index: 0,
		Info:  info,
		Type:  "keygen",
		Done:  done,
		Time:  0,
	}
	setStatus(session, status)
}

// InitKeygenProgress resets keygen progress for a session.
func InitKeygenProgress(session string) {
	ReportKeygenProgress(session, 0, "initializing...", false)
}
