package main

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
)

func main() {
	var (
		relaysCSV       = flag.String("relays", "", "Comma-separated list of Nostr relay URLs (wss://...) [required]")
		partyNsec       = flag.String("nsec", "", "Local party's Nostr secret key (nsec...) [required]")
		partiesNpubsCSV = flag.String("peers", "", "Comma-separated list of all party npubs (including self) [required]")
		sessionID       = flag.String("session", "", "Session ID [required]")
		sessionKey      = flag.String("session-key", "", "Session encryption key in hex [required]")
		keyshareFile    = flag.String("keyshare", "", "Path to keyshare JSON file [required]")
		derivePath      = flag.String("path", "m/44'/0'/0'/0/0", "HD derivation path (default: m/44'/0'/0'/0/0)")
		message         = flag.String("message", "", "Message to sign [required]")
		timeout         = flag.Int("timeout", 90, "Maximum timeout in seconds (default: 90)")
	)
	flag.Parse()

	if *relaysCSV == "" || *partyNsec == "" || *partiesNpubsCSV == "" || *sessionID == "" || *sessionKey == "" || *keyshareFile == "" || *message == "" {
		fmt.Fprintf(os.Stderr, "Error: missing required arguments\n")
		flag.Usage()
		os.Exit(1)
	}

	// Derive npub from nsec (handles both bech32 and hex formats)
	localNpub, err := tss.DeriveNpubFromNsec(*partyNsec)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to derive npub from nsec: %v\n", err)
		os.Exit(1)
	}

	// Load keyshare file
	keyshareData, err := os.ReadFile(*keyshareFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to read keyshare file: %v\n", err)
		os.Exit(1)
	}

	// Parse keyshare JSON
	var keyshare tss.LocalStateNostr
	if err := json.Unmarshal(keyshareData, &keyshare); err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to parse keyshare JSON: %v\n", err)
		os.Exit(1)
	}

	// Verify npub matches
	if keyshare.NostrNpub != localNpub {
		fmt.Fprintf(os.Stderr, "Warning: keyshare npub (%s) does not match derived npub (%s)\n", keyshare.NostrNpub, localNpub)
	}

	// Parse relays
	relays := strings.Split(*relaysCSV, ",")
	for i := range relays {
		relays[i] = strings.TrimSpace(relays[i])
	}

	// Parse peer npubs
	allParties := strings.Split(*partiesNpubsCSV, ",")
	for i := range allParties {
		allParties[i] = strings.TrimSpace(allParties[i])
	}

	// Extract peer npubs (excluding self)
	peersNpub := make([]string, 0)
	for _, npub := range allParties {
		if npub != localNpub {
			peersNpub = append(peersNpub, npub)
		}
	}

	// Create config
	cfg := nostrtransport.Config{
		Relays:        relays,
		SessionID:     *sessionID,
		SessionKeyHex: *sessionKey,
		LocalNpub:     localNpub,
		LocalNsec:     *partyNsec,
		PeersNpub:     peersNpub,
		MaxTimeout:    time.Duration(*timeout) * time.Second,
	}

	if err := cfg.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: invalid config: %v\n", err)
		os.Exit(1)
	}

	// Run keysign
	signatureJSON, err := runNostrKeysign(cfg, &keyshare, *derivePath, *message, allParties)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Output signature
	fmt.Println(signatureJSON)
}

func runNostrKeysign(cfg nostrtransport.Config, keyshare *tss.LocalStateNostr, derivePath, message string, allParties []string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cfg.MaxTimeout)
	defer cancel()

	// Create Nostr client
	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return "", fmt.Errorf("create client: %w", err)
	}
	defer client.Close("keysign complete")

	// Create session coordinator
	coordinator := nostrtransport.NewSessionCoordinator(cfg, client)

	// Publish readiness
	if err := coordinator.PublishReady(ctx); err != nil {
		return "", fmt.Errorf("publish ready: %w", err)
	}

	// Wait for all peers
	if err := coordinator.AwaitPeers(ctx); err != nil {
		return "", fmt.Errorf("await peers: %w", err)
	}

	// Create messenger and adapter (inline to avoid import cycle)
	messenger := nostrtransport.NewMessenger(cfg, client)
	messengerAdapter := &nostrMessengerAdapter{
		messenger: messenger,
		ctx:       ctx,
	}

	// Create local state accessor that returns the keyshare
	stateAccessor := &nostrKeysignStateAccessor{
		keyshare: keyshare,
	}

	// Create TSS service
	tssService, err := tss.NewService(messengerAdapter, stateAccessor, false, "-")
	if err != nil {
		return "", fmt.Errorf("create TSS service: %w", err)
	}

	// Create message pump
	pump := nostrtransport.NewMessagePump(cfg, client)
	pumpCtx, pumpCancel := context.WithTimeout(ctx, cfg.MaxTimeout)
	defer pumpCancel()

	// Run pump in background
	pumpErrCh := make(chan error, 1)
	var pumpWg sync.WaitGroup
	pumpWg.Add(1)
	go func() {
		defer pumpWg.Done()
		err := pump.Run(pumpCtx, func(payload []byte) error {
			return tssService.ApplyData(string(payload))
		})
		if err != nil && err != context.Canceled && err != context.DeadlineExceeded {
			pumpErrCh <- err
		}
	}()

	// Hash and encode message
	messageHash, err := tss.Sha256(message)
	if err != nil {
		pumpCancel()
		return "", fmt.Errorf("hash message: %w", err)
	}
	messageHashBytes, err := hex.DecodeString(messageHash)
	if err != nil {
		pumpCancel()
		return "", fmt.Errorf("decode message hash: %w", err)
	}
	messageBase64 := base64.StdEncoding.EncodeToString(messageHashBytes)

	// Use the requested parties (allParties) for keysign so we can run subsets
	keysignCommitteeKeys := strings.Join(allParties, ",")
	if strings.TrimSpace(keysignCommitteeKeys) == "" {
		// Fallback to keyshare metadata if caller didn't specify parties
		keysignCommitteeKeys = strings.Join(keyshare.KeygenCommitteeKeys, ",")
	}

	// Perform keysign
	keysignResp, err := tssService.KeysignECDSA(&tss.KeysignRequest{
		PubKey:               keyshare.PubKey,
		MessageToSign:        messageBase64,
		KeysignCommitteeKeys: keysignCommitteeKeys,
		LocalPartyKey:        cfg.LocalNpub,
		DerivePath:           derivePath,
	})
	if err != nil {
		pumpCancel()
		pumpWg.Wait()
		return "", fmt.Errorf("keysign failed: %w", err)
	}

	// Wait a bit for pump to finish processing
	time.Sleep(2 * time.Second)
	pumpCancel()
	pumpWg.Wait()

	// Check for pump errors
	select {
	case err := <-pumpErrCh:
		return "", fmt.Errorf("pump error: %w", err)
	default:
	}

	// Publish completion
	if err := coordinator.PublishComplete(ctx, "keysign"); err != nil {
		// Non-fatal
		fmt.Fprintf(os.Stderr, "Warning: failed to publish completion: %v\n", err)
	}

	// Marshal response
	resultJSON, err := json.MarshalIndent(keysignResp, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal response: %w", err)
	}

	return string(resultJSON), nil
}

// nostrKeysignStateAccessor implements tss.LocalStateAccessor for Nostr keysign.
type nostrKeysignStateAccessor struct {
	keyshare *tss.LocalStateNostr
}

func (a *nostrKeysignStateAccessor) GetLocalState(pubKey string) (string, error) {
	if a.keyshare == nil {
		return "", fmt.Errorf("keyshare not loaded")
	}
	// Verify pub key matches
	if a.keyshare.PubKey != pubKey {
		return "", fmt.Errorf("pub key mismatch: expected %s, got %s", a.keyshare.PubKey, pubKey)
	}
	// Return keyshare as JSON (without Nostr fields for TSS compatibility)
	keyshareJSON, err := json.Marshal(a.keyshare.LocalState)
	if err != nil {
		return "", fmt.Errorf("marshal keyshare: %w", err)
	}
	return string(keyshareJSON), nil
}

func (a *nostrKeysignStateAccessor) SaveLocalState(pubkey, localState string) error {
	// Keysign doesn't modify the keyshare, so we don't need to save
	return nil
}

// nostrMessengerAdapter implements tss.Messenger interface for Nostr transport.
type nostrMessengerAdapter struct {
	messenger *nostrtransport.Messenger
	ctx       context.Context
}

// Send implements tss.Messenger interface.
func (a *nostrMessengerAdapter) Send(from, to, body string) error {
	return a.messenger.SendMessage(a.ctx, from, to, body)
}
