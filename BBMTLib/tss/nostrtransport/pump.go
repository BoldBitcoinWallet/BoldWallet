package nostrtransport

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
)

// MessagePump subscribes to relay events and feeds decrypted payloads to the TSS service.
type MessagePump struct {
	cfg         Config
	client      *Client
	assembler   *ChunkAssembler
	processed   map[string]bool
	processedMu sync.Mutex
}

func NewMessagePump(cfg Config, client *Client) *MessagePump {
	cfg.ApplyDefaults()
	return &MessagePump{
		cfg:       cfg,
		client:    client,
		assembler: NewChunkAssembler(cfg.ChunkTTL),
		processed: make(map[string]bool),
	}
}

func (p *MessagePump) Run(ctx context.Context, handler func([]byte) error) error {
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

	retryTicker := time.NewTicker(1 * time.Second)
	defer retryTicker.Stop()

	// Retry loop: resubscribe when channel closes (e.g., network disconnection)
	for {
		// Check if context is cancelled before attempting subscription
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump subscribing to session %s, local npub %s (hex: %s), expecting authors (hex): %v\n", p.cfg.SessionID, p.cfg.LocalNpub, localNpubHex, authorsHex)
		events, err := p.client.Subscribe(ctx, filter)
		if err != nil {
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to subscribe: %v, retrying in 1 second...\n", err)
			// Wait for retry ticker or context cancellation
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-retryTicker.C:
				continue // Retry subscription
			}
		}
		fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump subscription active\n")

		// Process events from this subscription until channel closes
		subscriptionActive := true
		for subscriptionActive {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-cleanupTicker.C:
				p.assembler.Cleanup()
			case event, ok := <-events:
				if !ok {
					// Channel closed (e.g., network disconnection) - retry subscription
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump event channel closed (network may have disconnected), retrying subscription in 1 second...\n")
					subscriptionActive = false
					// Wait before retrying
					select {
					case <-ctx.Done():
						return ctx.Err()
					case <-retryTicker.C:
						// Continue to outer loop to resubscribe
					}
					break
				}
				if event == nil {
					continue
				}

				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump received event from %s (hex), kind=%d, content_len=%d, tags_count=%d\n", event.PubKey, event.Kind, len(event.Content), len(event.Tags))

				// Verify it's a gift wrap (kind:1059)
				if event.Kind != 1059 {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump skipping non-wrap event (kind=%d)\n", event.Kind)
					continue
				}

				// Step 1: Unwrap the gift wrap to get the seal
				seal, err := unwrapGift(event, p.cfg.LocalNsec)
				if err != nil {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to unwrap gift: %v\n", err)
					continue
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
					continue
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
					continue
				}
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump unsealed, got rumor\n")

				// Step 3: Extract chunk data from rumor
				var chunkMessage map[string]interface{}
				if err := json.Unmarshal([]byte(rumor.Content), &chunkMessage); err != nil {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to parse rumor content: %v\n", err)
					continue
				}

				sessionIDValue, ok := chunkMessage["session_id"].(string)
				if !ok {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump rumor missing session_id\n")
					continue
				}
				if sessionIDValue != p.cfg.SessionID {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump session mismatch (got %s, expected %s)\n", sessionIDValue, p.cfg.SessionID)
					continue
				}

				// Check if this is a ready/complete message (handled by SessionCoordinator, not MessagePump)
				if _, ok := chunkMessage["phase"].(string); ok {
					// This is a ready/complete message, skip it (handled by SessionCoordinator)
					continue
				}

				// Extract chunk metadata
				chunkTagValue, ok := chunkMessage["chunk"].(string)
				if !ok {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump rumor missing chunk metadata\n")
					continue
				}

				meta, err := ParseChunkTag(chunkTagValue)
				if err != nil {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to parse chunk tag '%s': %v\n", chunkTagValue, err)
					continue
				}
				meta.SessionID = p.cfg.SessionID
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump parsed chunk metadata: hash=%s, index=%d/%d\n", meta.Hash, meta.Index, meta.Total)

				// Extract chunk data
				chunkDataB64, ok := chunkMessage["data"].(string)
				if !ok {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump rumor missing chunk data\n")
					continue
				}

				chunkData, err := base64.StdEncoding.DecodeString(chunkDataB64)
				if err != nil {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to decode chunk data: %v\n", err)
					continue
				}
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump decoded chunk data: %d bytes\n", len(chunkData))

				// Check if already processed
				p.processedMu.Lock()
				if p.processed[meta.Hash] {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump message %s already processed, skipping\n", meta.Hash)
					p.processedMu.Unlock()
					continue
				}
				p.processedMu.Unlock()

				// Add chunk to assembler
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump adding chunk %d/%d to assembler\n", meta.Index+1, meta.Total)
				reassembled, complete := p.assembler.Add(meta, chunkData)
				if !complete {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump chunk %d/%d added, waiting for more chunks\n", meta.Index+1, meta.Total)
					continue
				}
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump all chunks received, reassembled %d bytes\n", len(reassembled))

				hashBytes := sha256.Sum256(reassembled)
				calculatedHash := hex.EncodeToString(hashBytes[:])
				if !strings.EqualFold(calculatedHash, meta.Hash) {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump chunk hash mismatch (calc=%s, expected=%s)\n", calculatedHash, meta.Hash)
					continue
				}

				// Reassemble the full message from chunks (chunks are plaintext now, not encrypted)
				// The reassembled data is the full message body
				plaintext := reassembled

				// Mark as processed
				p.processedMu.Lock()
				p.processed[meta.Hash] = true
				p.processedMu.Unlock()

				// Call handler with plaintext payload
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump calling handler with %d bytes\n", len(plaintext))
				if err := handler(plaintext); err != nil {
					fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump handler error: %v\n", err)
					return fmt.Errorf("handler error: %w", err)
				}
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump handler completed successfully\n")
			}
		}
		// If we break out of the inner loop, we'll retry subscribing in the outer loop
	}
}
