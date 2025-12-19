package main

import (
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

var (
	toAddress      = flag.String("to-address", "", "Recipient Bitcoin address (required)")
	amountSats     = flag.String("amount-sats", "", "Amount to send in satoshis (required)")
	feeSats        = flag.String("fee-sats", "", "Fee in satoshis (required unless --preview)")
	network        = flag.String("network", "testnet3", "Network: mainnet or testnet3")
	mempoolURL     = flag.String("mempool-url", "", "Mempool API URL (required)")
	derivationPath = flag.String("derivation-path", "m/84'/1'/0'/0/0", "BIP32 derivation path")
	addressType    = flag.String("address-type", "p2wpkh", "Address type: p2pkh, p2wpkh, p2sh-p2wpkh, p2tr")
	keyshare1      = flag.String("keyshare1", "peer1.ks", "Path to first keyshare file")
	keyshare2      = flag.String("keyshare2", "peer2.ks", "Path to second keyshare file")
	passphrase1    = flag.String("passphrase1", "", "Passphrase for first keyshare (if encrypted)")
	passphrase2    = flag.String("passphrase2", "", "Passphrase for second keyshare (if encrypted)")
	preview        = flag.Bool("preview", false, "Preview mode: estimate fee only, don't send")
	help           = flag.Bool("help", false, "Show usage information")
)

func printUsage() {
	fmt.Fprintf(os.Stderr, `Usage: bold-spend [options]

Required options (unless --preview):
  --to-address <address>      Recipient Bitcoin address
  --amount-sats <amount>      Amount to send in satoshis
  --mempool-url <url>         Mempool API URL (e.g., https://mempool.space/testnet/api)

Optional options:
  --fee-sats <fee>            Fee in satoshis (required unless --preview)
  --network <mainnet|testnet3> Network to use (default: testnet3)
  --derivation-path <path>    BIP32 derivation path (default: m/84'/1'/0'/0/0)
  --address-type <type>       Address type: p2pkh, p2wpkh, p2sh-p2wpkh, p2tr (default: p2wpkh)
  --keyshare1 <path>          Path to first keyshare file (default: peer1.ks)
  --keyshare2 <path>          Path to second keyshare file (default: peer2.ks)
  --passphrase1 <phrase>      Passphrase for first keyshare (if encrypted)
  --passphrase2 <phrase>      Passphrase for second keyshare (if encrypted)
  --preview                   Preview mode: estimate fee only, don't send transaction
  --help                      Show this help message

Examples:
  # Preview fee estimate
  bold-spend --to-address tb1q... --amount-sats 10000 --network testnet3 \\
    --mempool-url https://mempool.space/testnet/api --preview

  # Send transaction
  bold-spend --to-address tb1q... --amount-sats 10000 --fee-sats 226 \\
    --network testnet3 --mempool-url https://mempool.space/testnet/api \\
    --derivation-path "m/84'/1'/0'/0/0" --address-type p2wpkh

  # With encrypted keyshares
  bold-spend --to-address tb1q... --amount-sats 10000 --fee-sats 226 \\
    --network testnet3 --mempool-url https://mempool.space/testnet/api \\
    --passphrase1 "secret1" --passphrase2 "secret2"

Notes:
  - Keyshares must exist as peer1.ks and peer2.ks by default
  - If passphrases are provided, keyshares are expected to be AES-encrypted
  - Each keyshare can have its own passphrase
`)
}

func loadAndDecryptKeyshare(filepath string, passphrase string) (string, error) {
	data, err := os.ReadFile(filepath)
	if err != nil {
		return "", fmt.Errorf("failed to read keyshare file %s: %w", filepath, err)
	}

	rawKeyshare := strings.TrimSpace(string(data))
	if rawKeyshare == "" {
		return "", fmt.Errorf("keyshare file %s is empty", filepath)
	}

	// If passphrase provided, decrypt first
	if passphrase != "" {
		hash, err := tss.Sha256(passphrase)
		if err != nil {
			return "", fmt.Errorf("failed to compute passphrase hash: %w", err)
		}

		decrypted, err := tss.AesDecrypt(rawKeyshare, hash)
		if err != nil {
			return "", fmt.Errorf("failed to decrypt keyshare: %w", err)
		}
		rawKeyshare = decrypted
	}

	// Try to decode as base64 (for .ks files), otherwise use as JSON
	var keyshareJSON []byte
	if decoded, err := base64.StdEncoding.DecodeString(rawKeyshare); err == nil {
		keyshareJSON = decoded
	} else {
		keyshareJSON = []byte(rawKeyshare)
	}

	// Return as JSON string (MpcSendBTC expects JSON string, not base64)
	return string(keyshareJSON), nil
}

func deriveSenderAddress(keyshareJSON string, derivePath string, addrType string, network string) (string, string, error) {
	// Decode keyshare (accept base64 or raw JSON)
	var keyshareData []byte
	if decoded, err := base64.StdEncoding.DecodeString(keyshareJSON); err == nil {
		keyshareData = decoded
	} else {
		keyshareData = []byte(keyshareJSON)
	}

	var keyshare struct {
		PubKey       string `json:"pub_key"`
		ChainCodeHex string `json:"chain_code_hex"`
	}
	if err := json.Unmarshal(keyshareData, &keyshare); err != nil {
		return "", "", fmt.Errorf("error parsing keyshare: %w", err)
	}
	if keyshare.PubKey == "" || keyshare.ChainCodeHex == "" {
		return "", "", fmt.Errorf("invalid keyshare: missing pub_key/chain_code_hex")
	}

	// Derive child public key
	derivedPub, err := tss.GetDerivedPubKey(keyshare.PubKey, keyshare.ChainCodeHex, derivePath, false)
	if err != nil {
		return "", "", fmt.Errorf("failed to derive pubkey: %w", err)
	}

	// Derive sender address
	var senderAddress string
	addrTypeLower := strings.ToLower(addrType)
	switch addrTypeLower {
	case "p2pkh", "legacy":
		senderAddress, err = tss.PubToP2KH(derivedPub, network)
	case "p2wpkh", "segwit", "bech32":
		senderAddress, err = tss.PubToP2WPKH(derivedPub, network)
	case "p2sh-p2wpkh", "p2sh":
		senderAddress, err = tss.PubToP2SHP2WKH(derivedPub, network)
	case "p2tr", "taproot":
		senderAddress, err = tss.PubToP2TR(derivedPub, network)
	default:
		return "", "", fmt.Errorf("unsupported address_type %q", addrType)
	}
	if err != nil {
		return "", "", fmt.Errorf("failed to derive sender address: %w", err)
	}

	return senderAddress, derivedPub, nil
}

func estimateFee(keyshare1JSON, derivationPath, addressType, toAddress, amountSats, network, mempoolURL string) (string, error) {
	// keyshare1JSON is already loaded, decrypted, and decoded by loadAndDecryptKeyshare

	// Configure network and fee policy
	if _, err := tss.UseAPI(network, mempoolURL); err != nil {
		return "", fmt.Errorf("error configuring network/API: %w", err)
	}
	if _, err := tss.UseFeePolicy("30m"); err != nil {
		return "", fmt.Errorf("error setting fee policy: %w", err)
	}

	amount, err := strconv.ParseInt(amountSats, 10, 64)
	if err != nil {
		return "", fmt.Errorf("invalid amount_sats: %w", err)
	}

	senderAddress, _, err := deriveSenderAddress(keyshare1JSON, derivationPath, addressType, network)
	if err != nil {
		return "", err
	}

	feeStr, err := tss.EstimateFees(senderAddress, toAddress, amount)
	if err != nil {
		return "", fmt.Errorf("error estimating fees: %w", err)
	}

	return feeStr, nil
}

func runMPCSpend(keyshare1Path, keyshare2Path, passphrase1, passphrase2, derivationPath, addressType, toAddress, amountSats, feeSats, network, mempoolURL string) error {
	// Configure network
	if _, err := tss.UseAPI(network, mempoolURL); err != nil {
		return fmt.Errorf("error configuring network/API: %w", err)
	}

	// Load and decrypt first keyshare to derive sender address (for display purposes)
	keyshare1JSON, err := loadAndDecryptKeyshare(keyshare1Path, passphrase1)
	if err != nil {
		return fmt.Errorf("failed to load keyshare1: %w", err)
	}
	senderAddress, _, err := deriveSenderAddress(keyshare1JSON, derivationPath, addressType, network)
	if err != nil {
		return err
	}

	fmt.Printf("Using sender address %s (type=%s, network=%s)\n", senderAddress, addressType, network)

	// Generate ephemeral transport key pairs
	keypair1, err := tss.GenerateKeyPair()
	if err != nil {
		return fmt.Errorf("failed to generate keypair1: %w", err)
	}
	keypair2, err := tss.GenerateKeyPair()
	if err != nil {
		return fmt.Errorf("failed to generate keypair2: %w", err)
	}

	var kp1, kp2 struct {
		PrivateKey string `json:"privateKey"`
		PublicKey  string `json:"publicKey"`
	}
	if err := json.Unmarshal([]byte(keypair1), &kp1); err != nil {
		return fmt.Errorf("failed to parse keypair1: %w", err)
	}
	if err := json.Unmarshal([]byte(keypair2), &kp2); err != nil {
		return fmt.Errorf("failed to parse keypair2: %w", err)
	}

	// Generate session ID
	sessionID, err := tss.SecureRandom(64)
	if err != nil {
		return fmt.Errorf("failed to generate session ID: %w", err)
	}

	// Start relay server in a goroutine (like the shell script: "bbmt relay" &)
	port := "55055"
	server := "http://127.0.0.1:" + port

	fmt.Println("Starting Relay...")
	// Run relay in a goroutine - RunRelay starts the server in its own goroutine and returns
	go func() {
		_, _ = tss.RunRelay(port)
		// RunRelay returns immediately after starting the server goroutine
		// The server will keep running until StopRelay is called
	}()

	// Ensure relay cleanup on function return
	defer func() {
		tss.StopRelay()
	}()

	// Wait for relay to start (RunRelay sleeps 1s internally, then starts server)
	// This matches the "sleep 1" in the shell script
	time.Sleep(2 * time.Second)

	party1 := "peer1"
	party2 := "peer2"
	parties := party1 + "," + party2

	// Start MPC spend for both parties in separate processes (like the shell script)
	fmt.Println("Starting MPC spend for PARTY1 and PARTY2...")

	// Get current executable path (spawn itself)
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	var wg sync.WaitGroup
	var txid1, txid2 string
	var err1, err2 error
	var mu sync.Mutex

	wg.Add(2)

	// Run party1 in a separate process (spawn itself)
	go func() {
		defer wg.Done()
		// Build command with optional passphrase
		args := []string{"spend",
			server,
			sessionID,
			party1,
			parties,
			kp2.PublicKey,  // encKey (peer's public key)
			kp1.PrivateKey, // decKey (own private key)
			keyshare1Path,  // keyshare file path (direct, no temp file)
			derivationPath,
			addressType,
			toAddress,
			amountSats,
			feeSats,
			network,
			mempoolURL,
		}
		if passphrase1 != "" {
			args = append(args, passphrase1) // Optional passphrase as last arg
		}
		cmd := exec.Command(exePath, args...)
		output, err := cmd.CombinedOutput()
		mu.Lock()
		defer mu.Unlock()
		if err != nil {
			err1 = fmt.Errorf("party1 process error: %w, output: %s", err, string(output))
			return
		}
		// Parse txid from output (format: "[peer1] Spend transaction broadcast, txid=...")
		outputStr := string(output)
		if strings.Contains(outputStr, "txid=") {
			parts := strings.Split(outputStr, "txid=")
			if len(parts) > 1 {
				txid1 = strings.TrimSpace(strings.Split(parts[1], "\n")[0])
			}
		}
	}()

	// Run party2 in a separate process (spawn itself)
	go func() {
		defer wg.Done()
		// Build command with optional passphrase
		args := []string{"spend",
			server,
			sessionID,
			party2,
			parties,
			kp1.PublicKey,  // encKey (peer's public key)
			kp2.PrivateKey, // decKey (own private key)
			keyshare2Path,  // keyshare file path (direct, no temp file)
			derivationPath,
			addressType,
			toAddress,
			amountSats,
			feeSats,
			network,
			mempoolURL,
		}
		if passphrase2 != "" {
			args = append(args, passphrase2) // Optional passphrase as last arg
		}
		cmd := exec.Command(exePath, args...)
		output, err := cmd.CombinedOutput()
		mu.Lock()
		defer mu.Unlock()
		if err != nil {
			err2 = fmt.Errorf("party2 process error: %w, output: %s", err, string(output))
			return
		}
		// Parse txid from output
		outputStr := string(output)
		if strings.Contains(outputStr, "txid=") {
			parts := strings.Split(outputStr, "txid=")
			if len(parts) > 1 {
				txid2 = strings.TrimSpace(strings.Split(parts[1], "\n")[0])
			}
		}
	}()

	// Wait for both parties to complete (like 'wait' in shell script)
	wg.Wait()

	// Check for errors
	if err1 != nil {
		return fmt.Errorf("party1 error: %w", err1)
	}
	if err2 != nil {
		return fmt.Errorf("party2 error: %w", err2)
	}

	// Both should produce the same txid
	if txid1 != "" && txid2 != "" {
		if txid1 != txid2 {
			return fmt.Errorf("txid mismatch: party1=%s, party2=%s", txid1, txid2)
		}
		fmt.Printf("\nSpend transaction broadcast, txid=%s\n", txid1)
		return nil
	}

	// At least one should have a txid
	if txid1 != "" {
		fmt.Printf("\nSpend transaction broadcast, txid=%s\n", txid1)
		return nil
	}
	if txid2 != "" {
		fmt.Printf("\nSpend transaction broadcast, txid=%s\n", txid2)
		return nil
	}

	return fmt.Errorf("both parties completed but no txid received")
}

// runSpendSubcommand handles the "spend" subcommand mode (spawned by itself)
// This matches the behavior of bbmt spend command
func runSpendSubcommand() {
	// Arguments match bbmt spend:
	//  2: server
	//  3: session ID
	//  4: party ID
	//  5: parties CSV
	//  6: encryption public key (peer)
	//  7: decryption private key (self)
	//  8: keyshare JSON/base64 (current party)
	//  9: derivation path (BIP32)
	// 10: address type (p2pkh, p2wpkh, p2sh-p2wpkh, p2tr)
	// 11: destination address (receiver)
	// 12: amount in satoshis
	// 13: fee in satoshis
	// 14: network (mainnet | testnet3)
	// 15: mempool URL base

	if len(os.Args) < 16 {
		fmt.Fprintf(os.Stderr, "Usage: %s spend <server> <session_id> <party_id> <parties_csv> <enc_key> <dec_key> <keyshare_file> <derivation_path> <address_type> <to_address> <amount_sats> <fee_sats> <network> <mempool_url> [passphrase]\n", os.Args[0])
		os.Exit(1)
	}

	server := os.Args[2]
	sessionID := os.Args[3]
	partyID := os.Args[4]
	partiesCSV := os.Args[5]
	encKey := os.Args[6]
	decKey := os.Args[7]
	keyshareRaw := os.Args[8]
	derivePath := os.Args[9]
	addressType := strings.ToLower(os.Args[10])
	toAddress := os.Args[11]
	amountStr := os.Args[12]
	feeStr := os.Args[13]
	network := os.Args[14]
	mempoolURL := os.Args[15]

	// Configure network + mempool API
	if _, err := tss.UseAPI(network, mempoolURL); err != nil {
		fmt.Fprintf(os.Stderr, "Error configuring network/API: %v\n", err)
		os.Exit(1)
	}

	// Parse amount / fee
	amount, err := strconv.ParseInt(amountStr, 10, 64)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid amount_sats: %v\n", err)
		os.Exit(1)
	}
	fee, err := strconv.ParseInt(feeStr, 10, 64)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid fee_sats: %v\n", err)
		os.Exit(1)
	}

	// Get optional passphrase (16th argument, if present)
	passphrase := ""
	if len(os.Args) > 16 {
		passphrase = os.Args[16]
	}

	// Load and decrypt keyshare from file (using loadAndDecryptKeyshare)
	keyshareJSON, err := loadAndDecryptKeyshare(keyshareRaw, passphrase)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading keyshare: %v\n", err)
		os.Exit(1)
	}

	var keyshare struct {
		PubKey       string `json:"pub_key"`
		ChainCodeHex string `json:"chain_code_hex"`
	}
	if err := json.Unmarshal([]byte(keyshareJSON), &keyshare); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing keyshare: %v\n", err)
		os.Exit(1)
	}
	if keyshare.PubKey == "" || keyshare.ChainCodeHex == "" {
		fmt.Fprintf(os.Stderr, "Invalid keyshare: missing pub_key/chain_code_hex\n")
		os.Exit(1)
	}

	// Derive child public key for this spend
	derivedPub, err := tss.GetDerivedPubKey(keyshare.PubKey, keyshare.ChainCodeHex, derivePath, false)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to derive pubkey: %v\n", err)
		os.Exit(1)
	}

	// Derive sender address from derived pubkey + network + address type
	var senderAddress string
	switch addressType {
	case "p2pkh", "legacy":
		senderAddress, err = tss.PubToP2KH(derivedPub, network)
	case "p2wpkh", "segwit", "bech32":
		senderAddress, err = tss.PubToP2WPKH(derivedPub, network)
	case "p2sh-p2wpkh", "p2sh":
		senderAddress, err = tss.PubToP2SHP2WKH(derivedPub, network)
	case "p2tr", "taproot":
		senderAddress, err = tss.PubToP2TR(derivedPub, network)
	default:
		err = fmt.Errorf("unsupported address_type %q", addressType)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to derive sender address: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Using sender address %s (type=%s, network=%s)\n", senderAddress, addressType, network)

	// Perform MPC send (sessionKey left empty -> use enc/dec transport keys)
	sessionKey := ""
	txid, err := tss.MpcSendBTC(
		server,
		partyID,
		partiesCSV,
		sessionID,
		sessionKey,
		encKey,
		decKey,
		keyshareJSON,
		derivePath,
		derivedPub,
		senderAddress,
		toAddress,
		amount,
		fee,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error in MpcSendBTC: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("\n[%s] Spend transaction broadcast, txid=%s\n", partyID, txid)
}

func main() {
	// Check if running in "spend" subcommand mode (spawned by itself)
	if len(os.Args) > 1 && os.Args[1] == "spend" {
		runSpendSubcommand()
		return
	}

	// Check if running in "relay" subcommand mode
	if len(os.Args) > 1 && os.Args[1] == "relay" {
		if len(os.Args) < 3 {
			fmt.Fprintf(os.Stderr, "Usage: %s relay <port>\n", os.Args[0])
			os.Exit(1)
		}
		port := os.Args[2]
		defer tss.StopRelay()
		tss.RunRelay(port)
		select {} // Block forever
	}

	flag.Parse()

	if *help {
		printUsage()
		os.Exit(0)
	}

	// Validate required parameters
	var missing []string
	if *toAddress == "" {
		missing = append(missing, "--to-address")
	}
	if *amountSats == "" {
		missing = append(missing, "--amount-sats")
	}
	if !*preview && *feeSats == "" {
		missing = append(missing, "--fee-sats")
	}
	if *mempoolURL == "" {
		missing = append(missing, "--mempool-url")
	}

	if len(missing) > 0 {
		fmt.Fprintf(os.Stderr, "Error: missing required arguments:\n")
		for _, arg := range missing {
			fmt.Fprintf(os.Stderr, "  - %s\n", arg)
		}
		fmt.Fprintf(os.Stderr, "\n")
		printUsage()
		os.Exit(1)
	}

	// Preview mode: estimate fee only
	if *preview {
		fmt.Println("Preview mode enabled - estimating fee only (HalfHourFee / 30m policy)...")
		// Load keyshare1 for fee estimation
		keyshare1JSON, err := loadAndDecryptKeyshare(*keyshare1, *passphrase1)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error loading keyshare1: %v\n", err)
			os.Exit(1)
		}
		feeStr, err := estimateFee(keyshare1JSON, *derivationPath, *addressType, *toAddress, *amountSats, *network, *mempoolURL)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error estimating fees: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("Estimated fee (satoshis): %s\n", feeStr)
		os.Exit(0)
	}

	// Setup signal handling for cleanup
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		fmt.Println("\nStopping processes...")
		os.Exit(1)
	}()

	// Run MPC spend (pass file paths directly, no temp files)
	if err := runMPCSpend(*keyshare1, *keyshare2, *passphrase1, *passphrase2, *derivationPath, *addressType, *toAddress, *amountSats, *feeSats, *network, *mempoolURL); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
