package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
	nostr "github.com/nbd-wtf/go-nostr"
)

func main() {
	var (
		relaysCSV       = flag.String("relays", "", "Comma-separated list of Nostr relay URLs (wss://...) [required]")
		partyNpub       = flag.String("npub", "", "Local party's Nostr public key (npub...). If not provided, generates new keypair")
		otherPartiesCSV = flag.String("peers", "", "Comma-separated list of other party npubs [required]")
		sessionID       = flag.String("session", "", "Preshared session ID (auto-generated if not provided)")
		sessionKey      = flag.String("session-key", "", "Preshared session key in hex (auto-generated if not provided)")
		chaincode       = flag.String("chaincode", "", "Chain code in hex (auto-generated if not provided)")
		timeout         = flag.Int("timeout", 90, "Maximum timeout in seconds (default: 90)")
		nsecEnv         = flag.String("nsec-env", "NOSTR_NSEC", "Environment variable name for nsec (used only if -npub is provided)")
		ppmPath         = flag.String("ppm", "", "Path to pre-params file (optional)")
		output          = flag.String("output", "", "Output file for keyshare JSON (default: stdout)")
	)
	flag.Parse()

	if *relaysCSV == "" || *otherPartiesCSV == "" {
		fmt.Fprintf(os.Stderr, "Error: -relays and -peers are required\n")
		flag.Usage()
		os.Exit(1)
	}

	// Generate or load nsec/npub
	var nsec, npub string
	if *partyNpub == "" {
		// Generate new Nostr keypair
		nsec = nostr.GeneratePrivateKey()
		var err error
		npub, err = nostr.GetPublicKey(nsec)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: failed to generate npub: %v\n", err)
			os.Exit(1)
		}
		fmt.Fprintf(os.Stderr, "Generated new Nostr keypair:\n")
		fmt.Fprintf(os.Stderr, "  nsec: %s\n", nsec)
		fmt.Fprintf(os.Stderr, "  npub: %s\n", npub)
	} else {
		npub = *partyNpub
		// Load nsec from environment
		nsec = os.Getenv(*nsecEnv)
		if nsec == "" {
			fmt.Fprintf(os.Stderr, "Error: nsec not found in environment variable %s\n", *nsecEnv)
			os.Exit(1)
		}
	}

	// Generate session ID if not provided
	if *sessionID == "" {
		*sessionID, _ = tss.SecureRandom(64)
		fmt.Fprintf(os.Stderr, "Generated session ID: %s\n", *sessionID)
	}

	// Generate session key if not provided
	if *sessionKey == "" {
		*sessionKey, _ = tss.SecureRandom(64)
		fmt.Fprintf(os.Stderr, "Generated session key: %s\n", *sessionKey)
	}

	// Generate chaincode if not provided
	if *chaincode == "" {
		*chaincode, _ = tss.SecureRandom(64)
		fmt.Fprintf(os.Stderr, "Generated chaincode: %s\n", *chaincode)
	}

	// Parse relays
	relays := strings.Split(*relaysCSV, ",")
	for i := range relays {
		relays[i] = strings.TrimSpace(relays[i])
	}

	// Parse peer npubs
	peers := strings.Split(*otherPartiesCSV, ",")
	for i := range peers {
		peers[i] = strings.TrimSpace(peers[i])
	}

	// Create config
	cfg := nostrtransport.Config{
		Relays:        relays,
		SessionID:     *sessionID,
		SessionKeyHex: *sessionKey,
		LocalNpub:     npub,
		LocalNsec:     nsec,
		PeersNpub:     peers,
		MaxTimeout:    time.Duration(*timeout) * time.Second,
	}

	if err := cfg.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: invalid config: %v\n", err)
		os.Exit(1)
	}

	// Run keygen
	keyshareJSON, err := runNostrKeygen(cfg, *chaincode, *ppmPath, npub)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Write output
	if *output != "" {
		if err := os.WriteFile(*output, []byte(keyshareJSON), 0600); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing output: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("Keyshare saved to %s\n", *output)
	} else {
		fmt.Println(keyshareJSON)
	}
}

func runNostrKeygen(cfg nostrtransport.Config, chaincode, ppmPath, localNpub string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cfg.MaxTimeout)
	defer cancel()

	// Create Nostr client
	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return "", fmt.Errorf("create client: %w", err)
	}
	defer client.Close("keygen complete")

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

	// Create local state accessor that captures the result
	var localStateJSON string
	var localStateMu sync.Mutex
	stateAccessor := &nostrLocalStateAccessor{
		saveFunc: func(pubKey, state string) error {
			localStateMu.Lock()
			defer localStateMu.Unlock()
			localStateJSON = state
			return nil
		},
	}

	// Create TSS service
	tssService, err := tss.NewService(messengerAdapter, stateAccessor, true, ppmPath)
	if err != nil {
		return "", fmt.Errorf("create TSS service: %w", err)
	}

	// Create message pump
	pump := nostrtransport.NewMessagePump(cfg, client)
	pumpCtx, pumpCancel := context.WithTimeout(ctx, cfg.MaxTimeout)
	defer pumpCancel()

	// Run pump in background
	pumpErrCh := make(chan error, 1)
	go func() {
		err := pump.Run(pumpCtx, func(payload []byte) error {
			return tssService.ApplyData(string(payload))
		})
		if err != nil && err != context.Canceled && err != context.DeadlineExceeded {
			pumpErrCh <- err
		}
	}()

	// Run keygen
	allParties := append([]string{localNpub}, cfg.PeersNpub...)
	partiesCSV := strings.Join(allParties, ",")
	_, err = tssService.KeygenECDSA(&tss.KeygenRequest{
		LocalPartyID: localNpub,
		AllParties:   partiesCSV,
		ChainCodeHex: chaincode,
	})
	if err != nil {
		pumpCancel()
		return "", fmt.Errorf("keygen failed: %w", err)
	}

	// Wait a bit for pump to finish processing
	time.Sleep(2 * time.Second)
	pumpCancel()

	// Check for pump errors
	select {
	case err := <-pumpErrCh:
		return "", fmt.Errorf("pump error: %w", err)
	default:
	}

	// Publish completion
	if err := coordinator.PublishComplete(ctx, "keygen"); err != nil {
		// Non-fatal
		fmt.Fprintf(os.Stderr, "Warning: failed to publish completion: %v\n", err)
	}

	// Get the saved local state
	localStateMu.Lock()
	result := localStateJSON
	localStateMu.Unlock()

	if result == "" {
		return "", fmt.Errorf("no local state captured")
	}

	// Parse and extend with Nostr fields
	var localState tss.LocalState
	if err := json.Unmarshal([]byte(result), &localState); err != nil {
		return "", fmt.Errorf("parse local state: %w", err)
	}

	// Create extended state with Nostr fields
	localStateNostr := tss.LocalStateNostr{
		LocalState: localState,
		NostrNpub:  localNpub,
	}

	// Encrypt and store nsec
	if err := localStateNostr.SetNsec(cfg.LocalNsec); err != nil {
		return "", fmt.Errorf("encrypt nsec: %w", err)
	}

	// Marshal final result
	finalJSON, err := json.MarshalIndent(localStateNostr, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal result: %w", err)
	}

	return string(finalJSON), nil
}

// nostrLocalStateAccessor implements tss.LocalStateAccessor for Nostr keygen.
type nostrLocalStateAccessor struct {
	saveFunc func(pubKey, state string) error
}

func (a *nostrLocalStateAccessor) GetLocalState(pubKey string) (string, error) {
	return "", fmt.Errorf("GetLocalState not supported in Nostr keygen")
}

func (a *nostrLocalStateAccessor) SaveLocalState(pubKey, localState string) error {
	if a.saveFunc != nil {
		return a.saveFunc(pubKey, localState)
	}
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
