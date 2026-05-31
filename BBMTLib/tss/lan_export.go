package tss

// LANJoinSession registers a participant on the HTTP relay for LAN MPC.
func LANJoinSession(server, session, key string) error {
	return joinSession(server, session, key)
}

// LANAwaitJoiners blocks until all parties have joined the LAN session.
func LANAwaitJoiners(parties []string, server, session string) error {
	return awaitJoiners(parties, server, session)
}

// LANEndSession signals session completion on the relay.
func LANEndSession(server, session string) error {
	return endSession(server, session)
}

// LANFlagPartyComplete marks a party as done on the relay.
func LANFlagPartyComplete(server, session, key string) error {
	return flagPartyComplete(server, session, key)
}

// NewLANMessenger returns an HTTP relay messenger for LAN MPC.
func NewLANMessenger(server, sessionID, sessionKey string) Messenger {
	return &MessengerImp{
		Server:     server,
		SessionID:  sessionID,
		SessionKey: sessionKey,
	}
}
