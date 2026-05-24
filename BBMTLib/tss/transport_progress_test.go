package tss

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
)

type hookCapture struct {
	mu   sync.Mutex
	msgs []string
}

func (c *hookCapture) OnMessage(message string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.msgs = append(c.msgs, message)
}

func (c *hookCapture) last() TransportHookMessage {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.msgs) == 0 {
		return TransportHookMessage{}
	}
	var m TransportHookMessage
	_ = json.Unmarshal([]byte(c.msgs[len(c.msgs)-1]), &m)
	return m
}

func TestReportTransportProgress_LAN(t *testing.T) {
	cap := &hookCapture{}
	SetHookListener(cap)
	defer SetHookListener(nil)

	ReportTransportProgress("abc123", "lan", "out", 0, 1, true)
	time.Sleep(50 * time.Millisecond)
	cap.mu.Lock()
	n := len(cap.msgs)
	cap.mu.Unlock()
	if n < 1 {
		t.Fatal("expected hook message")
	}
	m := cap.last()
	if m.Type != "transport" || m.Transport != "lan" || !m.Active {
		t.Fatalf("unexpected hook: %+v", m)
	}

	ReportTransportProgress("abc123", "lan", "out", 0, 1, false)
	time.Sleep(50 * time.Millisecond)
	m = cap.last()
	if m.Active {
		t.Fatal("expected inactive")
	}
}

func TestReportTransportProgress_NostrChunks(t *testing.T) {
	cap := &hookCapture{}
	SetHookListener(cap)
	defer SetHookListener(nil)

	ReportTransportProgress("sess", "nostr", "out", 2, 5, true)
	time.Sleep(50 * time.Millisecond)
	m := cap.last()
	if m.Chunk != 2 || m.Total != 5 || m.Transport != "nostr" {
		t.Fatalf("unexpected: %+v", m)
	}
}
