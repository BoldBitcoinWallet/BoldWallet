package nostrtransport

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
)

const (
	eventKindReady    = 30301
	eventKindComplete = 30302
)

// SessionCoordinator orchestrates the ready/complete phases using Nostr events.
type SessionCoordinator struct {
	cfg    Config
	client *Client
}

func NewSessionCoordinator(cfg Config, client *Client) *SessionCoordinator {
	cfg.ApplyDefaults()
	return &SessionCoordinator{cfg: cfg, client: client}
}

func (s *SessionCoordinator) AwaitPeers(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, s.cfg.ConnectTimeout)
	defer cancel()

	expected := make(map[string]struct{}, len(s.cfg.PeersNpub))
	expectedHex := make(map[string]string) // Map hex pubkey -> bech32 npub for matching
	for _, npub := range s.cfg.PeersNpub {
		expected[npub] = struct{}{}
		// Convert Bech32 npub to hex for filter
		if strings.HasPrefix(npub, "npub1") {
			// Use nip19 to decode Bech32 npub to hex
			prefix, decoded, err := nip19.Decode(npub)
			if err == nil && prefix == "npub" {
				if pkHex, ok := decoded.(string); ok {
					expectedHex[pkHex] = npub
					npubShort := npub
					if len(npub) > 30 {
						npubShort = npub[:30]
					}
					hexShort := pkHex
					if len(pkHex) > 20 {
						hexShort = pkHex[:20] + "..."
					}
					fmt.Fprintf(os.Stderr, "BBMTLog: Successfully decoded npub %s -> hex %s\n", npubShort, hexShort)
				} else {
					fmt.Fprintf(os.Stderr, "BBMTLog: ERROR - decoded npub but result is not string: %T\n", decoded)
				}
			} else {
				// Decode failed - don't add to filter, log error with full npub (v2.0.0 strict validation)
				first50 := npub
				if len(npub) > 50 {
					first50 = npub[:50]
				}
				fmt.Fprintf(os.Stderr, "BBMTLog: ERROR - failed to decode npub (len=%d, first50=%s): %v, prefix=%s\n", len(npub), first50, err, prefix)
				// Don't add to expectedHex - we need valid hex for the filter
			}
		} else {
			// Already hex - validate it's actually hex (64 chars for secp256k1)
			if len(npub) == 64 {
				expectedHex[npub] = npub
			} else {
				first30 := npub
				if len(npub) > 30 {
					first30 = npub[:30]
				}
				fmt.Fprintf(os.Stderr, "BBMTLog: ERROR - npub is not Bech32 and not valid hex (len=%d): %s\n", len(npub), first30)
			}
		}
	}

	// Build hex pubkey list for filter (Nostr filters use hex, not Bech32)
	// v2.0.0 strict validation: only add valid hex (64 chars, not starting with "npub1")
	authorsHex := make([]string, 0, len(expectedHex))
	for hexPk, npub := range expectedHex {
		// Only add if it's actually hex (not a failed Bech32 decode that fell back to npub)
		if !strings.HasPrefix(hexPk, "npub1") && len(hexPk) == 64 {
			// Valid hex pubkey (64 chars for secp256k1)
			authorsHex = append(authorsHex, hexPk)
			npubShort := npub
			if len(npub) > 20 {
				npubShort = npub[:20] + "..."
			}
			hexShort := hexPk
			if len(hexPk) > 20 {
				hexShort = hexPk[:20] + "..."
			}
			fmt.Fprintf(os.Stderr, "BBMTLog: Converted npub %s -> hex %s\n", npubShort, hexShort)
		} else {
			fmt.Fprintf(os.Stderr, "BBMTLog: ERROR - Failed to convert npub %s to hex (got: %s), skipping from filter\n", npub, hexPk)
		}
	}

	if len(authorsHex) == 0 {
		return fmt.Errorf("no valid hex pubkeys found for filter (all npub decodes failed)")
	}

	seen := sync.Map{}

	// Query for events from the last 1 minute to catch events published before subscription
	sinceTime := nostr.Timestamp(time.Now().Add(-1 * time.Minute).Unix())
	filter := nostr.Filter{
		Kinds:   []int{eventKindReady},
		Authors: authorsHex, // Use hex pubkeys, not Bech32 npubs
		Tags: nostr.TagMap{
			"t": []string{s.cfg.SessionID},
		},
		Since: &sinceTime,
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: AwaitPeers - SessionID: %s, LocalNpub: %s, Expected peers (npub): %v, Authors (hex): %v\n", s.cfg.SessionID, s.cfg.LocalNpub, s.cfg.PeersNpub, authorsHex)

	// First, query for existing events BEFORE starting subscription
	// This ensures we catch events that were published before we started listening
	fmt.Fprintf(os.Stderr, "BBMTLog: Querying for existing ready events for session %s (from last 1 minute)\n", s.cfg.SessionID)
	queryCtx, queryCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer queryCancel()

	// Query all relays in parallel and wait for results
	queryDone := make(chan bool, 1)
	go func() {
		defer func() { queryDone <- true }()
		for _, url := range s.client.urls {
			relay, err := s.client.GetPool().EnsureRelay(url)
			if err != nil {
				fmt.Fprintf(os.Stderr, "BBMTLog: Failed to ensure relay %s: %v\n", url, err)
				continue
			}
			existingEvents, err := relay.QuerySync(queryCtx, filter)
			if err == nil {
				fmt.Fprintf(os.Stderr, "BBMTLog: Query on relay %s returned %d events for session %s\n", url, len(existingEvents), s.cfg.SessionID)
				if len(existingEvents) == 0 {
					fmt.Fprintf(os.Stderr, "BBMTLog: No events found on relay %s - filter: kind=%d, authors=%v, tag t=%s\n", url, eventKindReady, authorsHex, s.cfg.SessionID)
				}
				for _, evt := range existingEvents {
					if evt != nil && evt.PubKey != "" {
						// Event.PubKey is hex, convert to npub for matching
						evtPubKeyHex := evt.PubKey
						evtNpub, exists := expectedHex[evtPubKeyHex]
						if !exists {
							evtNpub = evtPubKeyHex
						}
						fmt.Fprintf(os.Stderr, "BBMTLog: Found existing ready event from %s (hex: %s)\n", evtNpub, evtPubKeyHex)
						seen.Store(evtNpub, true)
					}
				}
			} else {
				fmt.Fprintf(os.Stderr, "BBMTLog: Query on relay %s failed (non-fatal): %v\n", url, err)
			}
		}
	}()

	// Wait for initial query to complete (with timeout) before starting subscription
	// This ensures we don't miss events published just before we subscribe
	select {
	case <-queryDone:
		fmt.Fprintf(os.Stderr, "BBMTLog: Initial query completed, found %d peers\n", s.countSeen(&seen))
	case <-time.After(8 * time.Second):
		fmt.Fprintf(os.Stderr, "BBMTLog: Initial query timeout, proceeding with subscription (found %d peers so far)\n", s.countSeen(&seen))
	}

	// Now start subscription to catch new events
	fmt.Fprintf(os.Stderr, "BBMTLog: Starting subscription for ready events for session %s\n", s.cfg.SessionID)
	eventsCh, err := s.client.Subscribe(ctx, filter)
	if err != nil {
		return fmt.Errorf("subscribe to ready events: %w", err)
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	fmt.Fprintf(os.Stderr, "BBMTLog: Awaiting %d peers for session %s (already seen: %d)\n", len(expected), s.cfg.SessionID, s.countSeen(&seen))
	for {
		select {
		case <-ctx.Done():
			fmt.Fprintf(os.Stderr, "BBMTLog: AwaitPeers timed out (seen: %d/%d)\n", s.countSeen(&seen), len(expected))
			return fmt.Errorf("waiting for peers timed out: %w", ctx.Err())
		case evt, ok := <-eventsCh:
			if !ok {
				return fmt.Errorf("relay subscription closed")
			}
			if evt == nil {
				continue
			}
			// Event.PubKey is hex, convert to npub for matching
			evtPubKeyHex := evt.PubKey
			evtNpub, exists := expectedHex[evtPubKeyHex]
			if !exists {
				// Try to match directly if it's already Bech32 (shouldn't happen but be safe)
				evtNpub = evtPubKeyHex
			}
			fmt.Fprintf(os.Stderr, "BBMTLog: Received ready event from %s (hex: %s)\n", evtNpub, evtPubKeyHex)
			seen.Store(evtNpub, true)
			if s.allPeersSeen(&seen, expected) {
				fmt.Fprintf(os.Stderr, "BBMTLog: All peers ready!\n")
				return nil
			}
		case <-ticker.C:
			if s.allPeersSeen(&seen, expected) {
				fmt.Fprintf(os.Stderr, "BBMTLog: All peers ready (ticker check)!\n")
				return nil
			}
			fmt.Fprintf(os.Stderr, "BBMTLog: Still waiting... (seen: %d/%d)\n", s.countSeen(&seen), len(expected))
		}
	}
}

func (s *SessionCoordinator) countSeen(seen *sync.Map) int {
	count := 0
	seen.Range(func(key, value interface{}) bool {
		count++
		return true
	})
	return count
}

func (s *SessionCoordinator) allPeersSeen(seen *sync.Map, expected map[string]struct{}) bool {
	for npub := range expected {
		if _, ok := seen.Load(npub); !ok {
			return false
		}
	}
	return true
}

func (s *SessionCoordinator) PublishReady(ctx context.Context) error {
	event := &nostr.Event{
		Kind:      eventKindReady,
		CreatedAt: nostr.Now(),
		Tags: nostr.Tags{
			nostr.Tag{"t", s.cfg.SessionID},
			nostr.Tag{"phase", "ready"},
		},
		Content: "ready",
	}
	fmt.Fprintf(os.Stderr, "BBMTLog: Publishing ready event for session %s, npub %s, expecting peers: %v\n", s.cfg.SessionID, s.cfg.LocalNpub, s.cfg.PeersNpub)
	err := s.client.Publish(ctx, event)
	if err != nil {
		fmt.Fprintf(os.Stderr, "BBMTLog: Error publishing ready event: %v\n", err)
		return err
	}
	fmt.Fprintf(os.Stderr, "BBMTLog: Ready event published successfully with tag t=%s\n", s.cfg.SessionID)

	// Small delay to ensure event propagates to relays before peers start looking
	time.Sleep(500 * time.Millisecond)

	return nil
}

func (s *SessionCoordinator) PublishComplete(ctx context.Context, phase string) error {
	event := &nostr.Event{
		Kind:      eventKindComplete,
		CreatedAt: nostr.Now(),
		Tags: nostr.Tags{
			nostr.Tag{"t", s.cfg.SessionID},
			nostr.Tag{"phase", phase},
		},
		Content: "complete",
	}
	return s.client.Publish(ctx, event)
}
