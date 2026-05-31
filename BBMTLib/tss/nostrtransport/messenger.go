package nostrtransport

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"
)

// Messenger publishes encrypted TSS messages over Nostr relays using NIP-44 with rumor/wrap/seal pattern.
type Messenger struct {
	cfg    Config
	client *Client
}

func NewMessenger(cfg Config, client *Client) (result *Messenger) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in NewMessenger: %v", r)
			fmt.Fprintf(os.Stderr, "BBMTLog: %s\n", errMsg)
			fmt.Fprintf(os.Stderr, "BBMTLog: Stack trace: %s\n", string(debug.Stack()))
			result = nil
		}
	}()

	cfg.ApplyDefaults()
	return &Messenger{cfg: cfg, client: client}
}

// SessionID returns the session ID from the messenger config.
func (m *Messenger) Cfg() Config {
	return m.cfg
}

// SendMessage encrypts, chunks, and publishes a TSS message body string using NIP-44 rumor/wrap/seal.
func (m *Messenger) SendMessage(ctx context.Context, from, to, body string) (err error) {
	defer recoverAsError("Messenger.SendMessage", &err, nil)

	fmt.Fprintf(os.Stderr, "BBMTLog: Messenger sending message from %s to %s (%d bytes)\n", from, to, len(body))

	senderNpubHex, err := npubToHex(m.cfg.LocalNpub)
	if err != nil {
		return fmt.Errorf("convert sender npub: %w", err)
	}

	chunks, _ := ChunkPayload(m.cfg.SessionID, to, []byte(body), m.cfg.ChunkSize)
	fmt.Fprintf(os.Stderr, "BBMTLog: Messenger split into %d chunks\n", len(chunks))

	total := len(chunks)
	if total < 1 {
		total = 1
	}
	reportTransportProgress(m.cfg.SessionID, 0, total, true)
	defer reportTransportProgress(m.cfg.SessionID, 0, total, false)

	var completed atomic.Int32
	var progressMu sync.Mutex
	lastProgressAt := time.Now()
	reportChunkProgress := func(done int) {
		progressMu.Lock()
		defer progressMu.Unlock()
		now := time.Now()
		if done >= total || now.Sub(lastProgressAt) >= 200*time.Millisecond {
			lastProgressAt = now
			reportTransportProgress(m.cfg.SessionID, done, total, true)
		}
	}

	window := m.cfg.ChunkPublishWindow
	if window <= 0 {
		window = 4
	}
	if window > len(chunks) {
		window = len(chunks)
	}

	sem := make(chan struct{}, window)
	var wg sync.WaitGroup
	var errOnce sync.Once
	var sendErr error

	for _, chunk := range chunks {
		chunk := chunk
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			if err := m.publishChunk(ctx, senderNpubHex, to, chunk); err != nil {
				errOnce.Do(func() { sendErr = err })
				return
			}
			done := int(completed.Add(1))
			reportChunkProgress(done)
		}()
	}
	wg.Wait()
	return sendErr
}

func (m *Messenger) publishChunk(ctx context.Context, senderNpubHex, to string, chunk Chunk) error {
	chunkMessage := map[string]interface{}{
		"session_id": m.cfg.SessionID,
		"chunk":      chunk.Metadata.TagValue(),
		"data":       base64.StdEncoding.EncodeToString(chunk.Data),
	}
	chunkJSON, err := json.Marshal(chunkMessage)
	if err != nil {
		return fmt.Errorf("marshal chunk message: %w", err)
	}

	retryTicker := time.NewTicker(1 * time.Second)
	defer retryTicker.Stop()
	var lastErr error

	for {
		select {
		case <-ctx.Done():
			if lastErr != nil {
				return fmt.Errorf("publish wrap for chunk %d/%d: %w (context cancelled)", chunk.Metadata.Index+1, chunk.Metadata.Total, lastErr)
			}
			return ctx.Err()
		default:
		}

		rumor := createRumor(string(chunkJSON), senderNpubHex)
		seal, err := createSeal(rumor, m.cfg.LocalNsec, to)
		if err != nil {
			return fmt.Errorf("create seal for chunk %d/%d: %w", chunk.Metadata.Index+1, chunk.Metadata.Total, err)
		}
		wrap, err := createWrap(seal, to, m.cfg.SessionID, chunk.Metadata.TagValue())
		if err != nil {
			return fmt.Errorf("create wrap for chunk %d/%d: %w", chunk.Metadata.Index+1, chunk.Metadata.Total, err)
		}

		fmt.Fprintf(os.Stderr, "BBMTLog: Messenger publishing wrapped chunk %d/%d to %s\n", chunk.Metadata.Index+1, chunk.Metadata.Total, to)

		err = m.client.PublishWrapMode(ctx, wrap, PublishModeBulk)
		if err == nil {
			fmt.Fprintf(os.Stderr, "BBMTLog: Messenger published wrapped chunk %d/%d successfully\n", chunk.Metadata.Index+1, chunk.Metadata.Total)
			return nil
		}

		lastErr = err
		fmt.Fprintf(os.Stderr, "BBMTLog: Messenger failed to publish wrap for chunk %d/%d: %v, retrying in 1 second...\n", chunk.Metadata.Index+1, chunk.Metadata.Total, err)

		select {
		case <-ctx.Done():
			return fmt.Errorf("publish wrap for chunk %d/%d: %w (context cancelled)", chunk.Metadata.Index+1, chunk.Metadata.Total, lastErr)
		case <-retryTicker.C:
		}
	}
}
