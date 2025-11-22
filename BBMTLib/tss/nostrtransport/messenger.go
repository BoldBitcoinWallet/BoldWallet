package nostrtransport

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"

	nostr "github.com/nbd-wtf/go-nostr"
)

// Messenger publishes encrypted TSS messages over Nostr relays.
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

// SendMessage encrypts, chunks, and publishes a TSS message body string.
func (m *Messenger) SendMessage(ctx context.Context, from, to, body string) error {
	fmt.Fprintf(os.Stderr, "BBMTLog: Messenger sending message from %s to %s (%d bytes)\n", from, to, len(body))

	// Encrypt the body with session key
	ciphertext, err := encryptAES(m.cfg.SessionKeyHex, []byte(body))
	if err != nil {
		return fmt.Errorf("encrypt message: %w", err)
	}

	// Chunk the ciphertext
	chunks, _ := ChunkPayload(m.cfg.SessionID, to, ciphertext, m.cfg.ChunkSize)
	fmt.Fprintf(os.Stderr, "BBMTLog: Messenger split into %d chunks\n", len(chunks))

	// Publish each chunk as a Nostr event
	for _, chunk := range chunks {
		event := &Event{
			Kind:      30303, // Custom kind for TSS messages
			CreatedAt: nostr.Now(),
			Tags: nostr.Tags{
				nostr.Tag{"t", m.cfg.SessionID},
				nostr.Tag{"p", to},
				nostr.Tag{"chunk", chunk.Metadata.TagValue()},
			},
			Content: base64.StdEncoding.EncodeToString(chunk.Data),
		}

		fmt.Fprintf(os.Stderr, "BBMTLog: Messenger publishing chunk %d/%d to %s\n", chunk.Metadata.Index+1, chunk.Metadata.Total, to)
		if err := m.client.Publish(ctx, event); err != nil {
			return fmt.Errorf("publish chunk %d/%d: %w", chunk.Metadata.Index+1, chunk.Metadata.Total, err)
		}
		fmt.Fprintf(os.Stderr, "BBMTLog: Messenger published chunk %d/%d successfully\n", chunk.Metadata.Index+1, chunk.Metadata.Total)
	}

	return nil
}
