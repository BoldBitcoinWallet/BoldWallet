package dkls

import (
	"context"
	"encoding/json"
	"fmt"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
)

type nostrMessenger struct {
	messenger *nostrtransport.Messenger
	ctx       context.Context
	localNpub string
}

func (m *nostrMessenger) Send(from, to, body string) error {
	return m.messenger.SendMessage(m.ctx, from, to, body)
}

// NostrJoinKeygen runs DKLs23 DKG over Nostr (mirrors tss.NostrJoinKeygen).
func NostrJoinKeygen(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, chaincode string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("internal error (panic): %v", r)
			debug.PrintStack()
		}
	}()

	localNpub, err := tss.DeriveNpubFromNsec(partyNsec)
	if err != nil {
		return "", err
	}

	relays := splitCSV(relaysCSV)
	allParties := splitCSV(partiesNpubsCSV)
	peersNpub := filterPeers(allParties, localNpub)

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
		return "", err
	}

	return runNostrDKG(cfg, chaincode, localNpub, allParties)
}

func runNostrDKG(cfg nostrtransport.Config, chaincode, localNpub string, allParties []string) (string, error) {
	threshold, err := ThresholdFromPartyCount(len(allParties))
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), cfg.MaxTimeout)
	defer cancel()

	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return "", err
	}
	defer client.Close("dkls keygen complete")

	tss.InitKeygenProgress(cfg.SessionID)

	coordinator := nostrtransport.NewSessionCoordinator(cfg, client)
	if err := coordinator.PublishReady(ctx); err != nil {
		return "", err
	}
	time.Sleep(500 * time.Millisecond)
	if err := coordinator.AwaitPeers(ctx); err != nil {
		return "", err
	}

	messenger := nostrtransport.NewMessenger(cfg, client)
	nm := &nostrMessenger{messenger: messenger, ctx: ctx, localNpub: localNpub}

	selfID := partyIDFromNpub(localNpub, allParties)
	roundCh := make(chan []libtss.Message, 16)

	pump := nostrtransport.NewMessagePump(cfg, client)
	pumpCtx, pumpCancel := context.WithCancel(ctx)
	defer pumpCancel()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = pump.Run(pumpCtx, func(payload []byte) error {
			msgs, err := DecodeMessages(string(payload))
			if err != nil {
				return err
			}
			in := filterMessagesFor(selfID, msgs)
			if len(in) == 0 {
				return nil
			}
			roundCh <- in
			return nil
		})
	}()

	tss.ReportKeygenProgress(cfg.SessionID, 2, "starting DKLs DKG", false)
	runner := &nostrPartyRunner{selfID: selfID, localNpub: localNpub, messenger: nm, peers: allParties}
	share, _, err := runDKGWithSender(cfg.SessionID, selfID, []byte(cfg.SessionID), threshold, runner, roundCh)
	pumpCancel()
	wg.Wait()
	if err != nil {
		return "", err
	}
	defer share.Free()

	ksJSON, err := KeyshareJSONFromHandle(share, chaincode, allParties, localNpub, localNpub, "")
	if err != nil {
		return "", err
	}
	tss.ReportKeygenProgress(cfg.SessionID, 99, "keygen ok", true)
	_ = coordinator.PublishComplete(ctx, "keygen")
	return ksJSON, nil
}

type nostrPartyRunner struct {
	selfID    libtss.Identifier
	localNpub string
	messenger *nostrMessenger
	peers     []string
}

func (r *nostrPartyRunner) sendMessages(msgs []libtss.Message) error {
	body, err := EncodeMessages(msgs)
	if err != nil {
		return err
	}
	for _, peer := range r.peers {
		if peer == r.localNpub {
			continue
		}
		if err := r.messenger.Send(r.localNpub, peer, body); err != nil {
			return err
		}
	}
	return nil
}

func partyIDFromNpub(npub string, allParties []string) libtss.Identifier {
	for i, p := range allParties {
		if p == npub {
			return libtss.Identifier(i + 1)
		}
	}
	return 1
}

// NostrJoinKeysign runs DKLs23 signing over Nostr.
func NostrJoinKeysign(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, message string) (string, error) {
	localNpub, err := tss.DeriveNpubFromNsec(partyNsec)
	if err != nil {
		return "", err
	}
	share, ks, err := ImportKeyshare(keyshareJSON)
	if err != nil {
		return "", err
	}
	defer share.Free()
	if ks.NostrNpub != "" && ks.NostrNpub != localNpub {
		return "", fmt.Errorf("keyshare npub mismatch")
	}

	relays := splitCSV(relaysCSV)
	allParties := splitCSV(partiesNpubsCSV)
	peersNpub := filterPeers(allParties, localNpub)

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
		return "", err
	}

	signSess, err := ResolveSigningSessionNostr(share, ks, localNpub, partiesNpubsCSV)
	if err != nil {
		return "", err
	}

	hash := HashMessageForDKLs([]byte(message))
	tss.InitKeysignProgress(sessionID)

	ctx, cancel := context.WithTimeout(context.Background(), cfg.MaxTimeout)
	defer cancel()

	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return "", err
	}
	defer client.Close("dkls keysign complete")

	messenger := nostrtransport.NewMessenger(cfg, client)
	nm := &nostrMessenger{messenger: messenger, ctx: ctx, localNpub: localNpub}
	pump := nostrtransport.NewMessagePump(cfg, client)
	pumpCtx, pumpCancel := context.WithCancel(ctx)
	defer pumpCancel()

	roundCh := make(chan []libtss.Message, 16)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = pump.Run(pumpCtx, func(payload []byte) error {
			msgs, err := DecodeMessages(string(payload))
			if err != nil {
				return err
			}
			in := filterMessagesFor(signSess.SelfID, msgs)
			if len(in) == 0 {
				return nil
			}
			roundCh <- in
			return nil
		})
	}()

	runner := &nostrPartyRunner{
		selfID:    signSess.SelfID,
		localNpub: localNpub,
		messenger: nm,
		peers:     allParties,
	}
	sig, err := runSignWithSender(share, hash, []byte(sessionID), signSess.SelfID, signSess.SigningIDs, runner, roundCh, sessionID)
	pumpCancel()
	wg.Wait()
	if err != nil {
		return "", err
	}

	out := map[string]string{
		"r":           fmt.Sprintf("%x", sig.Data[:min(32, len(sig.Data))]),
		"s":           fmt.Sprintf("%x", sig.Data[min(32, len(sig.Data)):]),
		"pub_key":     ks.PubKey,
		"tss_backend": BackendName,
	}
	raw, _ := json.Marshal(out)
	tss.ReportKeysignProgress(sessionID, 99, "keysign ok", true)
	return string(raw), nil
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func filterPeers(all []string, self string) []string {
	out := make([]string, 0)
	for _, p := range all {
		if p != self {
			out = append(out, p)
		}
	}
	return out
}
