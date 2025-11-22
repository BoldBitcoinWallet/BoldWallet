package nostrtransport

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
)

// Event is an alias to the nostr.Event type to avoid leaking the dependency everywhere.
type Event = nostr.Event

// Filter mirrors nostr.Filter for subscriptions.
type Filter = nostr.Filter

// Client represents a thin wrapper around the go-nostr SimplePool.
type Client struct {
	cfg    Config
	pool   *nostr.SimplePool
	urls   []string
	ctx    context.Context
	cancel context.CancelFunc
}

// Expose pool for querying existing events
func (c *Client) GetPool() *nostr.SimplePool {
	return c.pool
}

func NewClient(cfg Config) (*Client, error) {
	cfg.ApplyDefaults()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	pool := nostr.NewSimplePool(ctx)
	urls := make([]string, 0, len(cfg.Relays))
	for _, relayURL := range cfg.Relays {
		relayURL = strings.TrimSpace(relayURL)
		if relayURL == "" {
			continue
		}
		if !strings.HasPrefix(relayURL, "wss://") && !strings.HasPrefix(relayURL, "ws://") {
			cancel()
			return nil, fmt.Errorf("invalid relay url: %s", relayURL)
		}
		if _, err := pool.EnsureRelay(relayURL); err != nil {
			cancel()
			return nil, fmt.Errorf("ensure relay %s: %w", relayURL, err)
		}
		urls = append(urls, relayURL)
	}
	if len(urls) == 0 {
		cancel()
		return nil, errors.New("no valid relays configured")
	}
	return &Client{
		cfg:    cfg,
		pool:   pool,
		urls:   urls,
		ctx:    ctx,
		cancel: cancel,
	}, nil
}

// Close tears down relay connections.
func (c *Client) Close(reason string) {
	if c.pool != nil {
		c.pool.Close(reason)
	}
	if c.cancel != nil {
		c.cancel()
	}
}

func (c *Client) Publish(ctx context.Context, event *Event) error {
	if event == nil {
		return errors.New("nil event")
	}

	// Decode nsec from Bech32 to hex if needed
	nsecHex := c.cfg.LocalNsec
	if strings.HasPrefix(c.cfg.LocalNsec, "nsec1") {
		prefix, decoded, err := nip19.Decode(c.cfg.LocalNsec)
		if err != nil {
			return fmt.Errorf("decode nsec failed: %w", err)
		}
		if prefix != "nsec" {
			return fmt.Errorf("invalid prefix for nsec: %s", prefix)
		}
		skHexStr, ok := decoded.(string)
		if !ok {
			return fmt.Errorf("failed to decode nsec: invalid type")
		}
		nsecHex = skHexStr
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - event kind=%d, tags=%v, nsec prefix=%s, localNpub=%s\n", event.Kind, event.Tags, c.cfg.LocalNsec[:10]+"...", c.cfg.LocalNpub)

	// Convert npub to hex if needed (Nostr events use hex pubkeys, not Bech32)
	if event.PubKey == "" {
		localNpub := c.cfg.LocalNpub
		if strings.HasPrefix(localNpub, "npub1") {
			// Decode Bech32 npub to hex
			prefix, decoded, err := nip19.Decode(localNpub)
			if err != nil {
				return fmt.Errorf("decode npub failed: %w", err)
			}
			if prefix != "npub" {
				return fmt.Errorf("invalid prefix for npub: %s", prefix)
			}
			pkHexStr, ok := decoded.(string)
			if !ok {
				return fmt.Errorf("failed to decode npub: invalid type")
			}
			event.PubKey = pkHexStr
		} else {
			// Already hex
			event.PubKey = localNpub
		}
	} else if strings.HasPrefix(event.PubKey, "npub1") {
		// Event.PubKey was set to Bech32, convert to hex
		prefix, decoded, err := nip19.Decode(event.PubKey)
		if err != nil {
			return fmt.Errorf("decode event PubKey failed: %w", err)
		}
		if prefix != "npub" {
			return fmt.Errorf("invalid prefix for event PubKey: %s", prefix)
		}
		pkHexStr, ok := decoded.(string)
		if !ok {
			return fmt.Errorf("failed to decode event PubKey: invalid type")
		}
		event.PubKey = pkHexStr
	}

	if event.CreatedAt == 0 {
		event.CreatedAt = nostr.Now()
	}

	// Sign the event (this will also set PubKey from the private key if not already set)
	if err := event.Sign(nsecHex); err != nil {
		return fmt.Errorf("sign event failed: %w", err)
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - signed event, PubKey (hex)=%s, tags=%v\n", event.PubKey, event.Tags)

	results := c.pool.PublishMany(ctx, c.urls, *event)
	var firstErr error
	for {
		select {
		case <-ctx.Done():
			if firstErr == nil {
				firstErr = ctx.Err()
			}
			return firstErr
		case res, ok := <-results:
			if !ok {
				if firstErr == nil {
					fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - all relays responded\n")
				}
				return firstErr
			}
			if res.Error != nil {
				fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - relay %s error: %v\n", res.Relay, res.Error)
				if firstErr == nil {
					firstErr = res.Error
				}
			} else {
				fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - relay %s success\n", res.Relay)
			}
		}
	}
}

func (c *Client) Subscribe(ctx context.Context, filter Filter) (<-chan *Event, error) {
	if len(c.urls) == 0 {
		return nil, errors.New("no relays configured")
	}
	events := make(chan *Event)
	relayCh := c.pool.SubscribeMany(ctx, c.urls, filter)

	go func() {
		defer close(events)
		for {
			select {
			case <-ctx.Done():
				return
			case relayEvent, ok := <-relayCh:
				if !ok {
					return
				}
				if relayEvent.Event == nil {
					continue
				}
				select {
				case events <- relayEvent.Event:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return events, nil
}
