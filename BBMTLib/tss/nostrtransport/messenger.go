package nostrtransport

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
)

// Messenger publishes encrypted TSS messages over Nostr relays using NIP-44 with rumor/wrap/seal pattern.
type Messenger struct {
	cfg    Config
	client *Client
}

func NewMessenger(cfg Config, client *Client) *Messenger {
	cfg.ApplyDefaults()
	return &Messenger{cfg: cfg, client: client}
}

// SessionID returns the session ID from the messenger config.
func (m *Messenger) Cfg() Config {
	return m.cfg
}

// SendMessage encrypts, chunks, and publishes a TSS message body string using NIP-44 rumor/wrap/seal.
func (m *Messenger) SendMessage(ctx context.Context, from, to, body string) error {
	fmt.Fprintf(os.Stderr, "BBMTLog: Messenger sending message from %s to %s (%d bytes)\n", from, to, len(body))

	// Convert sender npub to hex for rumor
	senderNpubHex, err := npubToHex(m.cfg.LocalNpub)
	if err != nil {
		return fmt.Errorf("convert sender npub: %w", err)
	}

	// Chunk the plaintext body (we'll wrap each chunk)
	chunks, _ := ChunkPayload(m.cfg.SessionID, to, []byte(body), m.cfg.ChunkSize)
	fmt.Fprintf(os.Stderr, "BBMTLog: Messenger split into %d chunks\n", len(chunks))

	// Process each chunk: create rumor → seal → wrap → publish
	for _, chunk := range chunks {
		// Create chunk message with metadata
		chunkMessage := map[string]interface{}{
			"session_id": m.cfg.SessionID,
			"chunk":      chunk.Metadata.TagValue(),
			"data":       base64.StdEncoding.EncodeToString(chunk.Data),
		}
		chunkJSON, err := json.Marshal(chunkMessage)
		if err != nil {
			return fmt.Errorf("marshal chunk message: %w", err)
		}

		// Step 1: Create rumor (kind:14) - unsigned event
		rumor := createRumor(string(chunkJSON), senderNpubHex, to)

		// Step 2: Create seal (kind:13) - encrypt rumor with NIP-44
		seal, err := createSeal(rumor, m.cfg.LocalNsec, to)
		if err != nil {
			return fmt.Errorf("create seal for chunk %d/%d: %w", chunk.Metadata.Index+1, chunk.Metadata.Total, err)
		}

		// Step 3: Create wrap (kind:1059) - wrap seal in gift wrap
		// Include session and chunk tags for filtering (must be added before signing)
		wrap, err := createWrap(seal, to, m.cfg.SessionID, chunk.Metadata.TagValue())
		if err != nil {
			return fmt.Errorf("create wrap for chunk %d/%d: %w", chunk.Metadata.Index+1, chunk.Metadata.Total, err)
		}

		fmt.Fprintf(os.Stderr, "BBMTLog: Messenger publishing wrapped chunk %d/%d to %s\n", chunk.Metadata.Index+1, chunk.Metadata.Total, to)

		// Publish the wrap (kind:1059)
		if err := m.client.PublishWrap(ctx, wrap); err != nil {
			return fmt.Errorf("publish wrap for chunk %d/%d: %w", chunk.Metadata.Index+1, chunk.Metadata.Total, err)
		}
		fmt.Fprintf(os.Stderr, "BBMTLog: Messenger published wrapped chunk %d/%d successfully\n", chunk.Metadata.Index+1, chunk.Metadata.Total)
	}

	return nil
}
