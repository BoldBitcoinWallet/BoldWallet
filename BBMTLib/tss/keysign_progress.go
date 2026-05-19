package tss

// ReportKeysignProgress updates session status for React Native progress listeners (type=keysign).
func ReportKeysignProgress(session string, step int, info string, done bool) {
	status := Status{
		Step:  step,
		SeqNo: 0,
		Index: 0,
		Info:  info,
		Type:  "keysign",
		Done:  done,
		Time:  0,
	}
	setStatus(session, status)
}

// InitKeysignProgress resets keysign progress for a session.
func InitKeysignProgress(session string) {
	ReportKeysignProgress(session, 0, "initializing...", false)
}
