package nostrtransport

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
)

// Event is an alias to the nostr.Event type to avoid leaking the dependency everywhere.
type Event = nostr.Event

// Filter mirrors nostr.Filter for subscriptions.
type Filter = nostr.Filter

// Client represents a thin wrapper around the go-nostr SimplePool.
type Client struct {
	cfg         Config
	pool        *nostr.SimplePool
	urls        []string
	validRelays []string // All valid relay URLs (for reference)
	ctx         context.Context
	cancel      context.CancelFunc
}

// Expose pool for querying existing events
func (c *Client) GetPool() *nostr.SimplePool {
	return c.pool
}

func NewClient(cfg Config) (*Client, error) {
	cfg.ApplyDefaults()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	pool := nostr.NewSimplePool(ctx)

	// Validate and collect relay URLs
	validRelays := make([]string, 0, len(cfg.Relays))
	for _, relayURL := range cfg.Relays {
		relayURL = strings.TrimSpace(relayURL)
		if relayURL == "" {
			continue
		}
		if !strings.HasPrefix(relayURL, "wss://") && !strings.HasPrefix(relayURL, "ws://") {
			cancel()
			return nil, fmt.Errorf("invalid relay url: %s", relayURL)
		}
		validRelays = append(validRelays, relayURL)
	}
	if len(validRelays) == 0 {
		cancel()
		return nil, errors.New("no valid relays configured")
	}

	// Try to connect to relays with resilience:
	// - If at least one connects, proceed immediately
	// - If all fail, retry after 1 second indefinitely
	// - Keep trying other relays in background after first success
	connectedURLs := make([]string, 0)
	connectedSet := make(map[string]bool)
	connectedCh := make(chan string, len(validRelays))

	// Function to try connecting to a single relay
	tryConnect := func(relayURL string) {
		relay, err := pool.EnsureRelay(relayURL)
		if err != nil {
			fmt.Fprintf(os.Stderr, "BBMTLog: Failed to connect to relay %s: %v\n", relayURL, err)
			return
		}
		// Connection successful
		fmt.Fprintf(os.Stderr, "BBMTLog: Successfully connected to relay %s\n", relayURL)
		connectedCh <- relayURL
		_ = relay // Keep reference to prevent GC
	}

	// Helper function to start background retries for remaining relays
	startBackgroundRetries := func() {
		remainingRelays := make([]string, 0)
		for _, url := range validRelays {
			if !connectedSet[url] {
				remainingRelays = append(remainingRelays, url)
			}
		}
		for _, url := range remainingRelays {
			go func(relayURL string) {
				for {
					relay, err := pool.EnsureRelay(relayURL)
					if err == nil {
						fmt.Fprintf(os.Stderr, "BBMTLog: Background connection to relay %s succeeded\n", relayURL)
						_ = relay
						return
					}
					// Wait 1 second before retry
					time.Sleep(1 * time.Second)
					// Check if context is cancelled
					select {
					case <-ctx.Done():
						return
					default:
					}
				}
			}(url)
		}
	}

	// Helper function to return client with connected relays
	returnClient := func() (*Client, error) {
		return &Client{
			cfg:         cfg,
			pool:        pool,
			urls:        connectedURLs,
			validRelays: validRelays, // Store all valid relays for reference
			ctx:         ctx,
			cancel:      cancel,
		}, nil
	}

	// Retry loop: try all relays, wait for at least one success
	attemptCount := 0
	for {
		attemptCount++
		if attemptCount > 1 {
			fmt.Fprintf(os.Stderr, "BBMTLog: Retrying relay connections (attempt %d)...\n", attemptCount)
		}

		// Count how many relays we need to try
		remainingCount := 0
		for _, relayURL := range validRelays {
			if !connectedSet[relayURL] {
				remainingCount++
			}
		}

		if remainingCount == 0 {
			// All relays already connected
			startBackgroundRetries()
			return returnClient()
		}

		// Try connecting to all remaining relays in parallel
		for _, relayURL := range validRelays {
			if !connectedSet[relayURL] {
				go tryConnect(relayURL)
			}
		}

		// Wait for at least one connection or timeout
		timeout := time.NewTimer(5 * time.Second)
		initialCount := len(connectedURLs)
		shouldRetry := false

		for {
			select {
			case relayURL := <-connectedCh:
				if !connectedSet[relayURL] {
					connectedSet[relayURL] = true
					connectedURLs = append(connectedURLs, relayURL)
					fmt.Fprintf(os.Stderr, "BBMTLog: Relay %s connected (%d/%d total)\n", relayURL, len(connectedURLs), len(validRelays))

					// If we have at least one connection, proceed but keep trying others in background
					if len(connectedURLs) > initialCount {
						timeout.Stop()
						if len(connectedURLs) == 1 {
							fmt.Fprintf(os.Stderr, "BBMTLog: First relay connected, proceeding (other relays will continue connecting in background)\n")
						} else {
							fmt.Fprintf(os.Stderr, "BBMTLog: %d relay(s) connected, proceeding (other relays will continue connecting in background)\n", len(connectedURLs))
						}
						startBackgroundRetries()
						return returnClient()
					}
				}

			case <-timeout.C:
				// Timeout reached - check if we have any new connections
				if len(connectedURLs) > initialCount {
					// We have at least one new connection, proceed
					fmt.Fprintf(os.Stderr, "BBMTLog: Timeout reached but %d relay(s) connected, proceeding\n", len(connectedURLs))
					startBackgroundRetries()
					return returnClient()
				}

				// No connections yet, wait 1 second and retry
				fmt.Fprintf(os.Stderr, "BBMTLog: No relays connected yet (attempt %d), retrying in 1 second...\n", attemptCount)
				time.Sleep(1 * time.Second)
				shouldRetry = true
			}

			if shouldRetry {
				break
			}
		}
	}
}

// Close tears down relay connections.
func (c *Client) Close(reason string) {
	if c.pool != nil {
		c.pool.Close(reason)
	}
	if c.cancel != nil {
		c.cancel()
	}
}

func (c *Client) Publish(ctx context.Context, event *Event) error {
	if event == nil {
		return errors.New("nil event")
	}

	// Decode nsec from Bech32 to hex if needed
	nsecHex := c.cfg.LocalNsec
	if strings.HasPrefix(c.cfg.LocalNsec, "nsec1") {
		prefix, decoded, err := nip19.Decode(c.cfg.LocalNsec)
		if err != nil {
			return fmt.Errorf("decode nsec failed: %w", err)
		}
		if prefix != "nsec" {
			return fmt.Errorf("invalid prefix for nsec: %s", prefix)
		}
		skHexStr, ok := decoded.(string)
		if !ok {
			return fmt.Errorf("failed to decode nsec: invalid type")
		}
		nsecHex = skHexStr
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - event kind=%d, tags=%v, nsec prefix=%s, localNpub=%s\n", event.Kind, event.Tags, c.cfg.LocalNsec[:10]+"...", c.cfg.LocalNpub)

	// Convert npub to hex if needed (Nostr events use hex pubkeys, not Bech32)
	if event.PubKey == "" {
		localNpub := c.cfg.LocalNpub
		if strings.HasPrefix(localNpub, "npub1") {
			// Decode Bech32 npub to hex
			prefix, decoded, err := nip19.Decode(localNpub)
			if err != nil {
				return fmt.Errorf("decode npub failed: %w", err)
			}
			if prefix != "npub" {
				return fmt.Errorf("invalid prefix for npub: %s", prefix)
			}
			pkHexStr, ok := decoded.(string)
			if !ok {
				return fmt.Errorf("failed to decode npub: invalid type")
			}
			event.PubKey = pkHexStr
		} else {
			// Already hex
			event.PubKey = localNpub
		}
	} else if strings.HasPrefix(event.PubKey, "npub1") {
		// Event.PubKey was set to Bech32, convert to hex
		prefix, decoded, err := nip19.Decode(event.PubKey)
		if err != nil {
			return fmt.Errorf("decode event PubKey failed: %w", err)
		}
		if prefix != "npub" {
			return fmt.Errorf("invalid prefix for event PubKey: %s", prefix)
		}
		pkHexStr, ok := decoded.(string)
		if !ok {
			return fmt.Errorf("failed to decode event PubKey: invalid type")
		}
		event.PubKey = pkHexStr
	}

	if event.CreatedAt == 0 {
		event.CreatedAt = nostr.Now()
	}

	// Sign the event (this will also set PubKey from the private key if not already set)
	// Only sign if not already signed (for gift wraps that are pre-signed)
	if event.Sig == "" {
		if err := event.Sign(nsecHex); err != nil {
			return fmt.Errorf("sign event failed: %w", err)
		}
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - signed event, PubKey (hex)=%s, tags=%v\n", event.PubKey, event.Tags)

	results := c.pool.PublishMany(ctx, c.urls, *event)
	totalRelays := len(c.urls)

	// Track results in background goroutine - return immediately on first success
	successCh := make(chan bool, 1)
	errorCh := make(chan error, 1)

	go func() {
		var successCount int
		var failureCount int
		var allErrors []error

		for {
			select {
			case <-ctx.Done():
				// Context cancelled - check if we had any successes
				if successCount > 0 {
					fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - context cancelled but %d/%d relays succeeded\n", successCount, totalRelays)
					select {
					case successCh <- true:
					default:
					}
					return
				}
				select {
				case errorCh <- ctx.Err():
				default:
				}
				return
			case res, ok := <-results:
				if !ok {
					// All relays have responded
					if successCount > 0 {
						if failureCount > 0 {
							fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - %d/%d relays succeeded, %d failed (resilient)\n", successCount, totalRelays, failureCount)
						} else {
							fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - all %d relays succeeded\n", totalRelays)
						}
						// Send success if not already sent
						select {
						case successCh <- true:
						default:
						}
					} else {
						// All relays failed
						if len(allErrors) > 0 {
							fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - all %d relays failed\n", totalRelays)
							select {
							case errorCh <- fmt.Errorf("all relays failed: %w", allErrors[0]):
							default:
							}
						} else {
							select {
							case errorCh <- fmt.Errorf("no relays responded"):
							default:
							}
						}
					}
					return
				}
				if res.Error != nil {
					failureCount++
					allErrors = append(allErrors, res.Error)
					fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - relay %s error: %v (%d/%d failed)\n", res.Relay, res.Error, failureCount, totalRelays)
				} else {
					successCount++
					fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - relay %s success (%d/%d succeeded)\n", res.Relay, successCount, totalRelays)
					// Return immediately on first success (non-blocking)
					if successCount == 1 {
						select {
						case successCh <- true:
							fmt.Fprintf(os.Stderr, "BBMTLog: Client.Publish - first relay succeeded, returning immediately (other relays continue in background)\n")
						default:
						}
					}
				}
			}
		}
	}()

	// Wait for first success or all failures
	select {
	case <-successCh:
		// At least one relay succeeded - return immediately
		// Other relays continue publishing in background
		return nil
	case err := <-errorCh:
		// All relays failed
		return err
	case <-ctx.Done():
		// Context cancelled - check if we got any success
		select {
		case <-successCh:
			return nil
		default:
			return ctx.Err()
		}
	}
}

func (c *Client) Subscribe(ctx context.Context, filter Filter) (<-chan *Event, error) {
	if len(c.urls) == 0 {
		return nil, errors.New("no relays configured")
	}
	events := make(chan *Event)

	// Use all valid relays, not just initially connected ones
	// The pool will handle connections - if a relay isn't connected yet, it will try to connect
	// This ensures we subscribe to all relays, including those that connected in background
	relaysToUse := c.validRelays
	if len(relaysToUse) == 0 {
		// Fallback to urls if validRelays not set (backward compatibility)
		relaysToUse = c.urls
	}
	relayCh := c.pool.SubscribeMany(ctx, relaysToUse, filter)

	// Track relay connection status
	connectedRelays := make(map[string]bool)
	totalRelays := len(relaysToUse)
	var connectionCheckDone bool

	// Start a goroutine to monitor connection status
	connectionCtx, connectionCancel := context.WithTimeout(ctx, 5*time.Second)
	defer connectionCancel()

	go func() {
		<-connectionCtx.Done()
		if !connectionCheckDone {
			connectionCheckDone = true
			if len(connectedRelays) == 0 {
				fmt.Fprintf(os.Stderr, "BBMTLog: Client.Subscribe - WARNING: No relays connected after 5 seconds (all %d relays may have failed)\n", totalRelays)
			} else if len(connectedRelays) < totalRelays {
				fmt.Fprintf(os.Stderr, "BBMTLog: Client.Subscribe - %d/%d relays connected\n", len(connectedRelays), totalRelays)
			}
		}
	}()

	go func() {
		defer close(events)
		for {
			select {
			case <-ctx.Done():
				return
			case relayEvent, ok := <-relayCh:
				if !ok {
					// Channel closed - check if we ever got any connections
					connectionCheckDone = true
					if len(connectedRelays) == 0 {
						fmt.Fprintf(os.Stderr, "BBMTLog: Client.Subscribe - ERROR: All %d relays failed to connect or disconnected\n", totalRelays)
					} else {
						fmt.Fprintf(os.Stderr, "BBMTLog: Client.Subscribe - subscription closed (%d/%d relays were connected)\n", len(connectedRelays), totalRelays)
					}
					return
				}
				// Get relay URL for tracking
				var relayURL string
				if relayEvent.Relay != nil {
					relayURL = relayEvent.Relay.URL
				}

				if relayEvent.Event == nil {
					// Track relay connection (even if no event yet, the relay is responding)
					if relayURL != "" {
						if !connectedRelays[relayURL] {
							connectedRelays[relayURL] = true
							fmt.Fprintf(os.Stderr, "BBMTLog: Client.Subscribe - relay %s connected (%d/%d)\n", relayURL, len(connectedRelays), totalRelays)
						}
					}
					continue
				}
				// Track relay connection when we receive an event
				if relayURL != "" {
					if !connectedRelays[relayURL] {
						connectedRelays[relayURL] = true
						fmt.Fprintf(os.Stderr, "BBMTLog: Client.Subscribe - relay %s connected (%d/%d)\n", relayURL, len(connectedRelays), totalRelays)
					}
				}
				select {
				case events <- relayEvent.Event:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return events, nil
}

// PublishWrap publishes a pre-signed gift wrap event (kind:1059)
func (c *Client) PublishWrap(ctx context.Context, wrap *Event) error {
	if wrap == nil {
		return errors.New("nil wrap event")
	}

	// Ensure PubKey is set (for gift wraps, it's the wrap's one-time key)
	if wrap.PubKey == "" {
		return errors.New("wrap event missing PubKey")
	}

	// Ensure the wrap is signed
	if wrap.Sig == "" {
		return errors.New("wrap event must be pre-signed")
	}

	fmt.Fprintf(os.Stderr, "BBMTLog: Client.PublishWrap - event kind=%d, tags=%v, pubkey=%s\n", wrap.Kind, wrap.Tags, wrap.PubKey[:20]+"...")

	if wrap.CreatedAt == 0 {
		wrap.CreatedAt = nostr.Now()
	}

	results := c.pool.PublishMany(ctx, c.urls, *wrap)
	totalRelays := len(c.urls)

	// Track results in background goroutine - return immediately on first success
	successCh := make(chan bool, 1)
	errorCh := make(chan error, 1)

	go func() {
		var successCount int
		var failureCount int
		var allErrors []error

		for {
			select {
			case <-ctx.Done():
				// Context cancelled - check if we had any successes
				if successCount > 0 {
					fmt.Fprintf(os.Stderr, "BBMTLog: Client.PublishWrap - context cancelled but %d/%d relays succeeded\n", successCount, totalRelays)
					select {
					case successCh <- true:
					default:
					}
					return
				}
				if len(allErrors) > 0 {
					select {
					case errorCh <- fmt.Errorf("all relays failed: %w", allErrors[0]):
					default:
					}
				} else {
					select {
					case errorCh <- ctx.Err():
					default:
					}
				}
				return
			case res, ok := <-results:
				if !ok {
					// All relays have responded
					if successCount > 0 {
						if failureCount > 0 {
							fmt.Fprintf(os.Stderr, "BBMTLog: Client.PublishWrap - %d/%d relays succeeded, %d failed (resilient)\n", successCount, totalRelays, failureCount)
						} else {
							fmt.Fprintf(os.Stderr, "BBMTLog: Client.PublishWrap - all %d relays succeeded\n", totalRelays)
						}
						// Send success if not already sent
						select {
						case successCh <- true:
						default:
						}
					} else {
						// All relays failed
						if len(allErrors) > 0 {
							fmt.Fprintf(os.Stderr, "BBMTLog: Client.PublishWrap - all %d relays failed\n", totalRelays)
							select {
							case errorCh <- fmt.Errorf("all relays failed: %w", allErrors[0]):
							default:
							}
						} else {
							select {
							case errorCh <- fmt.Errorf("no relays responded"):
							default:
							}
						}
					}
					return
				}
				if res.Error != nil {
					failureCount++
					allErrors = append(allErrors, res.Error)
					fmt.Fprintf(os.Stderr, "BBMTLog: Client.PublishWrap - relay %s error: %v (%d/%d failed)\n", res.Relay, res.Error, failureCount, totalRelays)
				} else {
					successCount++
					fmt.Fprintf(os.Stderr, "BBMTLog: Client.PublishWrap - relay %s success (%d/%d succeeded)\n", res.Relay, successCount, totalRelays)
					// Return immediately on first success (non-blocking)
					if successCount == 1 {
						select {
						case successCh <- true:
							fmt.Fprintf(os.Stderr, "BBMTLog: Client.PublishWrap - first relay succeeded, returning immediately (other relays continue in background)\n")
						default:
						}
					}
				}
			}
		}
	}()

	// Wait for first success or all failures
	select {
	case <-successCh:
		// At least one relay succeeded - return immediately
		// Other relays continue publishing in background
		return nil
	case err := <-errorCh:
		// All relays failed
		return err
	case <-ctx.Done():
		// Context cancelled - check if we got any success
		select {
		case <-successCh:
			return nil
		default:
			return ctx.Err()
		}
	}
}
