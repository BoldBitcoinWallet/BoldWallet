package nostrtransport

import (
	"context"
	"encoding/base64"
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

	// Subscribe to events with session tag, recipient tag, and author filter
	filter := Filter{
		Tags: nostr.TagMap{
			"t": []string{p.cfg.SessionID},
			"p": []string{p.cfg.LocalNpub}, // Only messages addressed to this party (bech32 is fine for "p" tag)
		},
		Kinds:   []int{30303}, // TSS message kind
		Authors: authorsHex,   // Only receive messages from expected peers (hex format)
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump subscribing to session %s, local npub %s (hex: %s), expecting authors (hex): %v\n", p.cfg.SessionID, p.cfg.LocalNpub, localNpubHex, authorsHex)
	events, err := p.client.Subscribe(ctx, filter)
	if err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump subscription active\n")

	cleanupTicker := time.NewTicker(30 * time.Second)
	defer cleanupTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-cleanupTicker.C:
			p.assembler.Cleanup()
		case event, ok := <-events:
			if !ok {
				return fmt.Errorf("event channel closed")
			}
			if event == nil {
				continue
			}

			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump received event from %s (hex), kind=%d, content_len=%d, tags_count=%d\n", event.PubKey, event.Kind, len(event.Content), len(event.Tags))

			// Skip events from self (compare hex to hex)
			if event.PubKey == localNpubHex {
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump skipping event from self (hex: %s)\n", event.PubKey)
				continue
			}

			// Verify event is from an expected peer (additional safety check)
			isFromExpectedPeer := false
			for _, expectedHex := range authorsHex {
				if event.PubKey == expectedHex {
					isFromExpectedPeer = true
					break
				}
			}
			if !isFromExpectedPeer && len(authorsHex) > 0 {
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump skipping event from unexpected peer (hex: %s, expected: %v)\n", event.PubKey, authorsHex)
				continue
			}

			// Debug: print all tags
			for i, tag := range event.Tags {
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump tag[%d]: %v\n", i, tag)
			}

			// Extract chunk metadata from tags
			chunkTag := event.Tags.Find("chunk")
			if len(chunkTag) < 2 {
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump event missing chunk tag or invalid format (len=%d, tag=%v)\n", len(chunkTag), chunkTag)
				continue
			}
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump found chunk tag: %v\n", chunkTag)

			meta, err := ParseChunkTag(chunkTag[1])
			if err != nil {
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to parse chunk tag '%s': %v\n", chunkTag[1], err)
				continue
			}
			meta.SessionID = p.cfg.SessionID
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump parsed chunk metadata: hash=%s, index=%d/%d\n", meta.Hash, meta.Index, meta.Total)

			// Decode chunk data
			chunkData, err := base64.StdEncoding.DecodeString(event.Content)
			if err != nil {
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to decode base64 content: %v\n", err)
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

			// Decrypt the reassembled ciphertext
			plaintext, err := decryptAES(p.cfg.SessionKeyHex, reassembled)
			if err != nil {
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump failed to decrypt: %v\n", err)
				continue
			}
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump decrypted payload: %d bytes\n", len(plaintext))

			// Mark as processed
			p.processedMu.Lock()
			p.processed[meta.Hash] = true
			p.processedMu.Unlock()

			// Call handler with decrypted payload
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump calling handler with %d bytes\n", len(plaintext))
			if err := handler(plaintext); err != nil {
				fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump handler error: %v\n", err)
				return fmt.Errorf("handler error: %w", err)
			}
			fmt.Fprintf(os.Stderr, "BBMTLog: MessagePump handler completed successfully\n")
		}
	}
}
