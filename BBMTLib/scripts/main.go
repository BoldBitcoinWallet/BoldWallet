package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
)

func randomSeed(length int) string {
	out, _ := tss.SecureRandom(length)
	return out
}

func main() {

	mode := os.Args[1]

	if mode == "keypair" {
		kp, _ := tss.GenerateKeyPair()
		fmt.Println(kp)
	}

	if mode == "random" {
		fmt.Println(randomSeed(64))
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
			fmt.Printf(party + " Keygen Result Saved")
			encodedResult := base64.StdEncoding.EncodeToString([]byte(keyshare))
			if err := os.WriteFile(keyshareFile, []byte(encodedResult), 0644); err != nil {
				fmt.Printf("Failed to save keyshare for Peer1: %v\n", err)
			}

			var kgR tss.KeygenResponse
			if err := json.Unmarshal([]byte(keyshare), &kgR); err != nil {
				fmt.Printf("Failed to parse keyshare for %s: %v\n", party, err)
			}

			// print out pubkeys and p2pkh address
			fmt.Printf(party+" Public Key: %s\n", kgR.PubKey)
			xPub := kgR.PubKey
			btcPath := "m/44'/0'/0'/0/0"
			btcPub, err := tss.GetDerivedPubKey(xPub, chainCode, btcPath, false)
			if err != nil {
				fmt.Printf("Failed to generate btc pubkey for %s: %v\n", party, err)
			} else {
				fmt.Printf(party+" BTC Public Key: %s\n", btcPub)
				btcP2Pkh, err := tss.PubToP2KH(btcPub, "testnet3")
				if err != nil {
					fmt.Printf("Failed to generate btc address for %s: %v\n", party, err)
				} else {
					fmt.Printf(party+" address btcP2Pkh: %s\n", btcP2Pkh)
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
