package nostrtransport

import (
	"errors"
	"testing"
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
