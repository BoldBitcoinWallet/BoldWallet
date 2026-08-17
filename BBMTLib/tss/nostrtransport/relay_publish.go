package nostrtransport

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// PublishMode selects relay fan-out behavior for gift-wrap publishes.
type PublishMode int

const (
	// PublishModeCritical uses all non-blocked relays with background fan-out (ready/complete).
	PublishModeCritical PublishMode = iota
	// PublishModeBulk publishes to a small fast relay set only (MPC chunks).
	PublishModeBulk
)

const (
	bulkPublishTimeout = 4 * time.Second
	relayEwmaAlpha     = 0.3
)

func publishModeName(mode PublishMode) string {
	if mode == PublishModeBulk {
		return "bulk"
	}
	return "critical"
}

func truncateErr(err error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	if strings.Contains(s, "nsec1") {
		return "redacted"
	}
	if len(s) > 160 {
		return s[:160]
	}
	return s
}

type relayStat struct {
	connected bool
	ewmaRtt   time.Duration
	fails     int
}

// Client relay health state (session-scoped for the Client lifetime).
type relayHealth struct {
	mu            sync.Mutex
	blockedRelays map[string]struct{}
	stats         map[string]*relayStat
}

func newRelayHealth() *relayHealth {
	return &relayHealth{
		blockedRelays: make(map[string]struct{}),
		stats:         make(map[string]*relayStat),
	}
}

func (h *relayHealth) blockRelay(url string) {
	if h == nil || url == "" || url == "<unknown>" {
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
	if h == nil {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.blockedRelays[url]
	return ok
}

func (h *relayHealth) markConnected(url string) {
	if h == nil || url == "" || url == "<unknown>" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	st := h.ensureStatLocked(url)
	st.connected = true
}

func (h *relayHealth) recordPublish(url string, ok bool, rtt time.Duration) {
	if h == nil || url == "" || url == "<unknown>" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	st := h.ensureStatLocked(url)
	if ok {
		st.fails = 0
		st.connected = true
		if st.ewmaRtt == 0 {
			st.ewmaRtt = rtt
		} else {
			st.ewmaRtt = time.Duration(relayEwmaAlpha*float64(rtt) + (1-relayEwmaAlpha)*float64(st.ewmaRtt))
		}
		return
	}
	st.fails++
}

func (h *relayHealth) ensureStatLocked(url string) *relayStat {
	if h.stats == nil {
		h.stats = make(map[string]*relayStat)
	}
	st := h.stats[url]
	if st == nil {
		st = &relayStat{}
		h.stats[url] = st
	}
	return st
}

type scoredRelay struct {
	url   string
	index int
	score int64
}

func (h *relayHealth) rankBulk(available []string, n int) []string {
	if n <= 0 {
		return nil
	}
	if n > len(available) {
		n = len(available)
	}
	if h == nil {
		return append([]string(nil), available[:n]...)
	}

	items := make([]scoredRelay, len(available))
	h.mu.Lock()
	for i, url := range available {
		st := h.stats[url]
		var score int64
		if st == nil || !st.connected {
			score += 1_000_000_000
		}
		if st != nil && st.fails > 0 {
			score += int64(st.fails) * 10_000_000
		}
		if st == nil || st.ewmaRtt == 0 {
			score += 5_000_000
		} else {
			score += st.ewmaRtt.Milliseconds()
		}
		items[i] = scoredRelay{url: url, index: i, score: score}
	}
	h.mu.Unlock()

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].score != items[j].score {
			return items[i].score < items[j].score
		}
		return items[i].index < items[j].index
	})
	out := make([]string, n)
	for i := 0; i < n; i++ {
		out[i] = items[i].url
	}
	return out
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
	fast := c.relayHealth.rankBulk(available, n)
	fmt.Fprintf(os.Stderr, "BBMTLog: fast publish using %d/%d relays: %v\n", len(fast), len(available), fast)
	return fast
}
