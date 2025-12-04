package nostrtransport

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ChunkMetadata describes how a large encrypted payload is fragmented.
type ChunkMetadata struct {
	Hash      string
	Index     int
	Total     int
	SessionID string
	Recipient string
}

func (c ChunkMetadata) TagValue() string {
	return fmt.Sprintf("%s/%d/%d", c.Hash, c.Index, c.Total)
}

func ParseChunkTag(value string) (ChunkMetadata, error) {
	var meta ChunkMetadata
	parts := strings.Split(value, "/")
	if len(parts) != 3 {
		return ChunkMetadata{}, fmt.Errorf("invalid chunk tag format: expected 'hash/index/total', got %d parts", len(parts))
	}
	meta.Hash = parts[0]
	var err error
	meta.Index, err = strconv.Atoi(parts[1])
	if err != nil {
		return ChunkMetadata{}, fmt.Errorf("invalid chunk index: %w", err)
	}
	meta.Total, err = strconv.Atoi(parts[2])
	if err != nil {
		return ChunkMetadata{}, fmt.Errorf("invalid chunk total: %w", err)
	}
	return meta, nil
}

// Chunk represents a single fragment to be sent over Nostr.
type Chunk struct {
	Metadata ChunkMetadata
	Data     []byte
}

// ChunkPayload splits the ciphertext into fixed-size chunks and returns the chunks plus the payload hash.
func ChunkPayload(sessionID, recipient string, ciphertext []byte, chunkSize int) ([]Chunk, string) {
	if chunkSize <= 0 {
		chunkSize = 16 * 1024
	}
	hashBytes := sha256.Sum256(ciphertext)
	hash := hex.EncodeToString(hashBytes[:])
	total := (len(ciphertext) + chunkSize - 1) / chunkSize
	chunks := make([]Chunk, 0, total)
	for idx := 0; idx < total; idx++ {
		start := idx * chunkSize
		end := start + chunkSize
		if end > len(ciphertext) {
			end = len(ciphertext)
		}
		chunks = append(chunks, Chunk{
			Metadata: ChunkMetadata{
				Hash:      hash,
				Index:     idx,
				Total:     total,
				SessionID: sessionID,
				Recipient: recipient,
			},
			Data: ciphertext[start:end],
		})
	}
	return chunks, hash
}

// ChunkAssembler reassembles incoming chunks into the original ciphertext.
type ChunkAssembler struct {
	ttl    time.Duration
	mu     sync.Mutex
	buffer map[string]*chunkState
}

type chunkState struct {
	total    int
	payloads map[int][]byte
	deadline time.Time
}

func NewChunkAssembler(ttl time.Duration) *ChunkAssembler {
	if ttl == 0 {
		ttl = 2 * time.Minute
	}
	return &ChunkAssembler{
		ttl:    ttl,
		buffer: make(map[string]*chunkState),
	}
}

// Add stores the chunk and returns the reassembled payload when all parts arrive.
func (a *ChunkAssembler) Add(meta ChunkMetadata, data []byte) ([]byte, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()

	state, exists := a.buffer[meta.Hash]
	if !exists || time.Now().After(state.deadline) {
		state = &chunkState{
			total:    meta.Total,
			payloads: make(map[int][]byte),
			deadline: time.Now().Add(a.ttl),
		}
		a.buffer[meta.Hash] = state
	}

	// Ignore invalid indices.
	if meta.Index < 0 || meta.Index >= meta.Total {
		return nil, false
	}

	// Store chunk if not already present.
	if _, seen := state.payloads[meta.Index]; !seen {
		state.payloads[meta.Index] = append([]byte(nil), data...)
	}

	if len(state.payloads) == state.total {
		delete(a.buffer, meta.Hash)
		return assemblePayload(state), true
	}
	return nil, false
}

func assemblePayload(state *chunkState) []byte {
	size := 0
	for _, part := range state.payloads {
		size += len(part)
	}
	result := make([]byte, 0, size)
	for idx := 0; idx < state.total; idx++ {
		result = append(result, state.payloads[idx]...)
	}
	return result
}

// Cleanup removes expired chunk states to keep memory bounded.
func (a *ChunkAssembler) Cleanup() {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	for hash, state := range a.buffer {
		if now.After(state.deadline) {
			delete(a.buffer, hash)
		}
	}
}
