package nostrtransport

import (
	"fmt"
	"os"
	"strings"
	"sync"
)

// PublishMode selects relay fan-out behavior for gift-wrap publishes.
type PublishMode int

const (
	// PublishModeCritical uses all non-blocked relays with background fan-out (ready/complete).
	PublishModeCritical PublishMode = iota
	// PublishModeBulk publishes to a small fast relay set only (MPC chunks).
	PublishModeBulk
)

// Client relay health state (session-scoped for the Client lifetime).
type relayHealth struct {
	mu             sync.Mutex
	blockedRelays  map[string]struct{}
}

func newRelayHealth() *relayHealth {
	return &relayHealth{blockedRelays: make(map[string]struct{})}
}

func (h *relayHealth) blockRelay(url string) {
	if url == "" || url == "<unknown>" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.blockedRelays[url]; !ok {
		h.blockedRelays[url] = struct{}{}
		fmt.Fprintf(os.Stderr, "BBMTLog: relay blocklisted for session: %s\n", url)
	}
}

func (h *relayHealth) isBlocked(url string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.blockedRelays[url]
	return ok
}

func shouldBlockRelay(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "blocked") || strings.Contains(msg, "rate limit") || strings.Contains(msg, "not allowed")
}

// relaysForPublish returns relay URLs to use for the given publish mode.
func (c *Client) relaysForPublish(mode PublishMode) []string {
	base := c.validRelays
	if len(base) == 0 {
		base = c.urls
	}
	available := make([]string, 0, len(base))
	for _, url := range base {
		if c.relayHealth != nil && c.relayHealth.isBlocked(url) {
			continue
		}
		available = append(available, url)
	}
	if len(available) == 0 {
		return base
	}

	if mode != PublishModeBulk {
		return available
	}

	n := c.cfg.FastPublishRelayCount
	if n <= 0 {
		n = 2
	}
	if n > len(available) {
		n = len(available)
	}
	fast := available[:n]
	fmt.Fprintf(os.Stderr, "BBMTLog: fast publish using %d/%d relays: %v\n", len(fast), len(available), fast)
	return fast
}
