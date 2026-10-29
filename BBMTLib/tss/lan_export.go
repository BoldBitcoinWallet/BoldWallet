package tss

import "context"

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

// F39: LANKExchangeGroupKey posts this party's group-key hash to
// the relay and requires unanimity across parties before the
// keyshare is used. Mismatch fails closed; missing endpoint or
// timed-out peers warn and proceed (old-version compat).
func LANKExchangeGroupKey(server, session, selfParty string, parties []string, gkHashHex string) error {
	return exchangeGroupKeyConsensus(server, session, selfParty, parties, gkHashHex)
}

// LANAwaitPartyCompletions blocks until every party has flagged keygen complete
// (or ctx is cancelled / timeout). Used so the relay host does not StopRelay
// while peers are still finishing DKG.
func LANAwaitPartyCompletions(ctx context.Context, parties []string, server, session string) error {
	return awaitPartyCompletions(ctx, parties, server, session)
}

// NewLANMessenger returns an HTTP relay messenger for LAN MPC.
func NewLANMessenger(server, sessionID, sessionKey string) Messenger {
	return &MessengerImp{
		Server:     server,
		SessionID:  sessionID,
		SessionKey: sessionKey,
	}
}
