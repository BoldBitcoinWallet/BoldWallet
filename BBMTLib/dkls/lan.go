package dkls

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

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
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("internal error (panic): %v", r)
			debug.PrintStack()
		}
	}()

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

	stopJoinPulse := make(chan struct{})
	defer close(stopJoinPulse)
	go func() {
		tick := 0
		for {
			select {
			case <-stopJoinPulse:
				return
			case <-time.After(2 * time.Second):
				tick++
				tss.ReportKeygenProgress(session, 1, fmt.Sprintf("waiting for devices (%d)", tick), false)
			}
		}
	}()

	if err := tss.LANAwaitJoiners(parties, server, session); err != nil {
		return "", fmt.Errorf("await joiners: %w", err)
	}
	tss.ReportKeygenProgress(session, 2, "starting DKLs DKG", false)

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
	roundCh := make(chan []libtss.Message, 16)
	var wg sync.WaitGroup
	wg.Add(1)
	go startLANMessagePump(server, session, sessionKey, key, func(body string) error {
		msgs, decErr := DecodeMessages(body)
		if decErr != nil {
			return decErr
		}
		in := filterMessagesFor(selfID, msgs)
		if len(in) == 0 {
			return nil
		}
		roundCh <- in
		return nil
	}, endCh, &wg)

	sidBytes := []byte(session)
	if decoded, decErr := hex.DecodeString(session); decErr == nil && len(decoded) > 0 {
		sidBytes = decoded
	}
	share, _, err := runDKGWithSender(session, selfID, sidBytes, threshold, runner, roundCh)
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

func recvPeerMessageBatch(
	roundCh <-chan []libtss.Message,
	selfID libtss.Identifier,
	needPeerMsgs int,
	deadline time.Time,
	peerQuiesce time.Duration,
) ([]libtss.Message, error) {
	var batch []libtss.Message
	senders := make(map[libtss.Identifier]struct{})
	add := func(part []libtss.Message) {
		batch = append(batch, part...)
		for _, m := range part {
			if m.From != 0 && m.From != selfID {
				senders[m.From] = struct{}{}
			}
		}
	}
	for len(senders) < needPeerMsgs {
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("DKLs timed out waiting for peer messages")
		}
		select {
		case part := <-roundCh:
			if len(part) > 0 {
				add(part)
			}
			for {
				select {
				case more := <-roundCh:
					if len(more) > 0 {
						add(more)
					}
				default:
					goto waitMore
				}
			}
		waitMore:
			if len(senders) >= needPeerMsgs {
				break
			}
			select {
			case part := <-roundCh:
				if len(part) > 0 {
					add(part)
				}
			case <-time.After(peerQuiesce):
			}
		case <-time.After(200 * time.Millisecond):
		}
	}
	return batch, nil
}

func filterMessagesFor(selfID libtss.Identifier, msgs []libtss.Message) []libtss.Message {
	out := make([]libtss.Message, 0, len(msgs))
	for _, msg := range msgs {
		if msg.To == 0 || msg.To == selfID {
			out = append(out, msg)
		}
	}
	return out
}

func runDKGWithSender(
	progressSession string,
	selfID libtss.Identifier,
	sessionID []byte,
	threshold libtss.ThresholdConfig,
	sender messageSender,
	roundCh <-chan []libtss.Message,
) (*libtss.KeyShareHandle, libtss.PublicKeyPackage, error) {
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

	deadline := time.Now().Add(5 * time.Minute)
	needPeerMsgs := int(threshold.MaxSigners) - 1
	peerQuiesce := 400 * time.Millisecond
	recvBatch := func() ([]libtss.Message, error) {
		return recvPeerMessageBatch(roundCh, selfID, needPeerMsgs, deadline, peerQuiesce)
	}
	for {
		if time.Now().After(deadline) {
			return nil, libtss.PublicKeyPackage{}, fmt.Errorf("DKLs DKG timed out waiting for peer messages")
		}
		var batch []libtss.Message
		var step libtss.DKGStep
		var err error
		for {
			if len(batch) == 0 {
				batch, err = recvBatch()
				if err != nil {
					return nil, libtss.PublicKeyPackage{}, err
				}
			}
			step, err = session.Next(batch)
			if err != nil && dkgNeedsMorePeerMessages(err) {
				more, recvErr := recvBatch()
				if recvErr != nil {
					return nil, libtss.PublicKeyPackage{}, recvErr
				}
				batch = append(batch, more...)
				continue
			}
			break
		}
		if step.Complete {
			if err != nil {
				return nil, libtss.PublicKeyPackage{}, err
			}
			return step.KeyShare, step.PublicKeyPackage, nil
		}
		if err != nil {
			return nil, libtss.PublicKeyPackage{}, err
		}
		tss.ReportKeygenProgress(progressSession, stepNo, "DKLs DKG round", false)
		stepNo++
		if err := sender.sendMessages(step.Messages); err != nil {
			return nil, libtss.PublicKeyPackage{}, err
		}
	}
}

// JoinKeysign performs LAN DKLs23 signing and returns signature JSON.
func JoinKeysign(server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshareJSON, message string) (string, error) {
	defer tss.ClearLANTransportKeys()
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

	hash := HashMessageForDKLs([]byte(message))
	if err := lanPrepareKeysignProgress(server, session, key, parties); err != nil {
		return "", err
	}

	messenger := tss.NewLANMessenger(server, session, sessionKey)
	runner := &lanPartyRunner{
		selfID:    signSess.SelfID,
		localKey:  key,
		peerIDs:   signSess.SigningIDs,
		messenger: messenger,
	}

	roundCh := make(chan []libtss.Message, 16)
	endCh := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go startLANMessagePump(server, session, sessionKey, key, func(body string) error {
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

	sig, err := runSignWithSender(share, hash, []byte(session), signSess.SelfID, signSess.SigningIDs, runner, roundCh, session)
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

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func runSignWithSender(
	share *libtss.KeyShareHandle,
	message, signID []byte,
	selfID libtss.Identifier,
	signingParties []libtss.Identifier,
	sender messageSender,
	roundCh <-chan []libtss.Message,
	progressSession string,
) (libtss.Signature, error) {
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

	deadline := time.Now().Add(5 * time.Minute)
	needPeerMsgs := len(counterparties)
	if needPeerMsgs < 1 {
		needPeerMsgs = 1
	}
	peerQuiesce := 400 * time.Millisecond
	recvBatch := func() ([]libtss.Message, error) {
		return recvPeerMessageBatch(roundCh, selfID, needPeerMsgs, deadline, peerQuiesce)
	}

	stepNo := 3
	for {
		if time.Now().After(deadline) {
			return libtss.Signature{}, fmt.Errorf("DKLs keysign timed out waiting for peer messages")
		}
		var batch []libtss.Message
		var step libtss.SignStep
		for {
			if len(batch) == 0 {
				var recvErr error
				batch, recvErr = recvBatch()
				if recvErr != nil {
					return libtss.Signature{}, recvErr
				}
			}
			step, err = session.Next(batch)
			if err != nil && mpcNeedsMorePeerMessages(err) {
				more, recvErr := recvBatch()
				if recvErr != nil {
					return libtss.Signature{}, recvErr
				}
				batch = append(batch, more...)
				continue
			}
			break
		}
		if step.Complete {
			if err != nil {
				return libtss.Signature{}, err
			}
			step.Signature.Protocol = libtss.ProtocolDKLs23
			return step.Signature, nil
		}
		if err != nil {
			return libtss.Signature{}, err
		}
		if progressSession != "" {
			tss.ReportKeysignProgress(progressSession, stepNo, "DKLs keysign round", false)
			stepNo++
		}
		if err := sender.sendMessages(step.Messages); err != nil {
			return libtss.Signature{}, err
		}
	}
}

type messageSender interface {
	sendMessages([]libtss.Message) error
}
