package nostrtransport

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
)

// MessagePump subscribes to relay events and feeds decrypted payloads to the TSS service.
const maxSeenWrapEventIDs = 10000

type MessagePump struct {
	cfg            Config
	client         *Client
	assembler      *ChunkAssembler
	processed      map[string]bool
	processedMu    sync.Mutex
	seenWrapIDs    map[string]struct{}
	seenWrapIDsMu  sync.Mutex
}

func NewMessagePump(cfg Config, client *Client) (result *MessagePump) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in NewMessagePump: %v", r)
			fmt.Fprintf(os.Stderr, "BBMTLog: %s\n", errMsg)
			fmt.Fprintf(os.Stderr, "BBMTLog: Stack trace: %s\n", string(debug.Stack()))
			result = nil
		}
	}()

	cfg.ApplyDefaults()
	return &MessagePump{
		cfg:         cfg,
		client:      client,
		assembler:   NewChunkAssembler(cfg.ChunkTTL),
		processed:   make(map[string]bool),
		seenWrapIDs: make(map[string]struct{}),
	}
}

func (p *MessagePump) Run(ctx context.Context, handler func([]byte) error) error {
	return p.runInternal(ctx, handler, true)
}

// RunSubscribeOnly listens for new events only (no relay history query).
// Use for attempt-id handshakes where stale cached events must be ignored.
func (p *MessagePump) RunSubscribeOnly(ctx context.Context, handler func([]byte) error) error {
	return p.runInternal(ctx, handler, false)
}

func (p *MessagePump) runInternal(ctx context.Context, handler func([]byte) error, queryHistorical bool) (err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in MessagePump.Run: %v", r)
			fmt.Fprintf(os.Stderr, "BBMTLog: %s\n", errMsg)
			fmt.Fprintf(os.Stderr, "BBMTLog: Stack trace: %s\n", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
		}
	}()

	// Convert local npub to hex for comparison (event.PubKey is hex)
	localNpubHex := p.cfg.LocalNpub
	if strings.HasPrefix(p.cfg.LocalNpub, "npub1") {
		prefix, decoded, err := nip19.Decode(p.cfg.LocalNpub)
		if err == nil && prefix == "npub" {
			if pkHex, ok := decoded.(string); ok {
				localNpubHex = pkHex
			}
		}
	}

	// Convert peer npubs to hex for author filter (only receive from expected peers)
	authorsHex := make([]string, 0, len(p.cfg.PeersNpub))
	for _, npub := range p.cfg.PeersNpub {
		if strings.HasPrefix(npub, "npub1") {
			prefix, decoded, err := nip19.Decode(npub)
			if err == nil && prefix == "npub" {
				if pkHex, ok := decoded.(string); ok {
					authorsHex = append(authorsHex, pkHex)
				}
			}
		} else if len(npub) == 64 {
			// Already hex
			authorsHex = append(authorsHex, npub)
		}
	}

	// Subscribe to gift wrap events (kind:1059) with session tag and recipient tag
	// Convert local npub to hex for the "p" tag filter (since we publish with hex format)
	localNpubHexForFilter := localNpubHex

	// Query for events from the last 2 minutes to catch messages published before subscription
	// This ensures we don't miss messages sent just before we started listening
	sinceTime := nostr.Timestamp(time.Now().Add(-1 * time.Minute).Unix())
	filter := Filter{
		Tags: nostr.TagMap{
			"t": []string{p.cfg.SessionID},
			"p": []string{localNpubHexForFilter}, // Use hex format to match what we publish
		},
		Kinds: []int{1059}, // NIP-59 gift wrap kind
		Since: &sinceTime,  // Query retroactive messages from last 2 minutes
		// Note: We can't filter by author for gift wraps since they're signed with random keys
		// We'll verify the sender after unwrapping
	}

	cleanupTicker := time.NewTicker(30 * time.Second)
	defer cleanupTicker.Stop()

	// retryDelay implements exponential backoff for subscription failures:
	// first retry is immediate (0s), then 500 ms, then capped at 1 s.
	retryDelay := time.Duration(0)

	// Helper function to process an event (unwrap, verify, and call handler)
	processEvent := func(event *nostr.Event) (err error) {
		defer func() {
			if r := recover(); r != nil {
				errMsg := fmt.Sprintf("PANIC in MessagePump.processEvent: %v", r)
				fmt.Fprintf(os.Stderr, "BBMTLog: %s\n", errMsg)
				fmt.Fprintf(os.Stderr, "BBMTLog: Stack trace: %s\n", string(debug.Stack()))
				err = fmt.Errorf("internal error (panic): %v", r)
			}
		}()

		if event == nil {
			return nil
		}

		if event.ID != "" {
			p.seenWrapIDsMu.Lock()
			if _, dup := p.seenWrapIDs[event.ID]; dup {
				p.seenWrapIDsMu.Unlock()
				return nil
			}
			p.seenWrapIDs[event.ID] = struct{}{}
			if len(p.seenWrapIDs) > maxSeenWrapEventIDs {
				p.seenWrapIDs = make(map[string]struct{})
			}
			p.seenWrapIDsMu.Unlock()
		}

		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump received event from %s (hex), kind=%d, content_len=%d, tags_count=%d\n", event.PubKey, event.Kind, len(event.Content), len(event.Tags))

		// Verify it's a gift wrap (kind:1059)
		if event.Kind != 1059 {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump skipping non-wrap event (kind=%d)\n", event.Kind)
			return nil
		}

		// Step 1: Unwrap the gift wrap to get the seal
		seal, err := unwrapGift(event, p.cfg.LocalNsec)
		if err != nil {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to unwrap gift: %v\n", err)
			return nil
		}
		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump unwrapped gift, got seal from %s\n", seal.PubKey)

		// Verify seal is from an expected peer
		sealSenderNpub := seal.PubKey
		isFromExpectedPeer := false
		for _, expectedNpub := range p.cfg.PeersNpub {
			expectedHex, err := npubToHex(expectedNpub)
			if err != nil {
				continue
			}
			if sealSenderNpub == expectedHex {
				isFromExpectedPeer = true
				break
			}
		}
		if !isFromExpectedPeer {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump seal from unexpected sender (hex: %s)\n", sealSenderNpub)
			return nil
		}

		// Step 2: Unseal to get the rumor
		// Convert seal sender npub to bech32 format for unseal (it expects npub format)
		sealSenderNpubBech32 := sealSenderNpub
		for _, npub := range p.cfg.PeersNpub {
			npubHex, err := npubToHex(npub)
			if err == nil && npubHex == sealSenderNpub {
				sealSenderNpubBech32 = npub
				break
			}
		}

		rumor, err := unseal(seal, p.cfg.LocalNsec, sealSenderNpubBech32)
		if err != nil {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to unseal: %v\n", err)
			return nil
		}
		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump unsealed, got rumor\n")

		// Step 3: Extract chunk data from rumor
		var chunkMessage map[string]interface{}
		if err := json.Unmarshal([]byte(rumor.Content), &chunkMessage); err != nil {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to parse rumor content: %v\n", err)
			return nil
		}

		sessionIDValue, ok := chunkMessage["session_id"].(string)
		if !ok {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump rumor missing session_id\n")
			return nil
		}
		if sessionIDValue != p.cfg.SessionID {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump session mismatch (got %s, expected %s)\n", sessionIDValue, p.cfg.SessionID)
			return nil
		}

		// Check if this is a ready/complete message (handled by SessionCoordinator, not MessagePump)
		if _, ok := chunkMessage["phase"].(string); ok {
			// This is a ready/complete message, skip it (handled by SessionCoordinator)
			return nil
		}

		// Extract chunk metadata
		chunkTagValue, ok := chunkMessage["chunk"].(string)
		if !ok {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump rumor missing chunk metadata\n")
			return nil
		}

		meta, err := ParseChunkTag(chunkTagValue)
		if err != nil {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to parse chunk tag '%s': %v\n", chunkTagValue, err)
			return nil
		}
		meta.SessionID = p.cfg.SessionID
		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump parsed chunk metadata: hash=%s, index=%d/%d\n", meta.Hash, meta.Index, meta.Total)

		// Extract chunk data
		chunkDataB64, ok := chunkMessage["data"].(string)
		if !ok {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump rumor missing chunk data\n")
			return nil
		}

		chunkData, err := base64.StdEncoding.DecodeString(chunkDataB64)
		if err != nil {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to decode chunk data: %v\n", err)
			return nil
		}
		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump decoded chunk data: %d bytes\n", len(chunkData))

		// Add chunk to assembler.  The assembler is mutex-protected and
		// idempotent for duplicate chunk indices, so concurrent goroutines
		// (e.g. the parallel initial-query goroutines) can safely call Add
		// simultaneously for the same message.
		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump adding chunk %d/%d to assembler\n", meta.Index+1, meta.Total)
		reassembled, complete := p.assembler.Add(meta, chunkData)
		if !complete {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump chunk %d/%d added, waiting for more chunks\n", meta.Index+1, meta.Total)
			return nil
		}
		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump all chunks received, reassembled %d bytes\n", len(reassembled))

		hashBytes := sha256.Sum256(reassembled)
		calculatedHash := hex.EncodeToString(hashBytes[:])
		if !strings.EqualFold(calculatedHash, meta.Hash) {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump chunk hash mismatch (calc=%s, expected=%s)\n", calculatedHash, meta.Hash)
			return nil
		}

		plaintext := reassembled

		// Atomically claim this message.  When the same event arrives from
		// multiple relays simultaneously (parallel initial-query goroutines),
		// both goroutines complete assembly independently.  The lock+check
		// here ensures the TSS handler is called exactly once per message.
		p.processedMu.Lock()
		if p.processed[meta.Hash] {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump message %s already dispatched by concurrent goroutine, skipping\n", meta.Hash)
			p.processedMu.Unlock()
			return nil
		}
		p.processed[meta.Hash] = true
		p.processedMu.Unlock()

		// Exactly one goroutine per message hash reaches this point.
		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump calling handler with %d bytes\n", len(plaintext))
		if err := handler(plaintext); err != nil {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump handler error: %v\n", err)
			return fmt.Errorf("handler error: %w", err)
		}
		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump handler completed successfully\n")
		return nil
	}

	// First, query for existing events BEFORE starting subscription (optional).
	// Attempt-id handshakes skip this to avoid picking stale messages on retry.
	if queryHistorical {
		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump querying for existing events for session %s (from last 1 minute)\n", p.cfg.SessionID)
		queryCtx, queryCancel := context.WithTimeout(ctx, 3*time.Second)
		defer queryCancel()

		// Use all valid relays, not just initially connected ones
		relaysToQuery := p.client.validRelays
		if len(relaysToQuery) == 0 {
			relaysToQuery = p.client.urls
		}

		queryDone := make(chan bool, 1)
		go func() {
			defer func() {
				if r := recover(); r != nil {
					errMsg := fmt.Sprintf("PANIC in MessagePump.Run query goroutine: %v", r)
					fmt.Fprintf(os.Stderr, "BBMTLog: %s\n", errMsg)
					fmt.Fprintf(os.Stderr, "BBMTLog: Stack trace: %s\n", string(debug.Stack()))
				}
				queryDone <- true
			}()
			// Query all relays in parallel
			for _, url := range relaysToQuery {
				go func(relayURL string) {
					defer func() {
						if r := recover(); r != nil {
							errMsg := fmt.Sprintf("PANIC in MessagePump.Run relay query goroutine: %v", r)
							fmt.Fprintf(os.Stderr, "BBMTLog: %s\n", errMsg)
							fmt.Fprintf(os.Stderr, "BBMTLog: Stack trace: %s\n", string(debug.Stack()))
						}
					}()
					relay, err := p.client.GetPool().EnsureRelay(relayURL)
					if err != nil {
						fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to ensure relay %s for query: %v\n", relayURL, err)
						return
					}
					existingEvents, err := relay.QuerySync(queryCtx, filter)
					if err == nil {
						fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump query on relay %s returned %d events for session %s\n", relayURL, len(existingEvents), p.cfg.SessionID)
						for _, event := range existingEvents {
							if event != nil {
								// Process the event (this will call handler if it's a valid message)
								processEvent(event)
							}
						}
					} else {
						fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump query on relay %s failed (non-fatal): %v\n", relayURL, err)
					}
				}(url)
			}
			// Give queries time to complete
			time.Sleep(2 * time.Second)
		}()

		// Wait for initial query to complete (with timeout) before starting subscription
		select {
		case <-queryDone:
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump initial query completed\n")
		case <-time.After(3 * time.Second):
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump initial query timeout, proceeding with subscription\n")
		}
	}

	// Retry loop: resubscribe when channel closes (e.g., network disconnection).
	// Uses exponential backoff: first retry is immediate, then 500 ms, capped at 1 s.
	for {
		// Check if context is cancelled before attempting subscription.
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump subscribing to session %s, local npub %s (hex: %s), expecting authors (hex): %v\n", p.cfg.SessionID, p.cfg.LocalNpub, localNpubHex, authorsHex)
		events, err := p.client.Subscribe(ctx, filter)
		if err != nil {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to subscribe: %v, retrying in %v...\n", err, retryDelay)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(retryDelay):
			}
			if retryDelay == 0 {
				retryDelay = 500 * time.Millisecond
			} else if retryDelay < time.Second {
				retryDelay = time.Second
			}
			continue
		}
		// Successful subscription — reset backoff.
		retryDelay = 0
		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump subscription active\n")

		// Process events from this subscription until channel closes.
		subscriptionActive := true
		for subscriptionActive {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-cleanupTicker.C:
				p.assembler.Cleanup()
			case event, ok := <-events:
				if !ok {
					// Channel closed — relay disconnected; resubscribe with backoff.
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump event channel closed (network may have disconnected), retrying in %v...\n", retryDelay)
					subscriptionActive = false
					select {
					case <-ctx.Done():
						return ctx.Err()
					case <-time.After(retryDelay):
					}
					if retryDelay == 0 {
						retryDelay = 500 * time.Millisecond
					} else if retryDelay < time.Second {
						retryDelay = time.Second
					}
					break
				}
				if event != nil {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump received event from subscription channel: kind=%d, pubkey=%s, content_len=%d\n", event.Kind, event.PubKey, len(event.Content))
				} else {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump received nil event from subscription channel\n")
					continue
				}
				if err := processEvent(event); err != nil {
					return err
				}
			}
		}
		// Inner loop exited — outer loop will resubscribe.
	}
}
