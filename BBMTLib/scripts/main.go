package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
)

func randomSeed(length int) string {
	out, err := tss.SecureRandom(length)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: CSPRNG failure (SecureRandom): %v\n", err)
		os.Exit(1)
	}
	return out
}

func main() {

	mode := os.Args[1]

	// ============================================================
	// Simple helper commands
	// ============================================================

	if mode == "keypair" {
		kp, _ := tss.GenerateKeyPair()
		fmt.Println(kp)
	}

	if mode == "random" {
		fmt.Println(randomSeed(64))
	}

	if mode == "sha256" {
		if len(os.Args) < 3 {
			fmt.Fprintf(os.Stderr, "Usage: %s sha256 <message>\n", os.Args[0])
			os.Exit(1)
		}
		msg := os.Args[2]
		hash, err := tss.Sha256(msg)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error computing sha256: %v\n", err)
			os.Exit(1)
		}
		fmt.Print(hash)
	}

	if mode == "validate-ks" {
		if len(os.Args) < 3 {
			fmt.Fprintf(os.Stderr, "Usage: %s validate-ks <keyshare_file>\n", os.Args[0])
			os.Exit(1)
		}

		keyshareFile := os.Args[2]

		data, err := os.ReadFile(keyshareFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading keyshare file: %v\n", err)
			os.Exit(1)
		}

		// Try to decode as base64 first (for .ks files), then as JSON
		var keyshareJSON []byte
		if decoded, err := base64.StdEncoding.DecodeString(string(data)); err == nil {
			keyshareJSON = decoded
		} else {
			keyshareJSON = data
		}

		var ks struct {
			PubKey       string `json:"pub_key"`
			ChainCodeHex string `json:"chain_code_hex"`
		}

		if err := json.Unmarshal(keyshareJSON, &ks); err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing keyshare JSON: %v\n", err)
			os.Exit(1)
		}

		if ks.PubKey == "" {
			fmt.Fprintf(os.Stderr, "Invalid keyshare: missing pub_key field\n")
			os.Exit(1)
		}

		if ks.ChainCodeHex == "" {
			fmt.Fprintf(os.Stderr, "Invalid keyshare: missing chain_code_hex field\n")
			os.Exit(1)
		}

		fmt.Println("Valid keyshare: pub_key and chain_code_hex present")
		os.Exit(0)
	}

	if mode == "nostr-keypair" {
		// Generate private key in hex format
		skHex := nostr.GeneratePrivateKey()

		// Get public key in hex format
		pkHex, err := nostr.GetPublicKey(skHex)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error generating Nostr public key: %v\n", err)
			os.Exit(1)
		}

		// Convert to bech32 format (matching mobile app's NostrKeypair behavior)
		nsec, err := nip19.EncodePrivateKey(skHex)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error encoding nsec: %v\n", err)
			os.Exit(1)
		}

		npub, err := nip19.EncodePublicKey(pkHex)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error encoding npub: %v\n", err)
			os.Exit(1)
		}

		fmt.Printf("%s,%s", nsec, npub)
	}

	if mode == "relay" {
		port := os.Args[2]
		defer tss.StopRelay()
		tss.RunRelay(port)
		select {}
	}

	if mode == "keygen" {

		// prepare args
		server := os.Args[2]
		session := os.Args[3]
		chainCode := os.Args[4]
		party := os.Args[5]
		parties := os.Args[6]
		encKey := os.Args[7]
		decKey := os.Args[8]
		sessionKey := ""
		ppmFile := party + ".json"
		keyshareFile := party + ".ks"

		//join keygen
		keyshare, err := tss.JoinKeygen(ppmFile, party, parties, encKey, decKey, session, server, chainCode, sessionKey)
		if err != nil {
			fmt.Printf("Go Error: %v\n", err)
		} else {

			// save keyshare file - base64 encoded
			fmt.Printf("%s Keygen Result Saved\n", party)
			encodedResult := base64.StdEncoding.EncodeToString([]byte(keyshare))
			if err := os.WriteFile(keyshareFile, []byte(encodedResult), 0644); err != nil {
				fmt.Printf("Failed to save keyshare for Peer1: %v\n", err)
			}

			var kgR tss.KeygenResponse
			if err := json.Unmarshal([]byte(keyshare), &kgR); err != nil {
				fmt.Printf("Failed to parse keyshare for %s: %v\n", party, err)
			}

			// print out pubkeys and p2pkh address
			fmt.Printf("%s Public Key: %s\n", party, kgR.PubKey)
			xPub := kgR.PubKey
			btcPath := "m/44'/0'/0'/0/0"
			btcPub, err := tss.GetDerivedPubKey(xPub, chainCode, btcPath, false)
			if err != nil {
				fmt.Printf("Failed to generate btc pubkey for %s: %v\n", party, err)
			} else {
				fmt.Printf("%s BTC Public Key: %s\n", party, btcPub)
				btcP2Pkh, err := tss.PubToP2KH(btcPub, "testnet3")
				if err != nil {
					fmt.Printf("Failed to generate btc address for %s: %v\n", party, err)
				} else {
					fmt.Printf("%s address btcP2Pkh: %s\n", party, btcP2Pkh)
				}
			}
		}
	}

	if mode == "keysign" {

		// prepare args
		server := os.Args[2]
		session := os.Args[3]
		party := os.Args[4]
		parties := os.Args[5]
		encKey := os.Args[6]
		decKey := os.Args[7]
		sessionKey := ""
		keyshare := os.Args[8]
		derivePath := os.Args[9]
		message := os.Args[10]

		// message hash, base64 encoded
		messageHash, _ := tss.Sha256(message)
		messageHashBytes := []byte(messageHash)
		messageHashBase64 := base64.StdEncoding.EncodeToString(messageHashBytes)

		// join keysign
		keysign, err := tss.JoinKeysign(server, party, parties, session, sessionKey, encKey, decKey, keyshare, derivePath, messageHashBase64)
		time.Sleep(time.Second)

		if err != nil {
			fmt.Printf("Go Error: %v\n", err)
		} else {
			fmt.Printf("\n [%s] Keysign Result %s\n", party, keysign)
		}
	}

	if mode == "hex-decode" {
		if len(os.Args) < 3 {
			fmt.Fprintf(os.Stderr, "Usage: %s hex-decode <hex_string>\n", os.Args[0])
			os.Exit(1)
		}
		hexStr := os.Args[2]
		decoded, err := hex.DecodeString(hexStr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error decoding hex: %v\n", err)
			os.Exit(1)
		}
		fmt.Print(string(decoded))
	}

	if mode == "aes-decrypt" {
		// aes-decrypt <ciphertext_base64> <hex_key>
		if len(os.Args) < 4 {
			fmt.Fprintf(os.Stderr, "Usage: %s aes-decrypt <ciphertext_base64> <hex_key>\n", os.Args[0])
			os.Exit(1)
		}
		ciphertext := os.Args[2]
		hexKey := os.Args[3]

		plaintext, err := tss.AesDecrypt(ciphertext, hexKey)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error in aes-decrypt: %v\n", err)
			os.Exit(1)
		}
		fmt.Print(plaintext)
	}

	if mode == "spend" {
		// Arguments:
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
		// 13: fee in satoshis (already estimated/negotiated)
		// 14: network (mainnet | testnet3)
		// 15: mempool URL base (e.g. https://mempool.space/testnet/api)

		if len(os.Args) < 16 {
			fmt.Fprintf(os.Stderr, "Usage: %s spend <server> <session_id> <party_id> <parties_csv> <enc_key> <dec_key> <keyshare_json_or_b64> <derivation_path> <address_type> <to_address> <amount_sats> <fee_sats> <network> <mempool_url>\n", os.Args[0])
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

		// Decode keyshare (accept base64 or raw JSON)
		var keyshareJSON []byte
		if decoded, err := base64.StdEncoding.DecodeString(keyshareRaw); err == nil {
			keyshareJSON = decoded
		} else {
			keyshareJSON = []byte(keyshareRaw)
		}

		var keyshare struct {
			PubKey       string `json:"pub_key"`
			ChainCodeHex string `json:"chain_code_hex"`
		}
		if err := json.Unmarshal(keyshareJSON, &keyshare); err != nil {
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

		log.Printf("Using sender address %s (type=%s, network=%s)", senderAddress, addressType, network)

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
			string(keyshareJSON),
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

	if mode == "estimate-fees-spend" {
		// estimate-fees-spend:
		//  2: keyshare JSON/base64
		//  3: derivation path
		//  4: address type
		//  5: destination address
		//  6: amount in satoshis
		//  7: network
		//  8: mempool URL

		if len(os.Args) < 9 {
			fmt.Fprintf(os.Stderr, "Usage: %s estimate-fees-spend <keyshare_json_or_b64> <derivation_path> <address_type> <to_address> <amount_sats> <network> <mempool_url>\n", os.Args[0])
			os.Exit(1)
		}

		keyshareRaw := os.Args[2]
		derivePath := os.Args[3]
		addressType := strings.ToLower(os.Args[4])
		toAddress := os.Args[5]
		amountStr := os.Args[6]
		network := os.Args[7]
		mempoolURL := os.Args[8]

		if _, err := tss.UseAPI(network, mempoolURL); err != nil {
			fmt.Fprintf(os.Stderr, "Error configuring network/API: %v\n", err)
			os.Exit(1)
		}
		if _, err := tss.UseFeePolicy("30m"); err != nil {
			fmt.Fprintf(os.Stderr, "Error setting fee policy: %v\n", err)
			os.Exit(1)
		}

		amount, err := strconv.ParseInt(amountStr, 10, 64)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Invalid amount_sats: %v\n", err)
			os.Exit(1)
		}

		var keyshareJSON []byte
		if decoded, err := base64.StdEncoding.DecodeString(keyshareRaw); err == nil {
			keyshareJSON = decoded
		} else {
			keyshareJSON = []byte(keyshareRaw)
		}

		var keyshare struct {
			PubKey       string `json:"pub_key"`
			ChainCodeHex string `json:"chain_code_hex"`
		}
		if err := json.Unmarshal(keyshareJSON, &keyshare); err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing keyshare: %v\n", err)
			os.Exit(1)
		}
		if keyshare.PubKey == "" || keyshare.ChainCodeHex == "" {
			fmt.Fprintf(os.Stderr, "Invalid keyshare: missing pub_key/chain_code_hex\n")
			os.Exit(1)
		}

		derivedPub, err := tss.GetDerivedPubKey(keyshare.PubKey, keyshare.ChainCodeHex, derivePath, false)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Failed to derive pubkey: %v\n", err)
			os.Exit(1)
		}

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

		feeStr, err := tss.EstimateFees(senderAddress, toAddress, amount)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error estimating fees: %v\n", err)
			os.Exit(1)
		}

		fmt.Print(feeStr)
	}

	if mode == "extract-npub" {
		if len(os.Args) < 3 {
			fmt.Fprintf(os.Stderr, "Usage: %s extract-npub <keyshare_file>\n", os.Args[0])
			os.Exit(1)
		}
		keyshareFile := os.Args[2]
		data, err := os.ReadFile(keyshareFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading keyshare: %v\n", err)
			os.Exit(1)
		}
		var keyshare struct {
			NostrNpub string `json:"nostr_npub"`
		}
		if err := json.Unmarshal(data, &keyshare); err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing keyshare: %v\n", err)
			os.Exit(1)
		}
		if keyshare.NostrNpub == "" {
			fmt.Fprintf(os.Stderr, "Error: nostr_npub not found in keyshare\n")
			os.Exit(1)
		}
		fmt.Print(keyshare.NostrNpub)
	}

	if mode == "extract-nsec" {
		if len(os.Args) < 3 {
			fmt.Fprintf(os.Stderr, "Usage: %s extract-nsec <keyshare_file>\n", os.Args[0])
			os.Exit(1)
		}
		keyshareFile := os.Args[2]
		data, err := os.ReadFile(keyshareFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading keyshare: %v\n", err)
			os.Exit(1)
		}
		var keyshare struct {
			Nsec string `json:"nsec"`
		}
		if err := json.Unmarshal(data, &keyshare); err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing keyshare: %v\n", err)
			os.Exit(1)
		}
		if keyshare.Nsec == "" {
			fmt.Fprintf(os.Stderr, "Error: nsec not found in keyshare\n")
			os.Exit(1)
		}
		// The nsec field is stored as hex-encoded bytes of the bech32 nsec string
		// Decode hex to get the raw nsec (bech32 format)
		decoded, err := hex.DecodeString(keyshare.Nsec)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error decoding nsec hex: %v\n", err)
			os.Exit(1)
		}
		// Return the decoded string (should be bech32 nsec1...)
		fmt.Print(string(decoded))
	}

	if mode == "extract-committee" {
		if len(os.Args) < 3 {
			fmt.Fprintf(os.Stderr, "Usage: %s extract-committee <keyshare_file>\n", os.Args[0])
			os.Exit(1)
		}
		keyshareFile := os.Args[2]
		data, err := os.ReadFile(keyshareFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading keyshare: %v\n", err)
			os.Exit(1)
		}
		var keyshare struct {
			KeygenCommitteeKeys []string `json:"keygen_committee_keys"`
		}
		if err := json.Unmarshal(data, &keyshare); err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing keyshare: %v\n", err)
			os.Exit(1)
		}
		if len(keyshare.KeygenCommitteeKeys) == 0 {
			fmt.Fprintf(os.Stderr, "Error: keygen_committee_keys not found in keyshare\n")
			os.Exit(1)
		}
		fmt.Print(strings.Join(keyshare.KeygenCommitteeKeys, ","))
	}

	if mode == "show-keyshare" {
		// prepare args
		keyshareFile := os.Args[2]
		partyName := os.Args[3]

		// Read keyshare file
		data, err := os.ReadFile(keyshareFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading keyshare: %v\n", err)
			os.Exit(1)
		}

		// Try to decode as base64 first (for old format), then as JSON
		var keyshareJSON []byte
		decoded, err := base64.StdEncoding.DecodeString(string(data))
		if err == nil {
			keyshareJSON = decoded
		} else {
			keyshareJSON = data
		}

		var keyshare struct {
			PubKey       string `json:"pub_key"`
			ChainCodeHex string `json:"chain_code_hex"`
		}

		if err := json.Unmarshal(keyshareJSON, &keyshare); err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing keyshare: %v\n", err)
			os.Exit(1)
		}

		// Print public key
		fmt.Printf("%s Public Key: %s\n", partyName, keyshare.PubKey)

		// Derive BTC public key
		btcPath := "m/44'/0'/0'/0/0"
		btcPub, err := tss.GetDerivedPubKey(keyshare.PubKey, keyshare.ChainCodeHex, btcPath, false)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Failed to generate btc pubkey for %s: %v\n", partyName, err)
			os.Exit(1)
		}
		fmt.Printf("%s BTC Public Key: %s\n", partyName, btcPub)

		// Generate BTC address
		btcP2Pkh, err := tss.PubToP2KH(btcPub, "testnet3")
		if err != nil {
			fmt.Fprintf(os.Stderr, "Failed to generate btc address for %s: %v\n", partyName, err)
			os.Exit(1)
		}
		fmt.Printf("%s address btcP2Pkh: %s\n", partyName, btcP2Pkh)
	}
}
