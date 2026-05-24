package tss

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
)

const nostrAttemptHandshakePrefix = "bbw-attempt-v1:"

func normalizeSigningNpubsCSV(partiesNpubsCSV string) string {
	parts := strings.Split(partiesNpubsCSV, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}

func initiatorNpubFromParties(partiesNpubsCSV string) (string, error) {
	sorted := normalizeSigningNpubsCSV(partiesNpubsCSV)
	if sorted == "" {
		return "", fmt.Errorf("no signing parties")
	}
	parts := strings.Split(sorted, ",")
	if parts[0] == "" {
		return "", fmt.Errorf("invalid initiator npub")
	}
	return parts[0], nil
}

func nostrAttemptHandshakeRoom(txIntentKey string) (string, error) {
	txIntentKey = strings.TrimSpace(txIntentKey)
	if txIntentKey == "" {
		return "", fmt.Errorf("empty tx intent key")
	}
	return Sha256(nostrAttemptHandshakePrefix + txIntentKey)
}

func nostrAttemptConfig(relaysCSV, partyNsec, partiesNpubsCSV, room, sessionKey string) (nostrtransport.Config, string, string, error) {
	localNpub, err := DeriveNpubFromNsec(partyNsec)
	if err != nil {
		return nostrtransport.Config{}, "", "", err
	}
	relays := strings.Split(relaysCSV, ",")
	for i := range relays {
		relays[i] = strings.TrimSpace(relays[i])
	}
	allParties := strings.Split(partiesNpubsCSV, ",")
	peersNpub := make([]string, 0)
	for _, npub := range allParties {
		npub = strings.TrimSpace(npub)
		if npub != "" && npub != localNpub {
			peersNpub = append(peersNpub, npub)
		}
	}
	if len(peersNpub) != 1 {
		return nostrtransport.Config{}, "", "", fmt.Errorf("attempt handshake requires exactly 1 peer, got %d", len(peersNpub))
	}
	cfg := nostrtransport.Config{
		Relays:        relays,
		SessionID:     room,
		SessionKeyHex: sessionKey,
		LocalNpub:     localNpub,
		LocalNsec:     partyNsec,
		PeersNpub:     peersNpub,
		MaxTimeout:    60 * time.Second,
	}
	cfg.ApplyDefaults()
	if err := cfg.Validate(); err != nil {
		return nostrtransport.Config{}, "", "", err
	}
	return cfg, localNpub, peersNpub[0], nil
}

func publishNostrAttemptID(relaysCSV, partyNsec, partiesNpubsCSV, room, attemptID string) error {
	sessionKey, err := Sha256(room)
	if err != nil {
		return err
	}
	cfg, localNpub, peerNpub, err := nostrAttemptConfig(relaysCSV, partyNsec, partiesNpubsCSV, room, sessionKey)
	if err != nil {
		return err
	}
	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return err
	}
	defer client.Close("attempt publish complete")
	messenger := nostrtransport.NewMessenger(cfg, client)
	ctx, cancel := context.WithTimeout(getActiveNostrCtx(), 20*time.Second)
	defer cancel()
	// Give responder time to subscribe (subscription-only, no history query).
	time.Sleep(2 * time.Second)
	for i := 0; i < 3; i++ {
		if err := messenger.SendMessage(ctx, localNpub, peerNpub, attemptID); err != nil {
			return fmt.Errorf("failed to publish attempt id: %w", err)
		}
		if i < 2 {
			time.Sleep(2 * time.Second)
		}
	}
	Logf("publishNostrAttemptID: published attempt_id=%s room=%s", attemptID, room)
	return nil
}

func waitForNostrAttemptID(relaysCSV, partyNsec, partiesNpubsCSV, room string) (string, error) {
	sessionKey, err := Sha256(room)
	if err != nil {
		return "", err
	}
	cfg, _, _, err := nostrAttemptConfig(relaysCSV, partyNsec, partiesNpubsCSV, room, sessionKey)
	if err != nil {
		return "", err
	}
	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return "", err
	}
	defer client.Close("attempt receive complete")

	attemptCh := make(chan string, 1)
	errCh := make(chan error, 1)
	ctx, cancel := context.WithTimeout(getActiveNostrCtx(), 25*time.Second)
	defer cancel()

	go func() {
		pump := nostrtransport.NewMessagePump(cfg, client)
		err := pump.RunSubscribeOnly(ctx, func(payload []byte) error {
			attemptID := strings.TrimSpace(string(payload))
			if len(attemptID) != 64 {
				return nil
			}
			select {
			case attemptCh <- attemptID:
			default:
			}
			return nil
		})
		if err != nil && err != context.Canceled {
			select {
			case errCh <- err:
			default:
			}
		}
	}()

	select {
	case attemptID := <-attemptCh:
		Logf("waitForNostrAttemptID: received attempt_id=%s room=%s", attemptID, room)
		return attemptID, nil
	case err := <-errCh:
		return "", fmt.Errorf("attempt handshake failed: %w", err)
	case <-ctx.Done():
		return "", fmt.Errorf("timeout waiting for attempt id: %w", ctx.Err())
	}
}

// ensureNostrAttemptID returns a shared attempt id for this co-sign round.
// Lexicographically first signing npub is initiator (master) and publishes attempt_id;
// the peer waits on subscription-only pump (no stale relay history).
func ensureNostrAttemptID(relaysCSV, partyNsec, partiesNpubsCSV, txIntentKey string) (string, error) {
	localNpub, err := DeriveNpubFromNsec(partyNsec)
	if err != nil {
		return "", err
	}
	initiator, err := initiatorNpubFromParties(partiesNpubsCSV)
	if err != nil {
		return "", err
	}
	room, err := nostrAttemptHandshakeRoom(txIntentKey)
	if err != nil {
		return "", err
	}
	if localNpub == initiator {
		attemptID, err := SecureRandom(64)
		if err != nil {
			return "", err
		}
		if err := publishNostrAttemptID(relaysCSV, partyNsec, partiesNpubsCSV, room, attemptID); err != nil {
			return "", err
		}
		return attemptID, nil
	}
	return waitForNostrAttemptID(relaysCSV, partyNsec, partiesNpubsCSV, room)
}
