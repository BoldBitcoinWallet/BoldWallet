package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	"github.com/nbd-wtf/go-nostr"
)

func randomSeed(length int) string {
	const characters = "0123456789abcdef"
	result := make([]byte, length)
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	for i := 0; i < length; i++ {
		result[i] = characters[r.Intn(len(characters))]
	}
	return string(result)
}

func main() {

	mode := os.Args[1]

	if mode == "keypair" {
		kp, _ := tss.GenerateKeyPair()
		fmt.Println(kp)
	}

	if mode == "nostrKeypair" {
		privKey := nostr.GeneratePrivateKey()
		pubKey, _ := nostr.GetPublicKey(privKey)
		keyPair := map[string]string{
			"privateKey": privKey,
			"publicKey":  pubKey,
		}
		keyPairJSON, _ := json.Marshal(keyPair)
		fmt.Println(string(keyPairJSON))
	}

	if mode == "random" {
		fmt.Println(randomSeed(64))
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
		sessionKey := os.Args[9]
		nostrPubKey := os.Args[12]
		nostrPrivKey := os.Args[13]
		nostrPartyPubKeys := os.Args[14]

		if len(sessionKey) > 0 {
			encKey = ""
			decKey = ""
		}

		ppmFile := party + ".json"
		keyshareFile := party + ".ks"

		//join keygen
		keyshare, err := tss.JoinKeygen(ppmFile, party, parties, encKey, decKey, session, server, chainCode, sessionKey, "")
		if err != nil {
			fmt.Printf("Go Error: %v\n", err)
		} else {

			// Create LocalState with Nostr keys

			var localState tss.LocalState

			if err := json.Unmarshal([]byte(keyshare), &localState); err != nil {

				fmt.Printf("Failed to parse keyshare for %s: %v\n", party, err)

			}

			var nostrPartyPubKeysMap struct {
				NostrPubKeys map[string]string `json:"nostr_party_pub_keys"`
			}
			if err := json.Unmarshal([]byte(nostrPartyPubKeys), &nostrPartyPubKeysMap); err != nil {
				fmt.Printf("Failed to parse nostr party pubkeys: %v\n", err)
			}
			localState.LocalNostrPubKey = nostrPubKey
			localState.LocalNostrPrivKey = nostrPrivKey
			localState.NostrPartyPubKeys = nostrPartyPubKeysMap.NostrPubKeys

			// Marshal the updated LocalState
			updatedKeyshare, err := json.Marshal(localState)

			if err != nil {

				fmt.Printf("Failed to marshal updated keyshare for %s: %v\n", party, err)

			}

			// save keyshare file - base64 encoded

			fmt.Printf(party + " Keygen Result Saved\n")

			encodedResult := base64.StdEncoding.EncodeToString(updatedKeyshare)

			if err := os.WriteFile(keyshareFile, []byte(encodedResult), 0644); err != nil {

				fmt.Printf("Failed to save keyshare for %s: %v\n", party, err)

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
				btcP2Pkh, err := tss.ConvertPubKeyToBTCAddress(btcPub, "testnet3")
				if err != nil {
					fmt.Printf("Failed to generate btc address for %s: %v\n", party, err)
				} else {
					fmt.Printf(party+" address btcP2Pkh: %s\n", btcP2Pkh)
					fmt.Printf(party+" Nostr Party PubKeys: %s\n", nostrPartyPubKeys)

					// Master host is the party with the largest nostr public key
					var maxPeer string
					var maxKey string
					for peer, key := range localState.NostrPartyPubKeys {
						if key > maxKey { // Direct string comparison
							maxKey = key
							maxPeer = peer
						}
					}
					fmt.Printf("Master host of the party is : %s: %s\n", maxPeer, maxKey)
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
		keyshare := os.Args[8]
		derivePath := os.Args[9]
		message := os.Args[10]

		sessionKey := os.Args[11]
		net_type := os.Args[12]

		if len(sessionKey) > 0 {
			encKey = ""
			decKey = ""
		}

		// message hash, base64 encoded
		messageHash, _ := tss.Sha256(message)
		messageHashBytes := []byte(messageHash)
		messageHashBase64 := base64.StdEncoding.EncodeToString(messageHashBytes)

		keysign, err := tss.JoinKeysign(server, party, parties, session, sessionKey, encKey, decKey, keyshare, derivePath, messageHashBase64, net_type)
		time.Sleep(time.Second)

		if err != nil {
			fmt.Printf("Go Error: %v\n", err)
		} else {
			fmt.Printf("\n [%s] Keysign Result %s\n", party, keysign)
		}
	}

	if mode == "InitiateNostrSendBTC" {

		//This is to be called by the party initiating the session to send BTC
		//The party to initiate this is the master by default for the session.

		fmt.Println("InitiateNostrSendBTC called")
		parties := "peer1,peer2,peer3" // All participating parties
		session := randomSeed(64)      // Generate random session ID
		sessionKey := randomSeed(64)   // Random session key
		derivePath := "m/44'/0'/0'/0/0"
		receiverAddress := "mt1KTSEerA22rfhprYAVuuAvVW1e9xTqfV"
		amountSatoshi := 1000
		estimatedFee := 600
		peer := "peer1"
		net_type := "nostr"
		nostrRelay := "ws://bbw-nostr.xyz"

		if net_type == "nostr" {
			net_type = "nostr"
			go tss.NostrListen(peer, nostrRelay)
			time.Sleep(time.Second * 2)
		} else {
			go tss.RunRelay("55055")
			time.Sleep(time.Second)
		}

		fmt.Printf("Processing peer: %s\n", peer)
		keyshareFile := peer + ".ks"

		// Read and decode keyshare file for this peer
		keyshare, err := os.ReadFile(keyshareFile)
		if err != nil {
			fmt.Printf("Error reading keyshare file for %s: %v\n", peer, err)
			return
		}
		decodedKeyshare, err := base64.StdEncoding.DecodeString(string(keyshare))
		if err != nil {
			fmt.Printf("Failed to decode base64 keyshare: %v\n", err)
			return
		}

		// Get the public key and chain code from keyshare
		var localState tss.LocalState
		if err := json.Unmarshal(decodedKeyshare, &localState); err != nil {
			fmt.Printf("Failed to parse keyshare: %v\n", err)
			return
		}

		// Get the derived public key using chain code from keyshare
		btcPub, err := tss.GetDerivedPubKey(localState.PubKey, localState.ChainCodeHex, derivePath, false)
		if err != nil {
			fmt.Printf("Failed to get derived public key: %v\n", err)
			return
		}

		// Get the sender address
		senderAddress, err := tss.ConvertPubKeyToBTCAddress(btcPub, "testnet3")
		if err != nil {
			fmt.Printf("Failed to get sender address: %v\n", err)
			return
		}

		fmt.Printf("Successfully processed keyshare for %s\n", peer)

		fmt.Println("Testing...")
		// prepare args
		server := "http://127.0.0.1:55055" // Default relay server

		// Generate keypair for encryption/decryption
		keypair, err := tss.GenerateKeyPair()
		if err != nil {
			fmt.Printf("Error generating keypair: %v\n", err)
			return
		}
		var keypairMap map[string]string
		if err := json.Unmarshal([]byte(keypair), &keypairMap); err != nil {
			fmt.Printf("Error parsing keypair: %v\n", err)
			return
		}
		encKey := keypairMap["PublicKey"]  // Public key for encryption
		decKey := keypairMap["PrivateKey"] // Private key for decryption

		derivePath = "m/44'/0'/0'/0/0" // Standard BTC derivation path

		if len(sessionKey) > 0 {
			encKey = ""
			decKey = ""
		}

		result, err := tss.MpcSendBTC(server, peer, parties, session, sessionKey, encKey, decKey, string(keyshare), derivePath, btcPub, senderAddress, receiverAddress, int64(amountSatoshi), int64(estimatedFee), net_type, "true")
		if err != nil {
			fmt.Printf("Go Error: %v\n", err)
		} else {
			fmt.Printf("\n [%s] Keysign Result %s\n", peer, result)
		}

	}

	if mode == "ListenNostrMessages" {
		//Used for testing nostr MPCsendBTC
		//This is to be run first by each party.
		fmt.Println("ListenNostrMessages called")
		party := os.Args[2]
		net_type := "nostr"
		nostrRelay := os.Args[3]

		if net_type == "nostr" {
			tss.NostrListen(party, nostrRelay)
			select {}
		}
	}
}
