package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/BoldBitcoinWallet/BBMTLib/dkls"
)

func main() {
	relays := flag.String("relays", "", "Comma-separated relay URLs")
	nsec := flag.String("nsec", "", "Local nsec (or set NOSTR_NSEC)")
	peers := flag.String("peers", "", "Comma-separated npubs including self")
	session := flag.String("session", "", "Session ID")
	sessionKey := flag.String("session-key", "", "Session key hex")
	chaincode := flag.String("chaincode", "", "Chain code hex")
	output := flag.String("output", "", "Output file")
	flag.Parse()

	if *relays == "" || *peers == "" {
		flag.Usage()
		os.Exit(1)
	}
	if *nsec == "" {
		*nsec = os.Getenv("NOSTR_NSEC")
	}
	result, err := dkls.NostrJoinKeygen(*relays, *nsec, *peers, *session, *sessionKey, *chaincode)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	if *output != "" {
		_ = os.WriteFile(*output, []byte(result), 0600)
	}
	fmt.Print(result)
}
