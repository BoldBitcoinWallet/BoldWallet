package nostrtransport

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
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

	// Convert local npub to hex for the "p" tag filter (gift wraps are addressed to us)
	localNpubHex, err := npubToHex(s.cfg.LocalNpub)
	if err != nil {
		return fmt.Errorf("convert local npub to hex: %w", err)
	}

	// Query for gift wrap events (kind:1059) from the last 1 minute to catch events published before subscription
	sinceTime := nostr.Timestamp(time.Now().Add(-1 * time.Minute).Unix())
	filter := nostr.Filter{
		Kinds: []int{1059}, // NIP-59 gift wrap kind
		Tags: nostr.TagMap{
			"t": []string{s.cfg.SessionID},
			"p": []string{localNpubHex}, // Recipient tag (we're the recipient)
		},
		Since: &sinceTime,
		// Note: We can't filter by author for gift wraps since they're signed with random keys
		// We'll verify the sender after unwrapping
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: AwaitPeers - SessionID: %s, LocalNpub: %s (hex: %s), Expected peers (npub): %v\n", s.cfg.SessionID, s.cfg.LocalNpub, localNpubHex, s.cfg.PeersNpub)

	// First, query for existing events BEFORE starting subscription
	// This ensures we catch events that were published before we started listening
	fmt.Fprintf(os.Stderr, "BBMTLog: Querying for existing ready wraps for session %s (from last 1 minute)\n", s.cfg.SessionID)
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
				fmt.Fprintf(os.Stderr, "BBMTLog: Query on relay %s returned %d wrap events for session %s\n", url, len(existingEvents), s.cfg.SessionID)
				for _, wrapEvent := range existingEvents {
					if wrapEvent == nil || wrapEvent.Kind != 1059 {
						continue
					}
					// Unwrap and unseal to get sender
					seal, err := unwrapGift(wrapEvent, s.cfg.LocalNsec)
					if err != nil {
						fmt.Fprintf(os.Stderr, "BBMTLog: Failed to unwrap gift from query: %v\n", err)
						continue
					}
					// Verify seal is from an expected peer
					sealSenderHex := seal.PubKey
					sealSenderNpub := ""
					for hex, npub := range expectedHex {
						if hex == sealSenderHex {
							sealSenderNpub = npub
							break
						}
					}
					if sealSenderNpub == "" {
						fmt.Fprintf(os.Stderr, "BBMTLog: Seal from unexpected sender (hex: %s)\n", sealSenderHex)
						continue
					}
					// Unseal to verify it's a ready message
					sealSenderNpubBech32 := sealSenderNpub
					for _, npub := range s.cfg.PeersNpub {
						npubHex, err := npubToHex(npub)
						if err == nil && npubHex == sealSenderHex {
							sealSenderNpubBech32 = npub
							break
						}
					}
					rumor, err := unseal(seal, s.cfg.LocalNsec, sealSenderNpubBech32)
					if err != nil {
						fmt.Fprintf(os.Stderr, "BBMTLog: Failed to unseal from query: %v\n", err)
						continue
					}
					// Parse rumor content to verify it's a ready message
					var readyMsg map[string]interface{}
					if err := json.Unmarshal([]byte(rumor.Content), &readyMsg); err != nil {
						continue
					}
					if phase, ok := readyMsg["phase"].(string); ok && phase == "ready" {
						fmt.Fprintf(os.Stderr, "BBMTLog: Found existing ready wrap from %s (hex: %s)\n", sealSenderNpub, sealSenderHex)
						seen.Store(sealSenderNpub, true)
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
	fmt.Fprintf(os.Stderr, "BBMTLog: Starting subscription for ready wraps for session %s\n", s.cfg.SessionID)
	eventsCh, err := s.client.Subscribe(ctx, filter)
	if err != nil {
		return fmt.Errorf("subscribe to ready wraps: %w", err)
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
			if evt == nil || evt.Kind != 1059 {
				continue
			}
			// Unwrap the gift wrap to get the seal
			seal, err := unwrapGift(evt, s.cfg.LocalNsec)
			if err != nil {
				fmt.Fprintf(os.Stderr, "BBMTLog: Failed to unwrap gift: %v\n", err)
				continue
			}
			// Verify seal is from an expected peer
			sealSenderHex := seal.PubKey
			sealSenderNpub := ""
			for hex, npub := range expectedHex {
				if hex == sealSenderHex {
					sealSenderNpub = npub
					break
				}
			}
			if sealSenderNpub == "" {
				fmt.Fprintf(os.Stderr, "BBMTLog: Seal from unexpected sender (hex: %s)\n", sealSenderHex)
				continue
			}
			// Unseal to get the rumor
			sealSenderNpubBech32 := sealSenderNpub
			for _, npub := range s.cfg.PeersNpub {
				npubHex, err := npubToHex(npub)
				if err == nil && npubHex == sealSenderHex {
					sealSenderNpubBech32 = npub
					break
				}
			}
			rumor, err := unseal(seal, s.cfg.LocalNsec, sealSenderNpubBech32)
			if err != nil {
				fmt.Fprintf(os.Stderr, "BBMTLog: Failed to unseal: %v\n", err)
				continue
			}
			// Parse rumor content to verify it's a ready message
			var readyMsg map[string]interface{}
			if err := json.Unmarshal([]byte(rumor.Content), &readyMsg); err != nil {
				fmt.Fprintf(os.Stderr, "BBMTLog: Failed to parse ready message: %v\n", err)
				continue
			}
			if phase, ok := readyMsg["phase"].(string); ok && phase == "ready" {
				fmt.Fprintf(os.Stderr, "BBMTLog: Received ready wrap from %s (hex: %s)\n", sealSenderNpub, sealSenderHex)
				seen.Store(sealSenderNpub, true)
				if s.allPeersSeen(&seen, expected) {
					fmt.Fprintf(os.Stderr, "BBMTLog: All peers ready!\n")
					return nil
				}
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
	// Convert sender npub to hex for rumor
	senderNpubHex, err := npubToHex(s.cfg.LocalNpub)
	if err != nil {
		return fmt.Errorf("convert sender npub: %w", err)
	}

	// Create ready message content
	readyMessage := map[string]interface{}{
		"session_id": s.cfg.SessionID,
		"phase":      "ready",
		"content":    "ready",
	}
	readyJSON, err := json.Marshal(readyMessage)
	if err != nil {
		return fmt.Errorf("marshal ready message: %w", err)
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: Publishing ready event for session %s, npub %s, expecting peers: %v\n", s.cfg.SessionID, s.cfg.LocalNpub, s.cfg.PeersNpub)

	// Publish encrypted wrap to each peer using rumor/wrap/seal pattern
	for _, peerNpub := range s.cfg.PeersNpub {
		// Step 1: Create rumor (kind:14) - unsigned event
		rumor := createRumor(string(readyJSON), senderNpubHex)

		// Step 2: Create seal (kind:13) - encrypt rumor with NIP-44
		seal, err := createSeal(rumor, s.cfg.LocalNsec, peerNpub)
		if err != nil {
			return fmt.Errorf("create seal for peer %s: %w", peerNpub, err)
		}

		// Step 3: Create wrap (kind:1059) - wrap seal in gift wrap
		// Include session tag for filtering (must be added before signing)
		wrap, err := createWrap(seal, peerNpub, s.cfg.SessionID, "")
		if err != nil {
			return fmt.Errorf("create wrap for peer %s: %w", peerNpub, err)
		}

		fmt.Fprintf(os.Stderr, "BBMTLog: Publishing ready wrap to peer %s\n", peerNpub)

		// Publish the wrap (kind:1059)
		err = s.client.PublishWrap(ctx, wrap)
		if err != nil {
			return fmt.Errorf("publish ready wrap to peer %s: %w", peerNpub, err)
		}
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: Ready event published successfully to all peers with tag t=%s\n", s.cfg.SessionID)

	// Small delay to ensure event propagates to relays before peers start looking
	time.Sleep(500 * time.Millisecond)

	return nil
}

func (s *SessionCoordinator) PublishComplete(ctx context.Context, phase string) error {
	// Convert sender npub to hex for rumor
	senderNpubHex, err := npubToHex(s.cfg.LocalNpub)
	if err != nil {
		return fmt.Errorf("convert sender npub: %w", err)
	}

	// Create complete message content
	completeMessage := map[string]interface{}{
		"session_id": s.cfg.SessionID,
		"phase":      phase,
		"content":    "complete",
	}
	completeJSON, err := json.Marshal(completeMessage)
	if err != nil {
		return fmt.Errorf("marshal complete message: %w", err)
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: Publishing complete event for session %s, phase %s, npub %s, expecting peers: %v\n", s.cfg.SessionID, phase, s.cfg.LocalNpub, s.cfg.PeersNpub)

	// Publish encrypted wrap to each peer using rumor/wrap/seal pattern
	for _, peerNpub := range s.cfg.PeersNpub {
		// Step 1: Create rumor (kind:14) - unsigned event
		rumor := createRumor(string(completeJSON), senderNpubHex)

		// Step 2: Create seal (kind:13) - encrypt rumor with NIP-44
		seal, err := createSeal(rumor, s.cfg.LocalNsec, peerNpub)
		if err != nil {
			return fmt.Errorf("create complete seal for peer %s: %w", peerNpub, err)
		}

		// Step 3: Create wrap (kind:1059) - wrap seal in gift wrap
		// Include session tag for filtering (must be added before signing)
		wrap, err := createWrap(seal, peerNpub, s.cfg.SessionID, "")
		if err != nil {
			return fmt.Errorf("create complete wrap for peer %s: %w", peerNpub, err)
		}

		fmt.Fprintf(os.Stderr, "BBMTLog: Publishing complete wrap (phase=%s) to peer %s\n", phase, peerNpub)

		// Publish the wrap (kind:1059)
		err = s.client.PublishWrap(ctx, wrap)
		if err != nil {
			return fmt.Errorf("publish complete wrap to peer %s: %w", peerNpub, err)
		}
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: Complete event (phase=%s) published successfully to all peers with tag t=%s\n", phase, s.cfg.SessionID)

	return nil
}
