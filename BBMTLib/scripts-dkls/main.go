package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/BoldBitcoinWallet/BBMTLib/dkls"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage: %s <command> [args...]\n", os.Args[0])
		os.Exit(1)
	}
	mode := os.Args[1]

	switch mode {
	case "random":
		out, _ := randomHex(64)
		fmt.Print(out)
	case "nostr-keypair":
		skHex := nostr.GeneratePrivateKey()
		pkHex, err := nostr.GetPublicKey(skHex)
		if err != nil {
			fmt.Fprintf(os.Stderr, "npub: %v\n", err)
			os.Exit(1)
		}
		nsec, err := nip19.EncodePrivateKey(skHex)
		if err != nil {
			fmt.Fprintf(os.Stderr, "nsec: %v\n", err)
			os.Exit(1)
		}
		npub, err := nip19.EncodePublicKey(pkHex)
		if err != nil {
			fmt.Fprintf(os.Stderr, "npub encode: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("%s,%s", nsec, npub)
	case "hello-dkg":
		result, err := dkls.HelloDkg()
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
		fmt.Println(result)
	case "local-keygen":
		shares, pub, err := dkls.RunDKGInProcess([]byte("scripts-dkls-keygen"))
		if err != nil {
			fmt.Fprintf(os.Stderr, "keygen: %v\n", err)
			os.Exit(1)
		}
		defer shares[0].Free()
		defer shares[1].Free()
		chaincode := "00"
		if len(os.Args) > 2 {
			chaincode = os.Args[2]
		}
		ks, err := dkls.KeyshareJSONFromHandle(shares[0], chaincode, []string{"party1", "party2"}, "party1", "", "")
		if err != nil {
			fmt.Fprintf(os.Stderr, "export: %v\n", err)
			os.Exit(1)
		}
		fmt.Println(ks)
		_ = pub
	case "local-keygen-3":
		shares, pub, err := dkls.RunDKGInProcessWithThreshold([]byte("scripts-dkls-keygen-trio"), dkls.ThresholdTrio())
		if err != nil {
			fmt.Fprintf(os.Stderr, "keygen trio: %v\n", err)
			os.Exit(1)
		}
		for _, s := range shares {
			defer s.Free()
		}
		chaincode := "00"
		if len(os.Args) > 2 {
			chaincode = os.Args[2]
		}
		committee := []string{"KeyShare1", "KeyShare2", "KeyShare3"}
		ks, err := dkls.KeyshareJSONFromHandle(shares[0], chaincode, committee, "KeyShare1", "", "")
		if err != nil {
			fmt.Fprintf(os.Stderr, "export: %v\n", err)
			os.Exit(1)
		}
		fmt.Println(ks)
		_ = pub
	case "validate-ks":
		if len(os.Args) < 3 {
			fmt.Fprintf(os.Stderr, "Usage: %s validate-ks <file>\n", os.Args[0])
			os.Exit(1)
		}
		if err := dkls.ValidateKeyshareFile(os.Args[2]); err != nil {
			fmt.Fprintf(os.Stderr, "invalid: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("ok")
	case "nostr-keygen":
		runNostrKeygenCLI()
	case "nostr-keysign":
		runNostrKeysignCLI()
	case "relay":
		if len(os.Args) < 3 {
			fmt.Fprintf(os.Stderr, "Usage: %s relay <port>\n", os.Args[0])
			os.Exit(1)
		}
		if _, err := tss.RunRelay(os.Args[2]); err != nil {
			fmt.Fprintf(os.Stderr, "relay: %v\n", err)
			os.Exit(1)
		}
		select {}
	case "lan-keygen":
		if len(os.Args) < 8 {
			fmt.Fprintf(os.Stderr, "Usage: %s lan-keygen <key> <partiesCSV> <session> <server> <chaincode> <sessionKey>\n", os.Args[0])
			os.Exit(1)
		}
		result, err := dkls.JoinKeygen(os.Args[2], os.Args[3], os.Args[4], os.Args[5], os.Args[6], os.Args[7], "", "")
		if err != nil {
			fmt.Fprintf(os.Stderr, "lan keygen: %v\n", err)
			os.Exit(1)
		}
		fmt.Println(result)
	case "lan-keysign":
		if len(os.Args) < 9 {
			fmt.Fprintf(os.Stderr, "Usage: %s lan-keysign <server> <key> <partiesCSV> <session> <sessionKey> <keyshareFile> <message>\n", os.Args[0])
			os.Exit(1)
		}
		raw, err := os.ReadFile(os.Args[7])
		if err != nil {
			fmt.Fprintf(os.Stderr, "read keyshare: %v\n", err)
			os.Exit(1)
		}
		result, err := dkls.JoinKeysign(os.Args[2], os.Args[3], os.Args[4], os.Args[5], os.Args[6], "", "", string(raw), os.Args[8])
		if err != nil {
			fmt.Fprintf(os.Stderr, "lan keysign: %v\n", err)
			os.Exit(1)
		}
		fmt.Println(result)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", mode)
		os.Exit(1)
	}
}

func randomHex(n int) (string, error) {
	b := make([]byte, n/2)
	if _, err := randRead(b); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", b), nil
}

func randRead(b []byte) (int, error) {
	f, err := os.Open("/dev/urandom")
	if err != nil {
		return 0, err
	}
	defer f.Close()
	return f.Read(b)
}

func runNostrKeygenCLI() {
	relays := envOr("RELAYS", "ws://localhost:7777")
	nsec := os.Getenv("NOSTR_NSEC")
	if nsec == "" {
		skHex := nostr.GeneratePrivateKey()
		var err error
		nsec, err = nip19.EncodePrivateKey(skHex)
		if err != nil {
			fmt.Fprintf(os.Stderr, "nsec encode: %v\n", err)
			os.Exit(1)
		}
	}
	npub, err := tss.DeriveNpubFromNsec(nsec)
	if err != nil {
		fmt.Fprintf(os.Stderr, "npub: %v\n", err)
		os.Exit(1)
	}
	peers := os.Getenv("PEERS")
	if peers == "" {
		fmt.Fprintf(os.Stderr, "PEERS env required (comma-separated npubs)\n")
		os.Exit(1)
	}
	session := envOr("SESSION_ID", mustRandom())
	sessionKey := envOr("SESSION_KEY", mustRandom())
	chaincode := envOr("CHAINCODE", mustRandom())
	allParties := peers
	if !strings.Contains(allParties, npub) {
		allParties = npub + "," + allParties
	}
	result, err := dkls.NostrJoinKeygen(relays, nsec, allParties, session, sessionKey, chaincode)
	if err != nil {
		fmt.Fprintf(os.Stderr, "nostr keygen: %v\n", err)
		os.Exit(1)
	}
	outPath := envOr("OUTPUT", "dkls-keyshare.json")
	_ = os.WriteFile(outPath, []byte(result), 0600)
	fmt.Println(result)
}

func runNostrKeysignCLI() {
	relays := envOr("RELAYS", "ws://localhost:7777")
	nsec := os.Getenv("NOSTR_NSEC")
	peers := os.Getenv("PEERS")
	ksPath := envOr("KEYSHARE", "dkls-keyshare.json")
	message := envOr("MESSAGE", "test-message")
	if nsec == "" || peers == "" {
		fmt.Fprintf(os.Stderr, "NOSTR_NSEC and PEERS required\n")
		os.Exit(1)
	}
	raw, err := os.ReadFile(ksPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read keyshare: %v\n", err)
		os.Exit(1)
	}
	npub, _ := nostr.GetPublicKey(nsec)
	allParties := peers
	if !strings.Contains(allParties, npub) {
		allParties = npub + "," + allParties
	}
	result, err := dkls.NostrJoinKeysign(
		relays, nsec, allParties,
		envOr("SESSION_ID", mustRandom()),
		envOr("SESSION_KEY", mustRandom()),
		string(raw), message,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "nostr keysign: %v\n", err)
		os.Exit(1)
	}
	fmt.Println(result)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func mustRandom() string {
	s, err := randomHex(64)
	if err != nil {
		panic(err)
	}
	return s
}
