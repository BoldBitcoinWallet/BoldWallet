package tss

import (
	"net/http"
	"time"
)

// F25: bounded HTTP clients for LAN relay transport.
//
// A malicious (or wedged) relay must never hang the client indefinitely.
// Every relay call site retries on failure (poll loops) or fails its ceremony
// step closed (unary calls), so short timeouts are safe AND more available
// than long ones: a timed-out poll retries on the next tick instead of
// stalling the ceremony.
//
// Tiers (both 100x+ above legitimate LAN RTT, well under the 60-70s
// ceremony budgets keySignTimeout/msgFetchTimeout):
//
//	RelayPollTimeout    — retry-loop calls: polls, join attempts, joiner waits.
//	RelayRequestTimeout — unary calls: message send, session end, complete
//	                      flags, message delete.
//
// The clients are package singletons shared with dkls (same relay, same
// budget). Do not mutate Timeout after init.
const (
	RelayPollTimeout    = 5 * time.Second
	RelayRequestTimeout = 10 * time.Second
)

var (
	relayPollClient    = &http.Client{Timeout: RelayPollTimeout}
	relayRequestClient = &http.Client{Timeout: RelayRequestTimeout}
)

// RelayPollClient returns the shared bounded client for retry-loop relay
// calls. Exported for the dkls transport (lan_pump); tss uses relayPollClient.
func RelayPollClient() *http.Client { return relayPollClient }

// RelayRequestClient returns the shared bounded client for unary relay
// calls. Exported for the dkls transport (lan_pump); tss uses relayRequestClient.
func RelayRequestClient() *http.Client { return relayRequestClient }
