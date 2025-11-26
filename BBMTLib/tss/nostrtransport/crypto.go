package nostrtransport

import (
	"fmt"
	"strings"

	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
	"github.com/nbd-wtf/go-nostr/nip44"
)

// npubToHex converts a bech32 npub to hex format
func npubToHex(npub string) (string, error) {
	if strings.HasPrefix(npub, "npub1") {
		prefix, decoded, err := nip19.Decode(npub)
		if err != nil {
			return "", fmt.Errorf("decode npub failed: %w", err)
		}
		if prefix != "npub" {
			return "", fmt.Errorf("invalid prefix for npub: %s", prefix)
		}
		pkHexStr, ok := decoded.(string)
		if !ok {
			return "", fmt.Errorf("failed to decode npub: invalid type")
		}
		return pkHexStr, nil
	}
	// Already hex
	if len(npub) == 64 {
		return npub, nil
	}
	return "", fmt.Errorf("invalid npub format")
}

// nsecToHex converts a bech32 nsec to hex format
func nsecToHex(nsec string) (string, error) {
	if strings.HasPrefix(nsec, "nsec1") {
		prefix, decoded, err := nip19.Decode(nsec)
		if err != nil {
			return "", fmt.Errorf("decode nsec failed: %w", err)
		}
		if prefix != "nsec" {
			return "", fmt.Errorf("invalid prefix for nsec: %s", prefix)
		}
		skHexStr, ok := decoded.(string)
		if !ok {
			return "", fmt.Errorf("failed to decode nsec: invalid type")
		}
		return skHexStr, nil
	}
	// Already hex
	if len(nsec) == 64 {
		return nsec, nil
	}
	return "", fmt.Errorf("invalid nsec format")
}

// generateConversationKey generates a NIP-44 conversation key from sender private key and recipient public key
func generateConversationKey(senderNsec string, recipientNpub string) ([32]byte, error) {
	var ck [32]byte
	
	// Convert nsec to hex
	senderNsecHex, err := nsecToHex(senderNsec)
	if err != nil {
		return ck, fmt.Errorf("convert sender nsec: %w", err)
	}
	
	// Convert npub to hex
	recipientNpubHex, err := npubToHex(recipientNpub)
	if err != nil {
		return ck, fmt.Errorf("convert recipient npub: %w", err)
	}
	
	// Generate conversation key using NIP-44
	ck, err = nip44.GenerateConversationKey(recipientNpubHex, senderNsecHex)
	if err != nil {
		return ck, fmt.Errorf("generate conversation key: %w", err)
	}
	
	return ck, nil
}

// encryptNIP44 encrypts a message using NIP-44 encryption
func encryptNIP44(plaintext string, senderNsec string, recipientNpub string) (string, error) {
	conversationKey, err := generateConversationKey(senderNsec, recipientNpub)
	if err != nil {
		return "", fmt.Errorf("generate conversation key: %w", err)
	}
	
	encrypted, err := nip44.Encrypt(plaintext, conversationKey)
	if err != nil {
		return "", fmt.Errorf("nip44 encrypt: %w", err)
	}
	
	return encrypted, nil
}

// decryptNIP44 decrypts a message using NIP-44 decryption
func decryptNIP44(ciphertext string, recipientNsec string, senderNpub string) (string, error) {
	conversationKey, err := generateConversationKey(recipientNsec, senderNpub)
	if err != nil {
		return "", fmt.Errorf("generate conversation key: %w", err)
	}
	
	decrypted, err := nip44.Decrypt(ciphertext, conversationKey)
	if err != nil {
		return "", fmt.Errorf("nip44 decrypt: %w", err)
	}
	
	return decrypted, nil
}

// createRumor creates a kind:14 rumor (unsigned chat message)
func createRumor(content string, senderPubkey string, recipientPubkey string) nostr.Event {
	rumor := nostr.Event{
		Kind:      14, // NIP-17 kind for chat messages (rumor)
		CreatedAt: nostr.Now(),
		PubKey:    senderPubkey,
		Content:   content,
		Tags:      nostr.Tags{{"p", recipientPubkey}},
	}
	// Calculate event ID (unsigned)
	rumor.ID = rumor.GetID()
	return rumor
}

// createSeal encrypts the rumor into a kind:13 seal using NIP-44
func createSeal(rumor nostr.Event, senderNsec string, recipientNpub string) (*nostr.Event, error) {
	// Serialize rumor to JSON
	rumorJSON, err := rumor.MarshalJSON()
	if err != nil {
		return nil, fmt.Errorf("failed to serialize rumor: %w", err)
	}

	// Encrypt rumor using NIP-44
	encryptedContent, err := encryptNIP44(string(rumorJSON), senderNsec, recipientNpub)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt rumor: %w", err)
	}

	// Create seal event (kind:13)
	seal := &nostr.Event{
		Kind:      13,
		CreatedAt: nostr.Now(),
		Content:   encryptedContent,
		Tags:      nostr.Tags{}, // Empty tags as per NIP-59
	}
	
	// Sign the seal
	senderNsecHex, err := nsecToHex(senderNsec)
	if err != nil {
		return nil, fmt.Errorf("convert nsec: %w", err)
	}
	if err := seal.Sign(senderNsecHex); err != nil {
		return nil, fmt.Errorf("failed to sign seal: %w", err)
	}
	
	return seal, nil
}

// createWrap creates a kind:1059 gift wrap for the seal
// sessionID and chunkTag are optional tags for filtering (can be empty strings)
func createWrap(seal *nostr.Event, recipientNpub string, sessionID string, chunkTag string) (*nostr.Event, error) {
	// Serialize seal to JSON
	sealJSON, err := seal.MarshalJSON()
	if err != nil {
		return nil, fmt.Errorf("failed to serialize seal: %w", err)
	}

	// Generate a random one-time key pair for the wrap
	wrapNsec := nostr.GeneratePrivateKey()

	// Encrypt seal using NIP-44 with wrap key and recipient
	encryptedContent, err := encryptNIP44(string(sealJSON), wrapNsec, recipientNpub)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt seal: %w", err)
	}

	// Convert recipient npub to hex for the "p" tag (some relays require hex format)
	recipientNpubHex, err := npubToHex(recipientNpub)
	if err != nil {
		return nil, fmt.Errorf("convert recipient npub to hex: %w", err)
	}

	// Build tags - must include all tags before signing (ID is calculated from tags)
	// Use hex format for "p" tag to ensure compatibility with stricter relays
	tags := nostr.Tags{
		{"p", recipientNpubHex}, // Recipient tag (required by NIP-59, in hex format for relay compatibility)
	}
	if sessionID != "" {
		tags = append(tags, nostr.Tag{"t", sessionID})
	}
	if chunkTag != "" {
		tags = append(tags, nostr.Tag{"chunk", chunkTag})
	}

	// Create wrap event (kind:1059)
	wrap := &nostr.Event{
		Kind:      1059, // NIP-59 gift wrap
		CreatedAt: nostr.Now(),
		Content:   encryptedContent,
		Tags:      tags,
	}
	
	// Sign the wrap with the one-time key
	// Sign() will automatically set PubKey from the private key and calculate the ID
	// The ID is calculated from: [0, kind, created_at, pubkey, tags, content]
	if err := wrap.Sign(wrapNsec); err != nil {
		return nil, fmt.Errorf("failed to sign wrap: %w", err)
	}
	
	return wrap, nil
}

// unwrapGift unwraps a kind:1059 gift wrap to get the seal
func unwrapGift(wrap *nostr.Event, recipientNsec string) (*nostr.Event, error) {
	// The wrap is encrypted with: GenerateConversationKey(recipientNpub, wrapNsec)
	// To decrypt, we use: GenerateConversationKey(wrapNpub, recipientNsec)
	// This derives the same conversation key
	// wrap.PubKey is already in hex format (from the event)
	wrapNpubHex := wrap.PubKey
	
	// decryptNIP44 expects npub format (bech32 or hex), but we have hex, so we can pass it directly
	// However, decryptNIP44 will convert it, so we need to pass it as hex string
	decryptedSealJSON, err := decryptNIP44(wrap.Content, recipientNsec, wrapNpubHex)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt wrap: %w", err)
	}

	// Parse the seal event
	var seal nostr.Event
	if err := seal.UnmarshalJSON([]byte(decryptedSealJSON)); err != nil {
		return nil, fmt.Errorf("failed to parse seal: %w", err)
	}

	return &seal, nil
}

// unseal decrypts a kind:13 seal to get the rumor
func unseal(seal *nostr.Event, recipientNsec string, senderNpub string) (*nostr.Event, error) {
	// Decrypt the seal content using NIP-44
	decryptedRumorJSON, err := decryptNIP44(seal.Content, recipientNsec, senderNpub)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt seal: %w", err)
	}

	// Parse the rumor event
	var rumor nostr.Event
	if err := rumor.UnmarshalJSON([]byte(decryptedRumorJSON)); err != nil {
		return nil, fmt.Errorf("failed to parse rumor: %w", err)
	}

	return &rumor, nil
}
