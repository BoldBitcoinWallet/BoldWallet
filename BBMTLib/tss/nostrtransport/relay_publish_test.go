package nostrtransport

import (
	"errors"
	"testing"
	"time"
)

func TestShouldBlockRelay(t *testing.T) {
	if !shouldBlockRelay(errors.New("msg: blocked")) {
		t.Fatal("expected blocked")
	}
	if shouldBlockRelay(errors.New("timeout")) {
		t.Fatal("expected not blocked")
	}
}

func TestRelaysForPublishBulkVsCritical(t *testing.T) {
	cfg := Config{
		Relays: []string{
			"wss://a.example",
			"wss://b.example",
			"wss://c.example",
			"wss://d.example",
		},
		SessionID:             "sess",
		SessionKeyHex:         "00",
		LocalNpub:             "npub1pr6n66nfdzsjqc4d9zkyv226jk26z6jlams2vpccvh5rmt5dwwaslqvve6",
		LocalNsec:             "nsec1test",
		PeersNpub:             []string{"npub1m6ehde59230exdcke7xea3cl8fllcfahu55q72g5zky7ac50qs9s5g4rqg"},
		FastPublishRelayCount: 2,
	}
	cfg.ApplyDefaults()

	c := &Client{
		cfg:         cfg,
		validRelays: cfg.Relays,
		relayHealth: newRelayHealth(),
	}
	c.relayHealth.blockRelay("wss://b.example")

	bulk := c.relaysForPublish(PublishModeBulk)
	if len(bulk) != 2 {
		t.Fatalf("bulk want 2 relays, got %v", bulk)
	}
	if bulk[0] != "wss://a.example" || bulk[1] != "wss://c.example" {
		t.Fatalf("bulk order unexpected: %v", bulk)
	}

	critical := c.relaysForPublish(PublishModeCritical)
	if len(critical) != 3 {
		t.Fatalf("critical want 3 relays, got %v", critical)
	}
}

func TestRelaysForPublishBulkRanksConnectedRtt(t *testing.T) {
	cfg := Config{
		Relays: []string{
			"wss://slow.example",
			"wss://fast.example",
			"wss://other.example",
		},
		SessionID:             "sess",
		SessionKeyHex:         "00",
		LocalNpub:             "npub1pr6n66nfdzsjqc4d9zkyv226jk26z6jlams2vpccvh5rmt5dwwaslqvve6",
		LocalNsec:             "nsec1test",
		PeersNpub:             []string{"npub1m6ehde59230exdcke7xea3cl8fllcfahu55q72g5zky7ac50qs9s5g4rqg"},
		FastPublishRelayCount: 2,
	}
	cfg.ApplyDefaults()

	c := &Client{
		cfg:         cfg,
		validRelays: cfg.Relays,
		relayHealth: newRelayHealth(),
	}
	c.relayHealth.markConnected("wss://fast.example")
	c.relayHealth.recordPublish("wss://fast.example", true, 40*time.Millisecond)
	c.relayHealth.markConnected("wss://slow.example")
	c.relayHealth.recordPublish("wss://slow.example", true, 800*time.Millisecond)

	bulk := c.relaysForPublish(PublishModeBulk)
	if len(bulk) != 2 {
		t.Fatalf("bulk want 2 relays, got %v", bulk)
	}
	if bulk[0] != "wss://fast.example" {
		t.Fatalf("expected fastest connected relay first, got %v", bulk)
	}
	if bulk[1] != "wss://slow.example" {
		t.Fatalf("expected other connected relay second, got %v", bulk)
	}
}

func TestRelaysForPublishBulkFillsUnconnected(t *testing.T) {
	cfg := Config{
		Relays: []string{
			"wss://a.example",
			"wss://b.example",
			"wss://c.example",
		},
		SessionID:             "sess",
		SessionKeyHex:         "00",
		LocalNpub:             "npub1pr6n66nfdzsjqc4d9zkyv226jk26z6jlams2vpccvh5rmt5dwwaslqvve6",
		LocalNsec:             "nsec1test",
		PeersNpub:             []string{"npub1m6ehde59230exdcke7xea3cl8fllcfahu55q72g5zky7ac50qs9s5g4rqg"},
		FastPublishRelayCount: 2,
	}
	cfg.ApplyDefaults()
	c := &Client{
		cfg:         cfg,
		validRelays: cfg.Relays,
		relayHealth: newRelayHealth(),
	}
	c.relayHealth.markConnected("wss://c.example")
	c.relayHealth.recordPublish("wss://c.example", true, 20*time.Millisecond)

	bulk := c.relaysForPublish(PublishModeBulk)
	if len(bulk) != 2 {
		t.Fatalf("bulk want 2, got %v", bulk)
	}
	if bulk[0] != "wss://c.example" {
		t.Fatalf("connected fast relay should be first, got %v", bulk)
	}
	if bulk[1] != "wss://a.example" {
		t.Fatalf("should fill from CSV order, got %v", bulk)
	}
}

func TestTruncateErrRedactsNsec(t *testing.T) {
	if truncateErr(errors.New("key nsec1abcxyz leaked")) != "redacted" {
		t.Fatal("expected nsec redaction")
	}
}

func TestBulkPublishTimeout(t *testing.T) {
	if bulkPublishTimeout < 3*time.Second || bulkPublishTimeout > 5*time.Second {
		t.Fatalf("bulk publish timeout should be 3-5s, got %s", bulkPublishTimeout)
	}
}
