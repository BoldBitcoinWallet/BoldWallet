package dkls

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
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
	defer recoverAsError("NostrJoinKeygen", &err, &result)

	chaincode, err = tss.NormalizeChainCodeHex(chaincode)
	if err != nil {
		return "", err
	}

	localNpub, err := tss.DeriveNpubFromNsec(partyNsec)
	if err != nil {
		return "", err
	}

	relays := splitCSV(relaysCSV)
	allParties := sortedPartiesNpubs(splitCSV(partiesNpubsCSV))
	peersNpub := filterPeers(allParties, localNpub)

	cfg := nostrtransport.Config{
		Relays:        relays,
		SessionID:     sessionID,
		SessionKeyHex: sessionKey,
		LocalNpub:     localNpub,
		LocalNsec:     partyNsec,
		PeersNpub:     peersNpub,
		MaxTimeout:    5 * time.Minute,
	}
	cfg.ApplyDefaults()
	if err := cfg.Validate(); err != nil {
		return "", err
	}

	rootCtx, cleanup, err := tss.AttachNostrOperationRoot()
	if err != nil {
		return "", err
	}
	defer cleanup()
	return runNostrDKG(rootCtx, cfg, chaincode, localNpub, allParties)
}

func runNostrDKG(rootCtx context.Context, cfg nostrtransport.Config, chaincode, localNpub string, allParties []string) (result string, err error) {
	defer recoverAsError("runNostrDKG", &err, &result)
	threshold, err := ThresholdFromPartyCount(len(allParties))
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(rootCtx, cfg.MaxTimeout)
	defer cancel()
	RegisterCancel(cfg.SessionID, cancel)

	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return "", err
	}
	defer client.Close("dkls keygen complete")

	tss.InitKeygenProgress(cfg.SessionID)

	coordinator := nostrtransport.NewSessionCoordinator(cfg, client)
	defer func() {
		if err != nil && !strings.Contains(err.Error(), "peer aborted") {
			publishNostrAbort(coordinator, err)
		}
	}()
	if err := coordinator.PublishReady(ctx); err != nil {
		return "", err
	}
	time.Sleep(500 * time.Millisecond)
	tss.ReportKeygenProgress(cfg.SessionID, 1, "waiting for peers", false)
	stopPeerPulse := make(chan struct{})
	go func() {
		defer recoverGoroutine("NostrJoinKeygen peer pulse")
		tick := 0
		for {
			select {
			case <-stopPeerPulse:
				return
			case <-time.After(2 * time.Second):
				tick++
				tss.ReportKeygenProgress(cfg.SessionID, 1, fmt.Sprintf("waiting for peers (%d)", tick), false)
			}
		}
	}()
	if err := coordinator.AwaitPeers(ctx); err != nil {
		close(stopPeerPulse)
		return "", err
	}
	close(stopPeerPulse)
	tss.ReportKeygenProgress(cfg.SessionID, 1, "peers ready", false)

	messenger := nostrtransport.NewMessenger(cfg, client)
	nm := &nostrMessenger{messenger: messenger, ctx: ctx, localNpub: localNpub}

	selfID, err := partyIDFromNpub(localNpub, allParties)
	if err != nil {
		return "", err
	}
	// Large buffer + non-blocking enqueue: pump must not block while runDKG is inside session.Next (sync).
	roundCh := make(chan []libtss.Message, 256)

	pump := nostrtransport.NewMessagePump(cfg, client)
	var peerAbort struct {
		sync.Mutex
		reason string
		set    bool
	}
	pump.SetOnAbort(func(reason string) {
		peerAbort.Lock()
		peerAbort.reason = reason
		peerAbort.set = true
		peerAbort.Unlock()
		cancel()
	})
	pumpCtx, pumpCancel := context.WithCancel(ctx)
	defer pumpCancel()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer recoverGoroutine("NostrJoinKeygen message pump")
		_ = pump.Run(pumpCtx, func(payload []byte) error {
			msgs, err := DecodeMessages(string(payload))
			if err != nil {
				// Corrupt/foreign payloads must not kill the entire subscription loop.
				// LAN pump already treats decode failures as non-fatal and continues.
				dklsLogErrorf(
					"nostr DKG: session=%s dropping undecodable payload: %v",
					dkgSessionLogPrefix(cfg.SessionID),
					err,
				)
				return nil
			}
			in := dedupeDKGInboundBySender(selfID, msgs)
			if len(in) == 0 {
				return nil
			}
			dklsLogf(
				"nostr DKG: session=%s pump delivered %d msg(s) from %d sender(s)",
				dkgSessionLogPrefix(cfg.SessionID),
				len(in),
				peerSenderCount(in, selfID),
			)
			select {
			case roundCh <- in:
			default:
				go func(batch []libtss.Message) {
					defer recoverGoroutine("NostrJoinKeygen roundCh batch send")
					roundCh <- batch
				}(in)
			}
			return nil
		})
	}()

	sidBytes := []byte(cfg.SessionID)
	if decoded, decErr := hex.DecodeString(cfg.SessionID); decErr == nil && len(decoded) > 0 {
		sidBytes = decoded
	}
	tss.ReportKeygenProgress(cfg.SessionID, 2, "starting keygen", false)
	dklsLogf(
		"nostr DKG: session=%s parties=%d starting mpc rounds",
		dkgSessionLogPrefix(cfg.SessionID),
		len(allParties),
	)
	runner := &nostrPartyRunner{selfID: selfID, localNpub: localNpub, messenger: nm, peers: allParties}
	share, _, err := runDKGWithSender(ctx, cfg.SessionID, selfID, sidBytes, threshold, runner, roundCh)
	pumpCancel()
	wg.Wait()
	if err != nil {
		peerAbort.Lock()
		set, reason := peerAbort.set, peerAbort.reason
		peerAbort.Unlock()
		if set {
			return "", nostrtransport.WrapPeerAbort(reason, err)
		}
		return "", err
	}
	defer share.Free()

	nsecField, err := NsecFieldForKeyshareJSON(cfg.LocalNsec)
	if err != nil {
		return "", err
	}
	ksJSON, err := KeyshareJSONFromHandle(share, chaincode, allParties, localNpub, localNpub, nsecField)
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
	var peers []string
	for _, peer := range r.peers {
		if peer != r.localNpub {
			peers = append(peers, peer)
		}
	}
	if len(peers) == 0 {
		return nil
	}
	if len(peers) == 1 {
		return r.messenger.Send(r.localNpub, peers[0], body)
	}
	var wg sync.WaitGroup
	var errMu sync.Mutex
	var sendErr error
	for _, peer := range peers {
		peer := peer
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer recoverGoroutine("nostrPartyRunner Send")
			if err := r.messenger.Send(r.localNpub, peer, body); err != nil {
				errMu.Lock()
				if sendErr == nil {
					sendErr = err
				}
				errMu.Unlock()
			}
		}()
	}
	wg.Wait()
	return sendErr
}

func partyIDFromNpub(npub string, allParties []string) (libtss.Identifier, error) {
	localHex, err := npubToHexKey(npub)
	if err != nil {
		return 0, err
	}
	for i, p := range allParties {
		pHex, err := npubToHexKey(p)
		if err != nil {
			continue
		}
		if pHex == localHex {
			return libtss.Identifier(i + 1), nil
		}
	}
	return 0, fmt.Errorf("dkls: local npub not in parties list (have %d parties)", len(allParties))
}

func npubToHexKey(npub string) (string, error) {
	npub = strings.TrimSpace(npub)
	if strings.HasPrefix(npub, "npub1") {
		prefix, decoded, err := nip19.Decode(npub)
		if err != nil || prefix != "npub" {
			return "", fmt.Errorf("decode npub: %w", err)
		}
		if s, ok := decoded.(string); ok {
			return s, nil
		}
		return "", fmt.Errorf("decode npub: unexpected type")
	}
	if len(npub) == 64 {
		return npub, nil
	}
	// hex nsec path: derive npub then hex
	if pk, err := nostr.GetPublicKey(npub); err == nil && len(pk) == 64 {
		return pk, nil
	}
	return "", fmt.Errorf("invalid npub %q", npub)
}

func publishNostrAbort(coordinator *nostrtransport.SessionCoordinator, cause error) {
	if coordinator == nil {
		return
	}
	reason := "aborted"
	if cause != nil {
		reason = cause.Error()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	_ = coordinator.PublishAbort(ctx, reason)
}

// NostrJoinKeysign runs DKLs23 signing over Nostr.
func NostrJoinKeysign(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, message string) (result string, err error) {
	defer recoverAsError("NostrJoinKeysign", &err, &result)
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

	signSess, err := ResolveSigningSessionNostr(share, ks, localNpub, partiesNpubsCSV)
	if err != nil {
		return "", err
	}

	relays := splitCSV(relaysCSV)
	cfg := nostrtransport.Config{
		Relays:        relays,
		SessionID:     sessionID,
		SessionKeyHex: sessionKey,
		LocalNpub:     localNpub,
		LocalNsec:     partyNsec,
		PeersNpub:     signSess.NostrPeers,
		MaxTimeout:    5 * time.Minute,
	}
	cfg.ApplyDefaults()
	if err := cfg.Validate(); err != nil {
		return "", err
	}

	hash := HashMessageForDKLs([]byte(message))
	tss.InitKeysignProgress(sessionID)
	tss.ReportKeysignProgress(sessionID, 1, "waiting for peers", false)
	tss.ReportKeysignProgress(sessionID, 2, "starting DKLs keysign", false)
	dklsLogf(
		"nostr keysign: session=%s parties=%d starting mpc rounds",
		dkgSessionLogPrefix(sessionID),
		len(signSess.SigningIDs),
	)

	ctx, cancel := context.WithTimeout(tss.ActiveNostrContext(), cfg.MaxTimeout)
	defer cancel()
	RegisterCancel(sessionID, cancel)

	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return "", err
	}
	defer client.Close("dkls keysign complete")

	messenger := nostrtransport.NewMessenger(cfg, client)
	nm := &nostrMessenger{messenger: messenger, ctx: ctx, localNpub: localNpub}
	pump := nostrtransport.NewMessagePump(cfg, client)
	var peerAbort struct {
		sync.Mutex
		reason string
		set    bool
	}
	pump.SetOnAbort(func(reason string) {
		peerAbort.Lock()
		peerAbort.reason = reason
		peerAbort.set = true
		peerAbort.Unlock()
		cancel()
	})
	pumpCtx, pumpCancel := context.WithCancel(ctx)
	defer pumpCancel()

	roundCh := make(chan []libtss.Message, 256)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer recoverGoroutine("NostrJoinKeysign message pump")
		_ = pump.Run(pumpCtx, func(payload []byte) error {
			msgs, err := DecodeMessages(string(payload))
			if err != nil {
				// Keep the pump alive on malformed payloads to avoid cascading timeouts.
				dklsLogErrorf(
					"nostr keysign: session=%s dropping undecodable payload: %v",
					dkgSessionLogPrefix(sessionID),
					err,
				)
				return nil
			}
			in := filterMessagesFor(signSess.SelfID, msgs)
			if len(in) == 0 {
				return nil
			}
			dklsLogf(
				"nostr keysign: session=%s pump delivered %d msg(s) from %d sender(s)",
				dkgSessionLogPrefix(sessionID),
				len(in),
				peerSenderCount(in, signSess.SelfID),
			)
			select {
			case roundCh <- in:
			default:
				go func(batch []libtss.Message) {
					defer recoverGoroutine("NostrJoinKeysign roundCh batch send")
					roundCh <- batch
				}(in)
			}
			return nil
		})
	}()

	runner := &nostrPartyRunner{
		selfID:    signSess.SelfID,
		localNpub: localNpub,
		messenger: nm,
		peers:     append([]string{localNpub}, signSess.NostrPeers...),
	}
	sig, err := runSignWithSender(ctx, share, hash, []byte(sessionID), signSess.SelfID, signSess.SigningIDs, runner, roundCh, sessionID)
	pumpCancel()
	wg.Wait()
	if err != nil {
		peerAbort.Lock()
		set, reason := peerAbort.set, peerAbort.reason
		peerAbort.Unlock()
		if set {
			return "", nostrtransport.WrapPeerAbort(reason, err)
		}
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

// sortedPartiesNpubs matches mobile Nostr pairing (lexicographic npub order for stable party IDs).
func sortedPartiesNpubs(parties []string) []string {
	out := append([]string(nil), parties...)
	sort.Strings(out)
	return out
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
