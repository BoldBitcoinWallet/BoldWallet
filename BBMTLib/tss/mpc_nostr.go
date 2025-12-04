package tss

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/chaincfg/chainhash"
	"github.com/btcsuite/btcd/txscript"
	"github.com/btcsuite/btcd/wire"
	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
)

// decodeNsecFromBech32 decodes a bech32 nsec to hex, or returns the input if it's already hex.
func decodeNsecFromBech32(nsec string) (string, error) {
	if strings.HasPrefix(nsec, "nsec1") {
		prefix, decoded, err := nip19.Decode(nsec)
		if err != nil {
			return "", fmt.Errorf("failed to decode nsec: %w", err)
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
	// Assume it's already hex
	return nsec, nil
}

// DeriveNpubFromNsec derives a bech32 npub from a bech32 nsec (or hex nsec).
// This function handles both bech32 (nsec1...) and hex formats.
func DeriveNpubFromNsec(partyNsec string) (string, error) {
	// Decode nsec from bech32 to hex if needed
	skHex, err := decodeNsecFromBech32(partyNsec)
	if err != nil {
		return "", err
	}

	// Derive npub from nsec (in hex)
	pkHex, err := nostr.GetPublicKey(skHex)
	if err != nil {
		return "", fmt.Errorf("failed to derive npub from nsec: %w", err)
	}

	// Encode npub to bech32
	npub, err := nip19.EncodePublicKey(pkHex)
	if err != nil {
		return "", fmt.Errorf("failed to encode npub: %w", err)
	}

	return npub, nil
}

// NostrKeypair generates a new Nostr keypair and returns it as JSON string.
// Returns: {"nsec": "...", "npub": "..."}
// Both nsec and npub are returned in bech32 format (nsec1... and npub1...)
func NostrKeypair() (string, error) {
	// Generate private key in hex format
	skHex := nostr.GeneratePrivateKey()

	// Get public key in hex format
	pkHex, err := nostr.GetPublicKey(skHex)
	if err != nil {
		return "", fmt.Errorf("failed to generate npub: %w", err)
	}

	// Convert to bech32 format
	nsec, err := nip19.EncodePrivateKey(skHex)
	if err != nil {
		return "", fmt.Errorf("failed to encode nsec: %w", err)
	}

	npub, err := nip19.EncodePublicKey(pkHex)
	if err != nil {
		return "", fmt.Errorf("failed to encode npub: %w", err)
	}

	result := map[string]string{
		"nsec": nsec,
		"npub": npub,
	}
	jsonBytes, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("failed to marshal keypair: %w", err)
	}
	return string(jsonBytes), nil
}

// HexToNpub converts a hex public key to bech32 npub format.
func HexToNpub(hexKey string) (string, error) {
	// Decode hex string to bytes
	pkHex, err := hex.DecodeString(hexKey)
	if err != nil {
		return "", fmt.Errorf("failed to decode hex key: %w", err)
	}

	// Encode to bech32 npub
	npub, err := nip19.EncodePublicKey(hex.EncodeToString(pkHex))
	if err != nil {
		return "", fmt.Errorf("failed to encode npub: %w", err)
	}

	return npub, nil
}

// NostrJoinKeygen performs a Nostr-based keygen and returns the keyshare JSON.
// Parameters:
//   - relaysCSV: Comma-separated list of Nostr relay URLs (wss://...)
//   - partyNsec: Local party's Nostr secret key (nsec1... in bech32 format)
//   - partiesNpubsCSV: Comma-separated list of all party npubs (including self, in bech32 format npub1...)
//   - sessionID: Session identifier
//   - sessionKey: Session encryption key in hex
//   - chaincode: Chain code in hex
//   - ppmPath: Path to pre-params file (optional, empty string means generate new pre-params)
func NostrJoinKeygen(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, chaincode, ppmPath string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in NostrJoinKeygen: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	// Initialize status tracking (similar to JoinKeygen)
	status := Status{Step: 0, SeqNo: 0, Index: 0, Info: "initializing...", Type: "keygen", Done: false, Time: 0}
	setStatus(sessionID, status)

	// Derive npub from nsec (handles bech32 format)
	localNpub, err := DeriveNpubFromNsec(partyNsec)
	if err != nil {
		return "", err
	}

	Logln("BBMTLog", "start Nostr keygen", sessionID, "...")
	status.Step++
	status.Info = "start Nostr keygen"
	setStatus(sessionID, status)

	// Parse relays
	relays := strings.Split(relaysCSV, ",")
	for i := range relays {
		relays[i] = strings.TrimSpace(relays[i])
	}

	// Parse peer npubs
	allParties := strings.Split(partiesNpubsCSV, ",")
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
		SessionID:     sessionID,
		SessionKeyHex: sessionKey,
		LocalNpub:     localNpub,
		LocalNsec:     partyNsec,
		PeersNpub:     peersNpub,
		MaxTimeout:    90 * time.Second,
	}
	cfg.ApplyDefaults()

	if err := cfg.Validate(); err != nil {
		return "", fmt.Errorf("invalid config: %w", err)
	}

	// Run keygen with pre-params path
	return runNostrKeygenInternal(cfg, chaincode, ppmPath, localNpub, sessionID)
}

// NostrJoinKeysignWithSighash performs a Nostr-based keysign with a base64-encoded sighash (already a hash).
// This is used for Bitcoin transaction signing where the sighash is already computed.
func NostrJoinKeysignWithSighash(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, derivationPath, sighashBase64 string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in NostrJoinKeysignWithSighash: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	// Derive npub from nsec (handles bech32 format)
	localNpub, err := DeriveNpubFromNsec(partyNsec)
	if err != nil {
		return "", err
	}

	// Parse keyshare JSON
	var keyshare LocalStateNostr
	if err := json.Unmarshal([]byte(keyshareJSON), &keyshare); err != nil {
		return "", fmt.Errorf("failed to parse keyshare JSON: %w", err)
	}

	// Verify npub matches
	if keyshare.NostrNpub != localNpub {
		return "", fmt.Errorf("keyshare npub (%s) does not match derived npub (%s)", keyshare.NostrNpub, localNpub)
	}

	// Parse relays
	relays := strings.Split(relaysCSV, ",")
	for i := range relays {
		relays[i] = strings.TrimSpace(relays[i])
	}

	// Parse peer npubs
	allParties := strings.Split(partiesNpubsCSV, ",")
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

	Logf("NostrJoinKeysignWithSighash: sessionID=%s, localNpub=%s, allParties=%v, peersNpub=%v", sessionID, localNpub, allParties, peersNpub)

	// Create config
	cfg := nostrtransport.Config{
		Relays:        relays,
		SessionID:     sessionID,
		SessionKeyHex: sessionKey,
		LocalNpub:     localNpub,
		LocalNsec:     partyNsec,
		PeersNpub:     peersNpub,
		MaxTimeout:    90 * time.Second,
	}
	cfg.ApplyDefaults()

	if err := cfg.Validate(); err != nil {
		return "", fmt.Errorf("invalid config: %w", err)
	}

	// Run keysign with base64-encoded sighash (no hashing)
	return runNostrKeysignInternalWithSighash(cfg, &keyshare, derivationPath, sighashBase64, allParties)
}

// NostrJoinKeysign performs a Nostr-based keysign and returns the signature JSON.
// The message will be hashed internally before signing.
func NostrJoinKeysign(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, derivationPath, message string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in NostrJoinKeysign: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	// Derive npub from nsec (handles bech32 format)
	localNpub, err := DeriveNpubFromNsec(partyNsec)
	if err != nil {
		return "", err
	}

	// Parse keyshare JSON
	var keyshare LocalStateNostr
	if err := json.Unmarshal([]byte(keyshareJSON), &keyshare); err != nil {
		return "", fmt.Errorf("failed to parse keyshare JSON: %w", err)
	}

	// Verify npub matches
	if keyshare.NostrNpub != localNpub {
		return "", fmt.Errorf("keyshare npub (%s) does not match derived npub (%s)", keyshare.NostrNpub, localNpub)
	}

	// Parse relays
	relays := strings.Split(relaysCSV, ",")
	for i := range relays {
		relays[i] = strings.TrimSpace(relays[i])
	}

	// Parse peer npubs
	allParties := strings.Split(partiesNpubsCSV, ",")
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
		SessionID:     sessionID,
		SessionKeyHex: sessionKey,
		LocalNpub:     localNpub,
		LocalNsec:     partyNsec,
		PeersNpub:     peersNpub,
		MaxTimeout:    90 * time.Second,
	}
	cfg.ApplyDefaults()

	if err := cfg.Validate(); err != nil {
		return "", fmt.Errorf("invalid config: %w", err)
	}

	// Run keysign
	return runNostrKeysignInternal(cfg, &keyshare, derivationPath, message, allParties)
}

// preAgreementResult holds the results of the pre-agreement phase
type preAgreementResult struct {
	fullNonce   string
	averageFees int64
}

// runNostrPreAgreementSendBTC performs a pre-agreement phase internally.
// Both parties exchange their peerNonce and satoshiFees, then agree on:
// - fullNonce: sorted join of both peerNonces (like in keygen)
// - averageFees: average of both satoshiFees
func runNostrPreAgreementSendBTC(relaysCSV, partyNsec, partiesNpubsCSV, sessionFlag string, localSatoshiFees int64) (result *preAgreementResult, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in runNostrPreAgreementSendBTC: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = nil
		}
	}()

	Logln("BBMTLog", "invoking runNostrPreAgreementSendBTC...")

	// Derive npub from nsec (handles bech32 format)
	localNpub, err := DeriveNpubFromNsec(partyNsec)
	if err != nil {
		return nil, err
	}

	// Parse relays
	relays := strings.Split(relaysCSV, ",")
	for i := range relays {
		relays[i] = strings.TrimSpace(relays[i])
	}

	// Parse peer npubs
	allParties := strings.Split(partiesNpubsCSV, ",")
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

	if len(peersNpub) != 1 {
		return nil, fmt.Errorf("pre-agreement requires exactly 1 peer, got %d", len(peersNpub))
	}
	peerNpub := peersNpub[0]

	// Generate session key from sessionFlag (deterministic)
	sessionKey, err := Sha256(sessionFlag)
	if err != nil {
		return nil, fmt.Errorf("failed to generate session key: %w", err)
	}

	// Generate random peerNonce
	peerNonce, err := SecureRandom(64)
	if err != nil {
		return nil, fmt.Errorf("failed to generate peerNonce: %w", err)
	}

	Logf("runNostrPreAgreementSendBTC: sessionFlag=%s, localNpub=%s, peerNpub=%s, peerNonce=%s, localFees=%d",
		sessionFlag, localNpub, peerNpub, peerNonce, localSatoshiFees)

	// Create config for pre-agreement (using sessionFlag as sessionID)
	cfg := nostrtransport.Config{
		Relays:        relays,
		SessionID:     sessionFlag,
		SessionKeyHex: sessionKey,
		LocalNpub:     localNpub,
		LocalNsec:     partyNsec,
		PeersNpub:     peersNpub,
		MaxTimeout:    60 * time.Second,
	}
	cfg.ApplyDefaults()

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	// Create client and messenger
	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create client: %w", err)
	}
	defer client.Close("pre-agreement complete")

	messenger := nostrtransport.NewMessenger(cfg, client)

	// Prepare our message: <peerNonce>:<satoshiFees>
	localMessage := fmt.Sprintf("%s:%d", peerNonce, localSatoshiFees)
	Logf("runNostrPreAgreementSendBTC: sending message: %s", localMessage)

	// Context for the pre-agreement phase
	// Timeout: 2 minutes (120 seconds) to allow for:
	// - Network delays
	// - Retroactive message processing (messages sent before we started listening)
	// - Relay synchronization delays
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Channel to receive peer's message
	peerMessageCh := make(chan string, 1)
	peerErrorCh := make(chan error, 1)

	// Start listening for peer's message
	// Note: The MessagePump will receive messages that match the session tag,
	// including messages that were sent before we started listening (if they're
	// still in the relay's cache, typically last 1-2 minutes)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				errMsg := fmt.Sprintf("PANIC in runNostrPreAgreementSendBTC goroutine: %v", r)
				Logf("BBMTLog: %s", errMsg)
				Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
				select {
				case peerErrorCh <- fmt.Errorf("internal error (panic): %v", r):
				default:
				}
			}
		}()

		// Create message pump to receive messages
		pump := nostrtransport.NewMessagePump(cfg, client)
		err := pump.Run(ctx, func(payload []byte) error {
			peerMessage := string(payload)
			Logf("runNostrPreAgreementSendBTC: received peer message: %s", peerMessage)
			select {
			case peerMessageCh <- peerMessage:
			default:
			}
			return nil // Signal we got the message
		})
		if err != nil && err != context.Canceled {
			select {
			case peerErrorCh <- err:
			default:
			}
		}
	}()

	// Small delay to ensure subscription is active before sending
	time.Sleep(1 * time.Second)

	// Send our message to peer
	err = messenger.SendMessage(ctx, localNpub, peerNpub, localMessage)
	if err != nil {
		return nil, fmt.Errorf("failed to send pre-agreement message: %w", err)
	}
	Logf("runNostrPreAgreementSendBTC: sent message to peer")

	// Wait for peer's message
	var peerMessage string
	select {
	case peerMessage = <-peerMessageCh:
		Logf("runNostrPreAgreementSendBTC: received peer message: %s", peerMessage)
	case err := <-peerErrorCh:
		return nil, fmt.Errorf("failed to receive peer message: %w", err)
	case <-ctx.Done():
		return nil, fmt.Errorf("timeout waiting for peer message: %w", ctx.Err())
	}

	// Parse peer's message: <peerNonce>:<satoshiFees>
	parts := strings.Split(peerMessage, ":")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid peer message format: expected 'nonce:fees', got: %s", peerMessage)
	}
	peerNonceReceived := strings.TrimSpace(parts[0])
	peerFeesStr := strings.TrimSpace(parts[1])
	peerFees, err := strconv.ParseInt(peerFeesStr, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid peer fees format: %s", peerFeesStr)
	}

	Logf("runNostrPreAgreementSendBTC: parsed peer message - nonce=%s, fees=%d", peerNonceReceived, peerFees)

	// Calculate fullNonce: sorted join of both nonces (like in keygen)
	allNonces := []string{peerNonce, peerNonceReceived}
	sort.Strings(allNonces)
	fullNonce := strings.Join(allNonces, ",")

	// Calculate average fees
	averageFees := (localSatoshiFees + peerFees) / 2

	Logf("runNostrPreAgreementSendBTC: fullNonce=%s, averageFees=%d", fullNonce, averageFees)

	return &preAgreementResult{
		fullNonce:   fullNonce,
		averageFees: averageFees,
	}, nil
}

// NostrPreAgreementSendBTC performs a pre-agreement phase before starting the MPC send BTC.
// This is kept for backward compatibility but is now deprecated - use NostrMpcSendBTC which includes pre-agreement.
// Both parties exchange their peerNonce and satoshiFees, then agree on:
// - fullNonce: sorted join of both peerNonces (like in keygen)
// - averageFees: average of both satoshiFees
// Returns JSON: {"fullNonce": "...", "averageFees": 1234}
func NostrPreAgreementSendBTC(relaysCSV, partyNsec, partiesNpubsCSV, sessionFlag string, localSatoshiFees int64) (string, error) {
	result, err := runNostrPreAgreementSendBTC(relaysCSV, partyNsec, partiesNpubsCSV, sessionFlag, localSatoshiFees)
	if err != nil {
		return "", err
	}

	// Return JSON result for backward compatibility
	resultJSON := map[string]interface{}{
		"fullNonce":   result.fullNonce,
		"averageFees": result.averageFees,
	}
	jsonBytes, err := json.Marshal(resultJSON)
	if err != nil {
		return "", fmt.Errorf("failed to marshal result: %w", err)
	}

	return string(jsonBytes), nil
}

// NostrMpcSendBTC performs a Nostr-based MPC Bitcoin transaction.
// This function is analogous to MpcSendBTC but uses Nostr transport for keysign operations.
// It internally performs pre-agreement to establish sessionID and unified fees.
// Parameters:
//   - npubsSorted: Comma-separated sorted list of all party npubs (for sessionFlag calculation)
//   - balanceSats: Balance in satoshis (for sessionFlag calculation)
//   - amountSatoshi: Transaction amount in satoshis (for sessionFlag calculation)
func NostrMpcSendBTC(relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, balanceSats, keyshareJSON, derivePath, publicKey, senderAddress, receiverAddress string, amountSatoshi, estimatedFee int64) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in NostrMpcSendBTC: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	return runNostrMpcSendBTCInternal(relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, balanceSats, keyshareJSON, derivePath, publicKey, senderAddress, receiverAddress, amountSatoshi, estimatedFee)
}

// runNostrMpcSendBTCInternal implements the Nostr-based MPC Bitcoin transaction.
// This is analogous to MpcSendBTC but uses NostrJoinKeysign instead of JoinKeysign.
// It performs pre-agreement internally to establish sessionID and unified fees.
func runNostrMpcSendBTCInternal(relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, balanceSats, keyshareJSON, derivePath, publicKey, senderAddress, receiverAddress string, amountSatoshi, estimatedFee int64) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in runNostrMpcSendBTCInternal: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	Logln("BBMTLog", "invoking NostrMpcSendBTC...")

	// Step 1: Calculate sessionFlag for pre-agreement
	// Format: sha256(npubsSorted,balanceSats,satoshiAmount)
	sessionFlag, err := Sha256(fmt.Sprintf("%s,%s,%d", npubsSorted, balanceSats, amountSatoshi))
	if err != nil {
		return "", fmt.Errorf("failed to calculate sessionFlag: %w", err)
	}
	Logf("NostrMpcSendBTC: calculated sessionFlag=%s", sessionFlag)

	// Step 2: Perform pre-agreement to exchange nonces and fees
	mpcHook("pre-agreement phase", sessionFlag, "", 0, 0, false)
	preAgreement, err := runNostrPreAgreementSendBTC(relaysCSV, partyNsec, partiesNpubsCSV, sessionFlag, estimatedFee)
	if err != nil {
		return "", fmt.Errorf("pre-agreement failed: %w", err)
	}
	Logf("NostrMpcSendBTC: pre-agreement completed - fullNonce=%s, averageFees=%d", preAgreement.fullNonce, preAgreement.averageFees)

	// Step 3: Calculate actual sessionID using fullNonce (like in keygen)
	// Format: sha256(npubsSorted,balanceSats,satoshiAmount,fullNonce)
	sessionID, err := Sha256(fmt.Sprintf("%s,%s,%d,%s", npubsSorted, balanceSats, amountSatoshi, preAgreement.fullNonce))
	if err != nil {
		return "", fmt.Errorf("failed to calculate sessionID: %w", err)
	}

	// Step 4: Generate session key from sessionID
	// Format: sha256(npubsSorted,sessionID) - same pattern as keygen
	sessionKey, err := Sha256(fmt.Sprintf("%s,%s", npubsSorted, sessionID))
	if err != nil {
		return "", fmt.Errorf("failed to calculate sessionKey: %w", err)
	}

	Logf("NostrMpcSendBTC: calculated sessionID=%s, sessionKey=%s, using agreed fees=%d", sessionID, sessionKey, preAgreement.averageFees)

	// Step 5: Use the agreed average fees instead of estimatedFee
	agreedFee := preAgreement.averageFees

	params := &chaincfg.TestNet3Params
	if _btc_net == "mainnet" {
		params = &chaincfg.MainNetParams
		Logln("Using mainnet parameters")
		mpcHook("using mainnet", sessionID, "", 0, 0, false)
	} else {
		Logln("Using testnet parameters")
		mpcHook("using testnet", sessionID, "", 0, 0, false)
	}

	pubKeyBytes, err := hex.DecodeString(publicKey)
	if err != nil {
		Logf("Error decoding public key: %v", err)
		return "", fmt.Errorf("invalid public key format: %w", err)
	}
	Logln("Public key decoded successfully")

	fromAddr, err := btcutil.DecodeAddress(senderAddress, params)
	if err != nil {
		Logf("Error decoding sender address: %v", err)
		return "", fmt.Errorf("failed to decode sender address: %w", err)
	}
	Logln("Sender address decoded successfully")

	toAddr, err := btcutil.DecodeAddress(receiverAddress, params)
	mpcHook("checking receiver address", sessionID, "", 0, 0, false)
	if err != nil {
		Logf("Error decoding receiver address: %v", err)
		return "", fmt.Errorf("failed to decode receiver address: %w", err)
	}

	Logf("Sender Address Type: %T", fromAddr)
	Logf("Receiver Address Type: %T", toAddr)

	mpcHook("fetching utxos", sessionID, "", 0, 0, false)
	utxos, err := FetchUTXOs(senderAddress)
	if err != nil {
		Logf("Error fetching UTXOs: %v", err)
		return "", fmt.Errorf("failed to fetch UTXOs: %w", err)
	}
	Logf("Fetched UTXOs: %+v", utxos)

	mpcHook("selecting utxos", sessionID, "", 0, 0, false)
	selectedUTXOs, totalAmount, err := SelectUTXOs(utxos, amountSatoshi+agreedFee, "smallest")
	if err != nil {
		Logf("Error selecting UTXOs: %v", err)
		return "", err
	}
	Logf("Selected UTXOs: %+v, Total Amount: %d", selectedUTXOs, totalAmount)

	// Create new transaction
	tx := wire.NewMsgTx(wire.TxVersion)
	Logln("New transaction created")

	// Add all inputs with RBF enabled (nSequence = 0xfffffffd)
	utxoCount := len(selectedUTXOs)
	utxoIndex := 0
	utxoSession := ""

	mpcHook("adding inputs", sessionID, utxoSession, utxoIndex, utxoCount, false)
	for _, utxo := range selectedUTXOs {
		hash, _ := chainhash.NewHashFromStr(utxo.TxID)
		outPoint := wire.NewOutPoint(hash, utxo.Vout)
		// Create input with RBF enabled (nSequence = 0xfffffffd)
		txIn := wire.NewTxIn(outPoint, nil, nil)
		txIn.Sequence = 0xfffffffd // Enable RBF
		tx.AddTxIn(txIn)
		Logf("Added UTXO to transaction with RBF enabled: %+v", utxo)
	}

	Logf("Agreed Fee: %d", agreedFee)
	if totalAmount < amountSatoshi+agreedFee {
		Logf("Insufficient funds: available %d, needed %d", totalAmount, amountSatoshi+agreedFee)
		return "", fmt.Errorf("insufficient funds: available %d, needed %d", totalAmount, amountSatoshi+agreedFee)
	}
	Logln("Sufficient funds available")

	// Add recipient output
	mpcHook("creating output script", sessionID, utxoSession, utxoIndex, utxoCount, false)
	pkScript, err := txscript.PayToAddrScript(toAddr)
	if err != nil {
		Logf("Error creating output script: %v", err)
		return "", fmt.Errorf("failed to create output script: %w", err)
	}
	tx.AddTxOut(wire.NewTxOut(amountSatoshi, pkScript))
	Logf("Added recipient output: %d satoshis to %s", amountSatoshi, receiverAddress)

	// Add change output if necessary
	changeAmount := totalAmount - amountSatoshi - agreedFee
	mpcHook("calculating change amount", sessionID, utxoSession, utxoIndex, utxoCount, false)

	if changeAmount > 546 {
		changePkScript, err := txscript.PayToAddrScript(fromAddr)
		if err != nil {
			Logf("Error creating change script: %v", err)
			return "", fmt.Errorf("failed to create change script: %w", err)
		}
		tx.AddTxOut(wire.NewTxOut(changeAmount, changePkScript))
		Logf("Added change output: %d satoshis to %s", changeAmount, senderAddress)
	}

	// Create prevOutFetcher for all inputs (needed for SegWit)
	prevOuts := make(map[wire.OutPoint]*wire.TxOut)
	for i, utxo := range selectedUTXOs {
		txOut, _, err := FetchUTXODetails(utxo.TxID, utxo.Vout)
		if err != nil {
			return "", fmt.Errorf("failed to fetch UTXO details for input %d: %w", i, err)
		}
		hash, _ := chainhash.NewHashFromStr(utxo.TxID)
		outPoint := wire.OutPoint{Hash: *hash, Index: utxo.Vout}
		prevOuts[outPoint] = txOut
	}
	prevOutFetcher := txscript.NewMultiPrevOutFetcher(prevOuts)

	// Sign each input with enhanced address type support
	mpcHook("signing inputs", sessionID, utxoSession, utxoIndex, utxoCount, false)
	for i, utxo := range selectedUTXOs {
		// update utxo session - counter
		utxoIndex = i + 1
		utxoSession = fmt.Sprintf("%s%d", sessionID, i)

		mpcHook("fetching utxo details", sessionID, utxoSession, utxoIndex, utxoCount, false)
		txOut, isWitness, err := FetchUTXODetails(utxo.TxID, utxo.Vout)
		if err != nil {
			Logf("Error fetching UTXO details: %v", err)
			return "", fmt.Errorf("failed to fetch UTXO details: %w", err)
		}

		var sigHash []byte
		hashCache := txscript.NewTxSigHashes(tx, prevOutFetcher)

		// Determine the script type and signing method
		if isWitness {
			// Handle different SegWit types
			if txscript.IsPayToWitnessPubKeyHash(txOut.PkScript) {
				// P2WPKH (Native SegWit)
				Logf("Processing P2WPKH input for index: %d", i)
				sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
				if err != nil {
					Logf("Error calculating P2WPKH witness sighash: %v", err)
					return "", fmt.Errorf("failed to calculate P2WPKH witness sighash: %w", err)
				}

				// Sign the hash using NostrJoinKeysign
				// Note: The sighash is already a hash, so we need to pass it as base64 directly
				// We'll use a helper function that accepts base64-encoded sighash
				sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
				mpcHook("joining keysign - P2WPKH", sessionID, utxoSession, utxoIndex, utxoCount, false)
				sigJSON, err := NostrJoinKeysignWithSighash(relaysCSV, partyNsec, partiesNpubsCSV, utxoSession, sessionKey, keyshareJSON, derivePath, sighashBase64)
				if err != nil {
					return "", fmt.Errorf("failed to sign P2WPKH transaction: %w", err)
				}
				if sigJSON == "" {
					return "", fmt.Errorf("failed to sign P2WPKH transaction: signature is empty")
				}

				var sig KeysignResponse
				if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
					return "", fmt.Errorf("failed to parse P2WPKH signature response: %w", err)
				}

				signature, err := hex.DecodeString(sig.DerSignature)
				if err != nil {
					return "", fmt.Errorf("failed to decode P2WPKH DER signature: %w", err)
				}

				signatureWithHashType := append(signature, byte(txscript.SigHashAll))
				tx.TxIn[i].Witness = wire.TxWitness{signatureWithHashType, pubKeyBytes}
				tx.TxIn[i].SignatureScript = nil
				Logf("P2WPKH witness set for input %d", i)

			} else if txscript.IsPayToTaproot(txOut.PkScript) {
				Logf("Taproot detected but not supported due to lack of Schnorr support in BNB-TSS.")
				return "", fmt.Errorf("taproot (P2TR) inputs are not supported for now")
			} else {
				// Generic SegWit handling (P2WSH, etc.)
				Logf("Processing generic SegWit input for index: %d", i)
				sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
				if err != nil {
					Logf("Error calculating generic witness sighash: %v", err)
					return "", fmt.Errorf("failed to calculate generic witness sighash: %w", err)
				}

				sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
				mpcHook("joining keysign - generic SegWit", sessionID, utxoSession, utxoIndex, utxoCount, false)
				sigJSON, err := NostrJoinKeysignWithSighash(relaysCSV, partyNsec, partiesNpubsCSV, utxoSession, sessionKey, keyshareJSON, derivePath, sighashBase64)
				if err != nil {
					return "", fmt.Errorf("failed to sign generic SegWit transaction: %w", err)
				}
				if sigJSON == "" {
					return "", fmt.Errorf("failed to sign generic SegWit transaction: signature is empty")
				}

				var sig KeysignResponse
				if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
					return "", fmt.Errorf("failed to parse generic SegWit signature response: %w", err)
				}

				signature, err := hex.DecodeString(sig.DerSignature)
				if err != nil {
					return "", fmt.Errorf("failed to decode generic SegWit DER signature: %w", err)
				}

				signatureWithHashType := append(signature, byte(txscript.SigHashAll))
				tx.TxIn[i].Witness = wire.TxWitness{signatureWithHashType, pubKeyBytes}
				tx.TxIn[i].SignatureScript = nil
				Logf("Generic SegWit witness set for input %d", i)
			}

		} else {
			// Handle non-SegWit types
			if txscript.IsPayToPubKeyHash(txOut.PkScript) {
				// P2PKH (Legacy)
				Logf("Processing P2PKH input for index: %d", i)
				sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, txscript.SigHashAll, tx, i)
				if err != nil {
					Logf("Error calculating P2PKH sighash: %v", err)
					return "", fmt.Errorf("failed to calculate P2PKH sighash: %w", err)
				}

				sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
				mpcHook("joining keysign - P2PKH", sessionID, utxoSession, utxoIndex, utxoCount, false)
				sigJSON, err := NostrJoinKeysignWithSighash(relaysCSV, partyNsec, partiesNpubsCSV, utxoSession, sessionKey, keyshareJSON, derivePath, sighashBase64)
				if err != nil {
					return "", fmt.Errorf("failed to sign P2PKH transaction: %w", err)
				}
				if sigJSON == "" {
					return "", fmt.Errorf("failed to sign P2PKH transaction: signature is empty")
				}

				var sig KeysignResponse
				if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
					return "", fmt.Errorf("failed to parse P2PKH signature response: %w", err)
				}

				signature, err := hex.DecodeString(sig.DerSignature)
				if err != nil {
					return "", fmt.Errorf("failed to decode P2PKH DER signature: %w", err)
				}

				signatureWithHashType := append(signature, byte(txscript.SigHashAll))
				builder := txscript.NewScriptBuilder()
				builder.AddData(signatureWithHashType)
				builder.AddData(pubKeyBytes)
				scriptSig, err := builder.Script()
				if err != nil {
					Logf("Error building P2PKH scriptSig: %v", err)
					return "", fmt.Errorf("failed to build P2PKH scriptSig: %w", err)
				}
				tx.TxIn[i].SignatureScript = scriptSig
				tx.TxIn[i].Witness = nil
				Logf("P2PKH SignatureScript set for input %d", i)

			} else if txscript.IsPayToScriptHash(txOut.PkScript) {
				// P2SH - need to determine if it's P2SH-P2WPKH or regular P2SH
				Logf("Processing P2SH input for index: %d", i)

				// For P2SH-P2WPKH, we need to construct the correct redeem script
				// The redeem script for P2SH-P2WPKH is a witness program: OP_0 <20-byte-pubkey-hash>
				pubKeyHash := btcutil.Hash160(pubKeyBytes)

				// Create the witness program (redeem script for P2SH-P2WPKH)
				redeemScript := make([]byte, 22)
				redeemScript[0] = 0x00 // OP_0
				redeemScript[1] = 0x14 // Push 20 bytes
				copy(redeemScript[2:], pubKeyHash)

				// Verify this is actually P2SH-P2WPKH by checking if the scriptHash matches
				scriptHash := btcutil.Hash160(redeemScript)
				expectedP2SHScript := make([]byte, 23)
				expectedP2SHScript[0] = 0xa9 // OP_HASH160
				expectedP2SHScript[1] = 0x14 // Push 20 bytes
				copy(expectedP2SHScript[2:22], scriptHash)
				expectedP2SHScript[22] = 0x87 // OP_EQUAL

				if bytes.Equal(txOut.PkScript, expectedP2SHScript) {
					// This is P2SH-P2WPKH
					Logf("Confirmed P2SH-P2WPKH for input %d", i)

					// Verify redeem script hash
					scriptHash := btcutil.Hash160(redeemScript)
					if len(txOut.PkScript) != 23 || txOut.PkScript[0] != 0xa9 || txOut.PkScript[22] != 0x87 {
						return "", fmt.Errorf("txOut.PkScript is not a valid P2SH script: %x", txOut.PkScript)
					}
					if !bytes.Equal(scriptHash, txOut.PkScript[2:22]) {
						return "", fmt.Errorf("redeemScript hash %x does not match P2SH script hash %x", scriptHash, txOut.PkScript[2:22])
					}

					// Calculate witness sighash using the witness program as the script
					sigHash, err = txscript.CalcWitnessSigHash(redeemScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
					if err != nil {
						Logf("Error calculating P2SH-P2WPKH witness sighash: %v", err)
						return "", fmt.Errorf("failed to calculate P2SH-P2WPKH witness sighash: %w", err)
					}

					sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
					mpcHook("joining keysign - P2SH-P2WPKH", sessionID, utxoSession, utxoIndex, utxoCount, false)
					sigJSON, err := NostrJoinKeysignWithSighash(relaysCSV, partyNsec, partiesNpubsCSV, utxoSession, sessionKey, keyshareJSON, derivePath, sighashBase64)
					if err != nil {
						return "", fmt.Errorf("failed to sign P2SH-P2WPKH transaction: %w", err)
					}
					if sigJSON == "" {
						return "", fmt.Errorf("failed to sign P2SH-P2WPKH transaction: signature is empty")
					}

					var sig KeysignResponse
					if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
						return "", fmt.Errorf("failed to parse P2SH-P2WPKH signature response: %w", err)
					}

					signature, err := hex.DecodeString(sig.DerSignature)
					if err != nil {
						return "", fmt.Errorf("failed to decode P2SH-P2WPKH DER signature: %w", err)
					}

					signatureWithHashType := append(signature, byte(txscript.SigHashAll))

					// Set SignatureScript and Witness
					// For P2SH-P2WPKH, the SignatureScript must be a canonical push of the redeemScript
					builder := txscript.NewScriptBuilder()
					builder.AddData(redeemScript)
					canonicalRedeemScriptPush, err := builder.Script()
					if err != nil {
						Logf("Error building canonical P2SH-P2WPKH scriptSig: %v", err)
						return "", fmt.Errorf("failed to build canonical P2SH-P2WPKH scriptSig: %w", err)
					}

					tx.TxIn[i].SignatureScript = canonicalRedeemScriptPush
					tx.TxIn[i].Witness = wire.TxWitness{signatureWithHashType, pubKeyBytes}
					Logf("P2SH-P2WPKH: SignatureScript and Witness set for input %d", i)
				} else {
					// This is regular P2SH (not P2SH-P2WPKH)
					Logf("Processing regular P2SH for input %d", i)
					sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, txscript.SigHashAll, tx, i)
					if err != nil {
						return "", fmt.Errorf("failed to calculate P2SH sighash: %w", err)
					}

					sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
					mpcHook("joining keysign - P2SH", sessionID, utxoSession, utxoIndex, utxoCount, false)
					sigJSON, err := NostrJoinKeysignWithSighash(relaysCSV, partyNsec, partiesNpubsCSV, utxoSession, sessionKey, keyshareJSON, derivePath, sighashBase64)
					if err != nil {
						return "", fmt.Errorf("failed to sign P2SH transaction: %w", err)
					}
					if sigJSON == "" {
						return "", fmt.Errorf("failed to sign P2SH transaction: signature is empty")
					}

					var sig KeysignResponse
					if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
						return "", fmt.Errorf("failed to parse P2SH signature response: %w", err)
					}

					signature, err := hex.DecodeString(sig.DerSignature)
					if err != nil {
						return "", fmt.Errorf("failed to decode P2SH DER signature: %w", err)
					}

					signatureWithHashType := append(signature, byte(txscript.SigHashAll))

					// For regular P2SH, build the scriptSig with signature + pubkey + redeem script
					builder := txscript.NewScriptBuilder()
					builder.AddData(signatureWithHashType)
					builder.AddData(pubKeyBytes)
					// Note: For a complete P2SH implementation, you'd need the actual redeem script here
					// This is simplified for P2PKH-like redeem scripts
					scriptSig, err := builder.Script()
					if err != nil {
						return "", fmt.Errorf("failed to build P2SH scriptSig: %w", err)
					}
					tx.TxIn[i].SignatureScript = scriptSig
					tx.TxIn[i].Witness = nil
					Logf("Regular P2SH SignatureScript set for input %d", i)
				}
			} else {
				// Unknown script type
				return "", fmt.Errorf("unsupported script type for input %d", i)
			}
		}

		// Script validation with proper prevOutFetcher
		mpcHook("validating tx script", sessionID, utxoSession, utxoIndex, utxoCount, false)
		vm, err := txscript.NewEngine(
			txOut.PkScript,
			tx,
			i,
			txscript.StandardVerifyFlags,
			nil,
			hashCache,
			txOut.Value,
			prevOutFetcher,
		)
		if err != nil {
			Logf("Error creating script engine for input %d: %v", i, err)
			return "", fmt.Errorf("failed to create script engine for input %d: %w", i, err)
		}
		if err := vm.Execute(); err != nil {
			Logf("Script validation failed for input %d: %v", i, err)
			return "", fmt.Errorf("script validation failed for input %d: %w", i, err)
		}
		Logf("Script validation succeeded for input %d", i)
	}

	// Serialize and broadcast
	mpcHook("serializing tx", sessionID, utxoSession, utxoIndex, utxoCount, false)
	var signedTx bytes.Buffer
	if err := tx.Serialize(&signedTx); err != nil {
		Logf("Error serializing transaction: %v", err)
		return "", fmt.Errorf("failed to serialize transaction: %w", err)
	}

	rawTx := hex.EncodeToString(signedTx.Bytes())
	Logln("Raw Transaction:", rawTx)

	txid, err := PostTx(rawTx)
	if err != nil {
		Logf("Error broadcasting transaction: %v", err)
		return "", fmt.Errorf("failed to broadcast transaction: %w", err)
	}
	mpcHook("txid:"+txid, sessionID, utxoSession, utxoIndex, utxoCount, true)
	Logf("Transaction broadcasted successfully, txid: %s", txid)
	return txid, nil
}

// runNostrKeygenInternal is the internal implementation of Nostr keygen.
func runNostrKeygenInternal(cfg nostrtransport.Config, chaincode, ppmPath, localNpub, sessionID string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in runNostrKeygenInternal: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), cfg.MaxTimeout)
	defer cancel()

	// Get current status and increment step
	status := getStatus(sessionID)
	setStep(sessionID, "creating Nostr client", status.Step+1)

	// Create Nostr client
	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return "", fmt.Errorf("create client: %w", err)
	}
	defer client.Close("keygen complete")

	// Create session coordinator
	coordinator := nostrtransport.NewSessionCoordinator(cfg, client)

	Logln("BBMTLog", "publishing readiness...")
	status = getStatus(sessionID)
	setStep(sessionID, "publishing readiness", status.Step+1)

	// Publish readiness
	if err := coordinator.PublishReady(ctx); err != nil {
		return "", fmt.Errorf("publish ready: %w", err)
	}

	// Small delay to allow events to propagate
	time.Sleep(500 * time.Millisecond)

	Logln("BBMTLog", "waiting for peers...")
	status = getStatus(sessionID)
	setStep(sessionID, "waiting for peers", status.Step+1)

	// Wait for all peers
	if err := coordinator.AwaitPeers(ctx); err != nil {
		return "", fmt.Errorf("await peers: %w", err)
	}

	status = getStatus(sessionID)
	status.SeqNo++
	status.Index++
	setStatus(sessionID, status)

	Logln("BBMTLog", "creating messenger and adapter...")
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

	Logln("BBMTLog", "local state accessor loaded...")
	status = getStatus(sessionID)
	setStep(sessionID, "local state loaded", status.Step+1)

	Logln("BBMTLog", "preparing NewService on ppmPath...")
	status = getStatus(sessionID)
	setStep(sessionID, "preparing TSS service", status.Step+1)

	// Create TSS service
	tssService, err := NewService(messengerAdapter, stateAccessor, true, ppmPath)
	if err != nil {
		return "", fmt.Errorf("create TSS service: %w", err)
	}

	Logln("BBMTLog", "starting message pump...")
	// Create message pump
	pump := nostrtransport.NewMessagePump(cfg, client)
	pumpCtx, pumpCancel := context.WithTimeout(ctx, cfg.MaxTimeout)
	defer pumpCancel()

	// Run pump in background
	pumpErrCh := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				errMsg := fmt.Sprintf("PANIC in runNostrKeygenInternal pump goroutine: %v", r)
				Logf("BBMTLog: %s", errMsg)
				Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
				select {
				case pumpErrCh <- fmt.Errorf("internal error (panic): %v", r):
				default:
				}
			}
		}()

		err := pump.Run(pumpCtx, func(payload []byte) error {
			// Get current status to access SeqNo and Index
			status := getStatus(sessionID)
			status.Step++
			status.Index++
			status.Info = fmt.Sprintf("Received Message %d", status.Index)
			setIndex(sessionID, status.Info, status.Step, status.Index)
			setStep(sessionID, status.Info, status.Step)
			return tssService.ApplyData(string(payload))
		})
		if err != nil && err != context.Canceled && err != context.DeadlineExceeded {
			pumpErrCh <- err
		} else {
			Logln("BBMTLog", "Message applied")
			status.Step++
			status.Info = fmt.Sprintf("Applied Message %d", status.Index)
			setStep(sessionID, status.Info, status.Step)
		}
	}()

	Logln("BBMTLog", "doing ECDSA keygen...")
	status = getStatus(sessionID)
	setStep(sessionID, "running ECDSA keygen", status.Step+1)

	// Run keygen
	allParties := append([]string{localNpub}, cfg.PeersNpub...)
	partiesCSV := strings.Join(allParties, ",")
	_, err = tssService.KeygenECDSA(&KeygenRequest{
		LocalPartyID: localNpub,
		AllParties:   partiesCSV,
		ChainCodeHex: chaincode,
	})
	if err != nil {
		pumpCancel()
		return "", fmt.Errorf("keygen failed: %w", err)
	}

	Logln("BBMTLog", "ECDSA keygen response ok")
	status = getStatus(sessionID)
	setStep(sessionID, "keygen ok", status.Step+1)

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
		Logln("BBMTLog", "Warning: failed to publish completion:", err)
	}

	status = getStatus(sessionID)
	status.Step++
	status.Info = "session ended"
	setStatus(sessionID, status)

	status = getStatus(sessionID)
	status.Step++
	status.Info = "local party complete"
	status.Done = true
	setStatus(sessionID, status)

	// Get the saved local state
	localStateMu.Lock()
	result = localStateJSON
	localStateMu.Unlock()

	Logln("BBMTLog", "========== DONE ==========")

	if result == "" {
		return "", fmt.Errorf("no local state captured")
	}

	// Parse and extend with Nostr fields
	var localState LocalState
	if err := json.Unmarshal([]byte(result), &localState); err != nil {
		return "", fmt.Errorf("parse local state: %w", err)
	}

	// Create extended state with Nostr fields
	localStateNostr := LocalStateNostr{
		LocalState: localState,
		NostrNpub:  localNpub,
	}

	// Store nsec
	if err := localStateNostr.SetNsec(cfg.LocalNsec); err != nil {
		return "", fmt.Errorf("set nsec: %w", err)
	}

	// Marshal final result
	finalJSON, err := json.MarshalIndent(localStateNostr, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal result: %w", err)
	}

	return string(finalJSON), nil
}

// runNostrKeysignInternal is the internal implementation of Nostr keysign.
func runNostrKeysignInternal(cfg nostrtransport.Config, keyshare *LocalStateNostr, derivePath, message string, allParties []string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in runNostrKeysignInternal: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()
	sessionID := cfg.SessionID

	// Initialize status tracking
	status := Status{Step: 0, SeqNo: 0, Index: 0, Info: "initializing...", Type: "keysign", Done: false, Time: 0}
	setStatus(sessionID, status)

	ctx, cancel := context.WithTimeout(context.Background(), cfg.MaxTimeout)
	defer cancel()

	// Create Nostr client
	status.Step++
	status.Info = "creating Nostr client"
	setStep(sessionID, status.Info, status.Step)
	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return "", fmt.Errorf("create client: %w", err)
	}
	defer client.Close("keysign complete")

	// Create session coordinator
	coordinator := nostrtransport.NewSessionCoordinator(cfg, client)

	// Publish readiness
	status.Step++
	status.Info = "publishing ready"
	setStep(sessionID, status.Info, status.Step)
	if err := coordinator.PublishReady(ctx); err != nil {
		return "", fmt.Errorf("publish ready: %w", err)
	}

	// Small delay to allow events to propagate (same as keygen)
	time.Sleep(500 * time.Millisecond)

	// Wait for all peers
	status.Step++
	status.Info = "waiting for peers"
	setStep(sessionID, status.Info, status.Step)
	Logln("BBMTLog", "waiting for peers...")
	if err := coordinator.AwaitPeers(ctx); err != nil {
		return "", fmt.Errorf("await peers: %w", err)
	}

	// Peers are ready, increment SeqNo and Index
	status.SeqNo++
	status.Index++
	status.Step++
	status.Info = "peers ready"
	setSeqNo(sessionID, status.Info, status.Step, status.SeqNo)

	// Create messenger and adapter (inline to avoid import cycle)
	status.Step++
	status.Info = "creating messenger"
	setStep(sessionID, status.Info, status.Step)
	messenger := nostrtransport.NewMessenger(cfg, client)
	messengerAdapter := &nostrMessengerAdapter{
		messenger: messenger,
		ctx:       ctx,
	}

	// Create local state accessor that returns the keyshare
	status.Step++
	status.Info = "loading local state"
	setStep(sessionID, status.Info, status.Step)
	stateAccessor := &nostrKeysignStateAccessor{
		keyshare: keyshare,
	}

	// Create TSS service
	status.Step++
	status.Info = "creating TSS service"
	setStep(sessionID, status.Info, status.Step)
	tssService, err := NewService(messengerAdapter, stateAccessor, false, "-")
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
		defer func() {
			if r := recover(); r != nil {
				errMsg := fmt.Sprintf("PANIC in keysign pump goroutine: %v", r)
				Logf("BBMTLog: %s", errMsg)
				Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
				select {
				case pumpErrCh <- fmt.Errorf("internal error (panic): %v", r):
				default:
				}
			}
		}()

		err := pump.Run(pumpCtx, func(payload []byte) error {
			// Get current status to access SeqNo and Index
			status := getStatus(sessionID)
			status.Step++
			status.Index++
			status.Info = fmt.Sprintf("Received new message %d", status.Index)
			setIndex(sessionID, status.Info, status.Step, status.Index)
			setStep(sessionID, status.Info, status.Step)
			return tssService.ApplyData(string(payload))
		})
		if err != nil && err != context.Canceled && err != context.DeadlineExceeded {
			pumpErrCh <- err
		} else {
			Logln("BBMTLog", "Message applied")
			status := getStatus(sessionID)
			status.Step++
			status.Info = fmt.Sprintf("Applied Message %d", status.Index)
			setStep(sessionID, status.Info, status.Step)
		}
	}()

	// Hash and encode message
	status.Step++
	status.Info = "hashing message"
	setStep(sessionID, status.Info, status.Step)
	messageHash, err := Sha256(message)
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

	// Use the actively participating parties (allParties) for keysign committee
	// This allows duo-mode keysign even if the keyshare was generated for 3-party MPC.
	uniqueParties := make(map[string]bool)
	keysignCommitteeKeysList := make([]string, 0, len(allParties))
	for _, party := range allParties {
		party = strings.TrimSpace(party)
		if party == "" || uniqueParties[party] {
			continue
		}
		uniqueParties[party] = true
		keysignCommitteeKeysList = append(keysignCommitteeKeysList, party)
	}
	if len(keysignCommitteeKeysList) == 0 {
		return "", fmt.Errorf("no parties specified for keysign")
	}
	keysignCommitteeKeys := strings.Join(keysignCommitteeKeysList, ",")

	// Perform keysign
	status.Step++
	status.Info = "running ECDSA keysign"
	setStep(sessionID, status.Info, status.Step)
	keysignResp, err := tssService.KeysignECDSA(&KeysignRequest{
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

	// Keysign completed successfully
	status = getStatus(sessionID)
	status.Step++
	status.Info = "keysign ok"
	setStep(sessionID, status.Info, status.Step)

	// Publish completion
	if err := coordinator.PublishComplete(ctx, "keysign"); err != nil {
		// Non-fatal
		Logln("BBMTLog", "Warning: failed to publish completion:", err)
	}

	status.Step++
	status.Info = "session ended"
	setStep(sessionID, status.Info, status.Step)

	status.Step++
	status.Info = "local party complete"
	status.Done = true
	setStatus(sessionID, status)

	// Marshal response
	resultJSON, err := json.MarshalIndent(keysignResp, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal response: %w", err)
	}

	Logln("========== DONE ==========")
	return string(resultJSON), nil
}

// runNostrKeysignInternalWithSighash is similar to runNostrKeysignInternal but accepts a base64-encoded sighash directly.
func runNostrKeysignInternalWithSighash(cfg nostrtransport.Config, keyshare *LocalStateNostr, derivePath, sighashBase64 string, allParties []string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in runNostrKeysignInternalWithSighash: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()
	sessionID := cfg.SessionID

	// Initialize status tracking
	status := Status{Step: 0, SeqNo: 0, Index: 0, Info: "initializing...", Type: "keysign", Done: false, Time: 0}
	setStatus(sessionID, status)

	ctx, cancel := context.WithTimeout(context.Background(), cfg.MaxTimeout)
	defer cancel()

	// Create Nostr client
	status.Step++
	status.Info = "creating Nostr client"
	setStep(sessionID, status.Info, status.Step)
	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return "", fmt.Errorf("create client: %w", err)
	}
	defer client.Close("keysign complete")

	// Create session coordinator
	coordinator := nostrtransport.NewSessionCoordinator(cfg, client)

	// Publish readiness
	status.Step++
	status.Info = "publishing ready"
	setStep(sessionID, status.Info, status.Step)
	Logf("runNostrKeysignInternalWithSighash: About to publish ready for session %s, localNpub=%s, peers=%v", sessionID, cfg.LocalNpub, cfg.PeersNpub)
	if err := coordinator.PublishReady(ctx); err != nil {
		Logf("runNostrKeysignInternalWithSighash: PublishReady failed: %v", err)
		return "", fmt.Errorf("publish ready: %w", err)
	}
	Logf("runNostrKeysignInternalWithSighash: PublishReady succeeded for session %s", sessionID)

	// Small delay to allow events to propagate (same as keygen)
	time.Sleep(500 * time.Millisecond)

	// Wait for all peers
	status.Step++
	status.Info = "waiting for peers"
	setStep(sessionID, status.Info, status.Step)
	Logln("BBMTLog", "waiting for peers...")
	if err := coordinator.AwaitPeers(ctx); err != nil {
		return "", fmt.Errorf("await peers: %w", err)
	}

	// Peers are ready, increment SeqNo and Index
	status.SeqNo++
	status.Index++
	status.Step++
	status.Info = "peers ready"
	setSeqNo(sessionID, status.Info, status.Step, status.SeqNo)

	// Create messenger and adapter
	status.Step++
	status.Info = "creating messenger"
	setStep(sessionID, status.Info, status.Step)
	messenger := nostrtransport.NewMessenger(cfg, client)
	messengerAdapter := &nostrMessengerAdapter{
		messenger: messenger,
		ctx:       ctx,
	}

	// Create local state accessor that returns the keyshare
	status.Step++
	status.Info = "loading local state"
	setStep(sessionID, status.Info, status.Step)
	stateAccessor := &nostrKeysignStateAccessor{
		keyshare: keyshare,
	}

	// Create TSS service
	status.Step++
	status.Info = "creating TSS service"
	setStep(sessionID, status.Info, status.Step)
	tssService, err := NewService(messengerAdapter, stateAccessor, false, "-")
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
		defer func() {
			if r := recover(); r != nil {
				errMsg := fmt.Sprintf("PANIC in keysign pump goroutine: %v", r)
				Logf("BBMTLog: %s", errMsg)
				Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
				select {
				case pumpErrCh <- fmt.Errorf("internal error (panic): %v", r):
				default:
				}
			}
		}()

		err := pump.Run(pumpCtx, func(payload []byte) error {
			// Get current status to access SeqNo and Index
			status := getStatus(sessionID)
			status.Step++
			status.Index++
			status.Info = fmt.Sprintf("Received new message %d", status.Index)
			setIndex(sessionID, status.Info, status.Step, status.Index)
			setStep(sessionID, status.Info, status.Step)
			return tssService.ApplyData(string(payload))
		})
		if err != nil && err != context.Canceled && err != context.DeadlineExceeded {
			pumpErrCh <- err
		} else {
			Logln("BBMTLog", "Message applied")
			status := getStatus(sessionID)
			status.Step++
			status.Info = fmt.Sprintf("Applied Message %d", status.Index)
			setStep(sessionID, status.Info, status.Step)
		}
	}()

	// Use the base64-encoded sighash directly (no hashing)
	messageBase64 := sighashBase64

	// Use allParties from partiesNpubsCSV (which contains only the participating parties: local + selected peer)
	// This ensures we only use 2 parties in trio mode, not all 3 from the keyshare
	keysignCommitteeKeys := strings.Join(allParties, ",")
	if keysignCommitteeKeys == "" {
		// Fallback: use keyshare's keygen committee keys if allParties is empty
		// Convert hex keys to bech32 npubs if needed (to match LocalPartyKey format)
		keysignCommitteeKeysList := make([]string, 0, len(keyshare.KeygenCommitteeKeys))
		for _, key := range keyshare.KeygenCommitteeKeys {
			if key == "" {
				continue
			}
			// If already bech32 npub, use as-is
			if strings.HasPrefix(key, "npub1") {
				keysignCommitteeKeysList = append(keysignCommitteeKeysList, key)
			} else {
				// Convert hex to bech32 npub
				npub, err := HexToNpub(key)
				if err != nil {
					Logf("Warning: failed to convert hex key %s to npub: %v, using as-is", key[:20]+"...", err)
					keysignCommitteeKeysList = append(keysignCommitteeKeysList, key)
				} else {
					keysignCommitteeKeysList = append(keysignCommitteeKeysList, npub)
				}
			}
		}
		keysignCommitteeKeys = strings.Join(keysignCommitteeKeysList, ",")
	}

	// Perform keysign
	status.Step++
	status.Info = "running ECDSA keysign"
	setStep(sessionID, status.Info, status.Step)
	keysignResp, err := tssService.KeysignECDSA(&KeysignRequest{
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

	// Keysign completed successfully
	status = getStatus(sessionID)
	status.Step++
	status.Info = "keysign ok"
	setStep(sessionID, status.Info, status.Step)

	// Publish completion
	if err := coordinator.PublishComplete(ctx, "keysign"); err != nil {
		// Non-fatal
		Logln("BBMTLog", "Warning: failed to publish completion:", err)
	}

	status.Step++
	status.Info = "session ended"
	setStep(sessionID, status.Info, status.Step)

	status.Step++
	status.Info = "local party complete"
	status.Done = true
	setStatus(sessionID, status)

	// Marshal response
	resultJSON, err := json.MarshalIndent(keysignResp, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal response: %w", err)
	}

	Logln("========== DONE ==========")
	return string(resultJSON), nil
}

// nostrLocalStateAccessor implements LocalStateAccessor for Nostr keygen.
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

// nostrKeysignStateAccessor implements LocalStateAccessor for Nostr keysign.
type nostrKeysignStateAccessor struct {
	keyshare *LocalStateNostr
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

// nostrMessengerAdapter implements Messenger interface for Nostr transport.
// This is an inline version to avoid import cycle with nostrtransport/adapter.go
type nostrMessengerAdapter struct {
	messenger *nostrtransport.Messenger
	ctx       context.Context
}

// Send implements Messenger interface.
func (a *nostrMessengerAdapter) Send(from, to, body string) error {
	cfg := a.messenger.Cfg()
	status := getStatus(cfg.SessionID)
	Logln("BBMTLog", "incremented Sent Message To OutSeqNo", status.SeqNo)
	status.Info = fmt.Sprintf("Sent Message %d", status.SeqNo)
	status.Step++
	status.SeqNo++
	setSeqNo(cfg.SessionID, status.Info, status.Step, status.SeqNo)
	setStep(cfg.SessionID, status.Info, status.Step)
	return a.messenger.SendMessage(a.ctx, from, to, body)
}
