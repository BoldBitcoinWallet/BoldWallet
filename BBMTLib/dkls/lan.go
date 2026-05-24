package dkls

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

func dkgDeadline() time.Time {
	return mpcDeadline(5 * time.Minute)
}

func signDeadline() time.Time {
	return mpcDeadline(5 * time.Minute)
}

func mpcDeadline(prod time.Duration) time.Time {
	sec := int(prod.Seconds())
	if v := os.Getenv("DKLS_TEST_DKG_SEC"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			sec = n
		}
	}
	return time.Now().Add(time.Duration(sec) * time.Second)
}

// waitForRelayHTTP blocks until the LAN relay accepts HTTP or maxWait elapses.
func waitForRelayHTTP(server string, maxWait time.Duration) {
	deadline := time.Now().Add(maxWait)
	client := &http.Client{Timeout: 300 * time.Millisecond}
	for time.Now().Before(deadline) {
		resp, err := client.Get(server)
		if err == nil {
			resp.Body.Close()
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
}

type lanPartyRunner struct {
	selfID    libtss.Identifier
	localKey  string
	peerIDs   []libtss.Identifier
	messenger tss.Messenger
}

func (r *lanPartyRunner) sendMessages(msgs []libtss.Message) error {
	body, err := EncodeMessages(msgs)
	if err != nil {
		return err
	}
	for _, id := range r.peerIDs {
		if id == r.selfID {
			continue
		}
		toKey := partyKeyForID(id)
		if err := r.messenger.Send(r.localKey, toKey, body); err != nil {
			return err
		}
	}
	return nil
}

// lanPrepareKeysignProgress mirrors LAN keygen steps 0–2 before MPC sign rounds.
func lanPrepareKeysignProgress(server, session, key string, parties []string) error {
	tss.InitKeysignProgress(session)
	if err := tss.LANJoinSession(server, session, key); err != nil {
		return fmt.Errorf("register session: %w", err)
	}
	tss.ReportKeysignProgress(session, 1, "waiting parties", false)
	stopSignPulse := make(chan struct{})
	defer close(stopSignPulse)
	go func() {
		tick := 0
		for {
			select {
			case <-stopSignPulse:
				return
			case <-time.After(2 * time.Second):
				tick++
				tss.ReportKeysignProgress(session, 1, fmt.Sprintf("waiting for devices (%d)", tick), false)
			}
		}
	}()
	if err := tss.LANAwaitJoiners(parties, server, session); err != nil {
		return fmt.Errorf("await joiners: %w", err)
	}
	tss.ReportKeysignProgress(session, 2, "starting DKLs keysign", false)
	return nil
}

// normalizeLANTransportKeys applies GG18 LAN rules: trio AES session key or duo ECIES enc/dec.
// If all three are empty (legacy callers / tests), derives AES session key from session + server.
func normalizeLANTransportKeys(session, server, sessionKey, encKey, decKey string) (string, string, string, error) {
	if len(sessionKey) == 0 && len(encKey) == 0 && len(decKey) == 0 {
		sk, err := tss.DeriveLANSessionKey(session, server)
		if err != nil {
			return "", "", "", err
		}
		sessionKey = sk
	}
	if err := tss.ConfigureLANTransportKeys(sessionKey, encKey, decKey); err != nil {
		return "", "", "", err
	}
	return sessionKey, encKey, decKey, nil
}

// JoinKeygen performs LAN DKG via HTTP relay (duo 2-of-2 or trio 2-of-3).
func JoinKeygen(key, partiesCSV, session, server, chaincode, sessionKey, encKey, decKey string) (result string, err error) {
	defer tss.ClearLANTransportKeys()
	defer recoverAsError("JoinKeygen", &err, &result)

	if sessionKey, encKey, decKey, err = normalizeLANTransportKeys(session, server, sessionKey, encKey, decKey); err != nil {
		return "", err
	}

	parties := splitCSV(partiesCSV)
	threshold, err := ThresholdFromPartyCount(len(parties))
	if err != nil {
		return "", err
	}

	tss.InitKeygenProgress(session)

	if err := tss.LANJoinSession(server, session, key); err != nil {
		return "", fmt.Errorf("register session: %w", err)
	}
	tss.ReportKeygenProgress(session, 1, "waiting parties", false)

	if err := tss.LANAwaitJoiners(parties, server, session); err != nil {
		return "", fmt.Errorf("await joiners: %w", err)
	}
	tss.ReportKeygenProgress(session, 2, "starting keygen", false)
	dklsLogf(
		"LAN DKG: session=%s parties=%d starting mpc rounds",
		dkgSessionLogPrefix(session),
		len(parties),
	)

	selfID := partyIDFromKey(key)
	messenger := tss.NewLANMessenger(server, session, sessionKey)
	peerIDs := PartyIdentifiers(len(parties))
	runner := &lanPartyRunner{
		selfID:    selfID,
		localKey:  key,
		peerIDs:   peerIDs,
		messenger: messenger,
	}

	endCh := make(chan struct{})
	// Large buffer: pump must not block while runDKG is inside session.Next (sync).
	roundCh := make(chan []libtss.Message, 256)
	var wg sync.WaitGroup
	wg.Add(1)
	go startLANMessagePump(server, session, sessionKey, key, func(body string) error {
		msgs, decErr := DecodeMessages(body)
		if decErr != nil {
			return decErr
		}
		in := dedupeDKGInboundBySender(selfID, msgs)
		if len(in) == 0 {
			return nil
		}
		select {
		case roundCh <- in:
		default:
			go func(batch []libtss.Message) {
				defer recoverGoroutine("JoinKeygen roundCh batch send")
				roundCh <- batch
			}(in)
		}
		return nil
	}, endCh, &wg)

	sidBytes := []byte(session)
	if decoded, decErr := hex.DecodeString(session); decErr == nil && len(decoded) > 0 {
		sidBytes = decoded
	}
	share, _, err := runDKGWithSender(context.Background(), session, selfID, sidBytes, threshold, runner, roundCh)
	close(endCh)
	wg.Wait()
	if err != nil {
		return "", err
	}
	defer share.Free()

	ksJSON, err := KeyshareJSONFromHandle(share, chaincode, parties, key, "", "")
	if err != nil {
		return "", err
	}
	tss.ReportKeygenProgress(session, 99, "keygen ok", true)
	// Do not call LANEndSession here — the first party to finish would delete the relay
	// session while the peer is still in DKG (breaks duo LAN setup on device).
	_ = tss.LANFlagPartyComplete(server, session, key)
	return ksJSON, nil
}

// mpcNeedsMorePeerMessages reports whether session.Next should wait for more inbound
// messages (e.g. trio LAN may deliver one HTTP message per peer per round).
func mpcNeedsMorePeerMessages(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "not found for sender") ||
		strings.Contains(s, "missing DKG fragment") ||
		strings.Contains(s, "missing sign") ||
		strings.Contains(s, "missing ")
}

func dkgNeedsMorePeerMessages(err error) bool {
	return mpcNeedsMorePeerMessages(err)
}

func peerSenderCount(batch []libtss.Message, selfID libtss.Identifier) int {
	seen := make(map[libtss.Identifier]struct{})
	for _, m := range filterMessagesFor(selfID, batch) {
		if m.From != 0 && m.From != selfID {
			seen[m.From] = struct{}{}
		}
	}
	if len(seen) > 0 {
		return len(seen)
	}
	if len(filterMessagesFor(selfID, batch)) > 0 {
		return 1
	}
	return 0
}

func recvPeerMessageBatch(
	ctx context.Context,
	roundCh <-chan []libtss.Message,
	selfID libtss.Identifier,
	needPeerMsgs int,
	deadline time.Time,
	peerQuiesce time.Duration,
) ([]libtss.Message, error) {
	var batch []libtss.Message
	add := func(part []libtss.Message) {
		if len(part) > 0 {
			batch = mergeDKGPeerMessages(batch, part, selfID)
		}
	}
	for peerSenderCount(batch, selfID) < needPeerMsgs {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("DKLs operation canceled: %w", ctx.Err())
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("DKLs timed out waiting for peer messages")
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("DKLs operation canceled: %w", ctx.Err())
		case part := <-roundCh:
			add(part)
			for {
				select {
				case more := <-roundCh:
					add(more)
				default:
					goto quiesce
				}
			}
		quiesce:
			if peerSenderCount(batch, selfID) >= needPeerMsgs {
				break
			}
			select {
			case more := <-roundCh:
				add(more)
			case <-time.After(peerQuiesce):
			}
		case <-time.After(200 * time.Millisecond):
		}
	}
	return dedupeDKGBatchBySender(batch, selfID), nil
}

// recvMorePeerMessages waits for at least one additional inbound message (any sender).
// Used after session.Next reports missing fragments; recvPeerMessageBatch would wrongly
// require N distinct senders again and stall when the next fragment is from an existing peer.
func recvMorePeerMessages(
	roundCh <-chan []libtss.Message,
	selfID libtss.Identifier,
	deadline time.Time,
	peerQuiesce time.Duration,
) ([]libtss.Message, error) {
	var batch []libtss.Message
	add := func(part []libtss.Message) {
		if len(part) > 0 {
			batch = mergeDKGPeerMessages(batch, part, selfID)
		}
	}
	for len(filterMessagesFor(selfID, batch)) == 0 {
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("DKLs timed out waiting for peer messages")
		}
		select {
		case part := <-roundCh:
			add(part)
			for {
				select {
				case more := <-roundCh:
					add(more)
				default:
					goto quiesce
				}
			}
		quiesce:
			if len(filterMessagesFor(selfID, batch)) > 0 {
				break
			}
			select {
			case more := <-roundCh:
				add(more)
			case <-time.After(peerQuiesce):
			}
		case <-time.After(200 * time.Millisecond):
		}
	}
	select {
	case part := <-roundCh:
		add(part)
		for {
			select {
			case more := <-roundCh:
				add(more)
			default:
				return dedupeDKGBatchBySender(batch, selfID), nil
			}
		}
	case <-time.After(peerQuiesce):
	}
	return dedupeDKGBatchBySender(batch, selfID), nil
}

func mergeDKGPeerMessages(batch []libtss.Message, incoming []libtss.Message, selfID libtss.Identifier) []libtss.Message {
	for _, msg := range filterMessagesFor(selfID, incoming) {
		batch = append(batch, msg)
	}
	return batch
}

func dedupeDKGBatchBySender(batch []libtss.Message, _ libtss.Identifier) []libtss.Message {
	// Drop exact relay retries (same from/to/payload). Do not collapse distinct
	// fragments from the same sender (e.g. broadcast + direct); that stalls
	// runDKGWithSender when recvMorePeerMessages merges follow-up fragments.
	seen := make(map[string]struct{}, len(batch))
	out := make([]libtss.Message, 0, len(batch))
	for _, msg := range batch {
		key := fmt.Sprintf("%d:%d:%x", msg.From, msg.To, msg.Data)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, msg)
	}
	return out
}

func dedupeDKGInboundBySender(selfID libtss.Identifier, msgs []libtss.Message) []libtss.Message {
	return dedupeDKGBatchBySender(mergeDKGPeerMessages(nil, msgs, selfID), selfID)
}

func filterMessagesFor(selfID libtss.Identifier, msgs []libtss.Message) []libtss.Message {
	out := make([]libtss.Message, 0, len(msgs))
	for _, msg := range msgs {
		if msg.From == selfID {
			continue
		}
		if msg.To == 0 || msg.To == selfID {
			out = append(out, msg)
		}
	}
	return out
}

// dkgRoundRecvPulse re-reports keygen progress while blocked waiting on peer fragments.
// Uses the current stepNo so DKLS UI percent can advance during long Nostr/LAN receives.
func dkgRoundRecvPulse(progressSession string, pulseStep int, stop <-chan struct{}) {
	tick := 0
	for {
		select {
		case <-stop:
			return
		case <-time.After(3 * time.Second):
			tick++
			dklsLogf(
				"DKG: session=%s step=%d recv heartbeat tick=%d",
				dkgSessionLogPrefix(progressSession),
				pulseStep,
				tick,
			)
			tss.ReportKeygenProgress(
				progressSession,
				pulseStep,
				fmt.Sprintf("keygen round (receiving %d)", tick),
				false,
			)
		}
	}
}

func signRoundRecvPulse(progressSession string, pulseStep int, stop <-chan struct{}) {
	tick := 0
	for {
		select {
		case <-stop:
			return
		case <-time.After(3 * time.Second):
			tick++
			dklsLogf(
				"keysign: session=%s step=%d recv heartbeat tick=%d",
				dkgSessionLogPrefix(progressSession),
				pulseStep,
				tick,
			)
			if progressSession != "" {
				tss.ReportKeysignProgress(
					progressSession,
					pulseStep,
					fmt.Sprintf("DKLs keysign round (receiving %d)", tick),
					false,
				)
			}
		}
	}
}

func dkgSessionLogPrefix(session string) string {
	session = strings.TrimSpace(session)
	if len(session) <= 8 {
		return session
	}
	return session[:8]
}

func runDKGWithSender(
	ctx context.Context,
	progressSession string,
	selfID libtss.Identifier,
	sessionID []byte,
	threshold libtss.ThresholdConfig,
	sender messageSender,
	roundCh <-chan []libtss.Message,
) (share *libtss.KeyShareHandle, pub libtss.PublicKeyPackage, err error) {
	defer recoverAsErrorClear("runDKGWithSender", &err, func() {
		share = nil
		pub = libtss.PublicKeyPackage{}
	})
	if err := libtss.Init(); err != nil {
		return nil, libtss.PublicKeyPackage{}, err
	}
	session, outMsgs, err := libtss.NewDKGSession(threshold, selfID, sessionID)
	if err != nil {
		return nil, libtss.PublicKeyPackage{}, err
	}
	defer session.Free()

	stepNo := 3
	if err := sender.sendMessages(outMsgs); err != nil {
		return nil, libtss.PublicKeyPackage{}, err
	}

	deadline := dkgDeadline()
	needPeerMsgs := int(threshold.MaxSigners) - 1
	if needPeerMsgs < 1 {
		needPeerMsgs = 1
	}
	peerQuiesce := 400 * time.Millisecond
	if threshold.MaxSigners >= 3 {
		peerQuiesce = 800 * time.Millisecond
	}
	recvBatch := func() ([]libtss.Message, error) {
		return recvPeerMessageBatch(ctx, roundCh, selfID, needPeerMsgs, deadline, peerQuiesce)
	}
	for {
		if ctx.Err() != nil {
			return nil, libtss.PublicKeyPackage{}, fmt.Errorf("DKLs DKG canceled: %w", ctx.Err())
		}
		if time.Now().After(deadline) {
			dklsLogErrorf(
				"DKG: session=%s timed out waiting for peer messages",
				dkgSessionLogPrefix(progressSession),
			)
			return nil, libtss.PublicKeyPackage{}, fmt.Errorf("DKLs DKG timed out waiting for peer messages")
		}
		var batch []libtss.Message
		var step libtss.DKGStep
		var err error
		for {
			if len(batch) == 0 {
				pulseStep := stepNo
				if pulseStep < 3 {
					pulseStep = 3
				}
				stopPulse := make(chan struct{})
				go dkgRoundRecvPulse(progressSession, pulseStep, stopPulse)
				waitStart := time.Now()
				dklsLogf(
					"DKG: session=%s step=%d waiting for %d peer batch(es)",
					dkgSessionLogPrefix(progressSession),
					pulseStep,
					needPeerMsgs,
				)
				batch, err = recvBatch()
				close(stopPulse)
				if err != nil {
					dklsLogf(
						"DKG: session=%s step=%d recv failed after %s: %v",
						dkgSessionLogPrefix(progressSession),
						pulseStep,
						time.Since(waitStart).Round(time.Second),
						err,
					)
					return nil, libtss.PublicKeyPackage{}, err
				}
				dklsLogf(
					"DKG: session=%s step=%d got %d peer sender(s) after %s",
					dkgSessionLogPrefix(progressSession),
					pulseStep,
					peerSenderCount(batch, selfID),
					time.Since(waitStart).Round(time.Second),
				)
			}
			batch = dedupeDKGBatchBySender(batch, selfID)
			step, err = session.Next(batch)
			if err != nil && dkgNeedsMorePeerMessages(err) {
				dklsLogf(
					"DKG: session=%s step=%d need more fragments from peers",
					dkgSessionLogPrefix(progressSession),
					stepNo,
				)
				more, recvErr := recvMorePeerMessages(roundCh, selfID, deadline, peerQuiesce)
				if recvErr != nil {
					return nil, libtss.PublicKeyPackage{}, recvErr
				}
				dklsLogf(
					"DKG: session=%s step=%d merged %d extra fragment(s)",
					dkgSessionLogPrefix(progressSession),
					stepNo,
					len(filterMessagesFor(selfID, more)),
				)
				batch = dedupeDKGBatchBySender(mergeDKGPeerMessages(batch, more, selfID), selfID)
				continue
			}
			break
		}
		if step.Complete {
			if err != nil {
				return nil, libtss.PublicKeyPackage{}, err
			}
			dklsLogf(
				"DKG: session=%s complete after step=%d",
				dkgSessionLogPrefix(progressSession),
				stepNo,
			)
			return step.KeyShare, step.PublicKeyPackage, nil
		}
		if err != nil {
			return nil, libtss.PublicKeyPackage{}, err
		}
		tss.ReportKeygenProgress(progressSession, stepNo, "keygen round", false)
		dklsLogf(
			"DKG: session=%s step=%d keygen round sent (%d outbound msgs)",
			dkgSessionLogPrefix(progressSession),
			stepNo,
			len(step.Messages),
		)
		stepNo++
		if err := sender.sendMessages(step.Messages); err != nil {
			return nil, libtss.PublicKeyPackage{}, err
		}
	}
}

// JoinKeysign performs LAN DKLs23 signing and returns signature JSON.
func JoinKeysign(server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshareJSON, message string) (result string, err error) {
	defer tss.ClearLANTransportKeys()
	defer recoverAsError("JoinKeysign", &err, &result)
	if _, _, _, err := normalizeLANTransportKeys(session, server, sessionKey, encKey, decKey); err != nil {
		return "", err
	}

	share, ks, err := ImportKeyshare(keyshareJSON)
	if err != nil {
		return "", err
	}
	defer share.Free()

	parties := splitCSV(partiesCSV)
	signSess, err := ResolveSigningSessionLAN(share, ks, partiesCSV)
	if err != nil {
		return "", err
	}

	relayKey, err := ensureLANRelayJoinKey(key, signSess.SelfID, ks.KeygenCommitteeKeys)
	if err != nil {
		return "", err
	}

	hash := HashMessageForDKLs([]byte(message))
	if err := lanPrepareKeysignProgress(server, session, relayKey, parties); err != nil {
		return "", err
	}
	dklsLogf(
		"LAN keysign: session=%s parties=%d starting mpc rounds",
		dkgSessionLogPrefix(session),
		len(parties),
	)

	messenger := tss.NewLANMessenger(server, session, sessionKey)
	runner := &lanPartyRunner{
		selfID:    signSess.SelfID,
		localKey:  relayKey,
		peerIDs:   signSess.LANPeerIDs,
		messenger: messenger,
	}

	roundCh := make(chan []libtss.Message, 256)
	endCh := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go startLANMessagePump(server, session, sessionKey, relayKey, func(body string) error {
		msgs, decErr := DecodeMessages(body)
		if decErr != nil {
			return decErr
		}
		in := filterMessagesFor(signSess.SelfID, msgs)
		if len(in) == 0 {
			return nil
		}
		roundCh <- in
		return nil
	}, endCh, &wg)

	sig, err := runSignWithSender(context.Background(), share, hash, []byte(session), signSess.SelfID, signSess.SigningIDs, runner, roundCh, session)
	close(endCh)
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
	// Do not call LANEndSession — first finisher would delete relay while peer still signs.
	tss.ReportKeysignProgress(session, 99, "keysign ok", true)
	return string(raw), nil
}

func runSignWithSender(
	ctx context.Context,
	share *libtss.KeyShareHandle,
	message, signID []byte,
	selfID libtss.Identifier,
	signingParties []libtss.Identifier,
	sender messageSender,
	roundCh <-chan []libtss.Message,
	progressSession string,
) (sig libtss.Signature, err error) {
	defer recoverAsErrorClear("runSignWithSender", &err, func() { sig = libtss.Signature{} })
	var counterparties []libtss.Identifier
	for _, id := range signingParties {
		if id != selfID {
			counterparties = append(counterparties, id)
		}
	}
	session, outMsgs, err := libtss.NewSignSession(share, message, counterparties, signID)
	if err != nil {
		return libtss.Signature{}, err
	}
	defer session.Free()

	if err := sender.sendMessages(outMsgs); err != nil {
		return libtss.Signature{}, err
	}

	deadline := signDeadline()
	needPeerMsgs := len(counterparties)
	if needPeerMsgs < 1 {
		needPeerMsgs = 1
	}
	peerQuiesce := 400 * time.Millisecond
	recvBatch := func() ([]libtss.Message, error) {
		return recvPeerMessageBatch(ctx, roundCh, selfID, needPeerMsgs, deadline, peerQuiesce)
	}

	stepNo := 3
	for {
		if ctx.Err() != nil {
			return libtss.Signature{}, fmt.Errorf("DKLs keysign canceled: %w", ctx.Err())
		}
		if time.Now().After(deadline) {
			dklsLogErrorf(
				"keysign: session=%s timed out waiting for peer messages",
				dkgSessionLogPrefix(progressSession),
			)
			return libtss.Signature{}, fmt.Errorf("DKLs keysign timed out waiting for peer messages")
		}
		var batch []libtss.Message
		var step libtss.SignStep
		for {
			if len(batch) == 0 {
				pulseStep := stepNo
				if pulseStep < 3 {
					pulseStep = 3
				}
				stopPulse := make(chan struct{})
				if progressSession != "" {
					go signRoundRecvPulse(progressSession, pulseStep, stopPulse)
				}
				waitStart := time.Now()
				dklsLogf(
					"keysign: session=%s step=%d waiting for %d peer batch(es)",
					dkgSessionLogPrefix(progressSession),
					pulseStep,
					needPeerMsgs,
				)
				var recvErr error
				batch, recvErr = recvBatch()
				close(stopPulse)
				if recvErr != nil {
					dklsLogErrorf(
						"keysign: session=%s step=%d recv failed after %s: %v",
						dkgSessionLogPrefix(progressSession),
						pulseStep,
						time.Since(waitStart).Round(time.Second),
						recvErr,
					)
					return libtss.Signature{}, recvErr
				}
				dklsLogf(
					"keysign: session=%s step=%d got %d peer sender(s) after %s",
					dkgSessionLogPrefix(progressSession),
					pulseStep,
					peerSenderCount(batch, selfID),
					time.Since(waitStart).Round(time.Second),
				)
			}
			step, err = session.Next(batch)
			if err != nil && mpcNeedsMorePeerMessages(err) {
				dklsLogf(
					"keysign: session=%s step=%d need more fragments from peers",
					dkgSessionLogPrefix(progressSession),
					stepNo,
				)
				more, recvErr := recvMorePeerMessages(roundCh, selfID, deadline, peerQuiesce)
				if recvErr != nil {
					return libtss.Signature{}, recvErr
				}
				dklsLogf(
					"keysign: session=%s step=%d merged %d extra fragment(s)",
					dkgSessionLogPrefix(progressSession),
					stepNo,
					len(filterMessagesFor(selfID, more)),
				)
				batch = dedupeDKGBatchBySender(mergeDKGPeerMessages(batch, more, selfID), selfID)
				continue
			}
			break
		}
		if step.Complete {
			if err != nil {
				return libtss.Signature{}, err
			}
			dklsLogf(
				"keysign: session=%s complete after step=%d",
				dkgSessionLogPrefix(progressSession),
				stepNo,
			)
			step.Signature.Protocol = libtss.ProtocolDKLs23
			return step.Signature, nil
		}
		if err != nil {
			return libtss.Signature{}, err
		}
		if progressSession != "" {
			tss.ReportKeysignProgress(progressSession, stepNo, "DKLs keysign round", false)
		}
		dklsLogf(
			"keysign: session=%s step=%d keysign round sent (%d outbound msgs)",
			dkgSessionLogPrefix(progressSession),
			stepNo,
			len(step.Messages),
		)
		stepNo++
		if err := sender.sendMessages(step.Messages); err != nil {
			return libtss.Signature{}, err
		}
	}
}

type messageSender interface {
	sendMessages([]libtss.Message) error
}
