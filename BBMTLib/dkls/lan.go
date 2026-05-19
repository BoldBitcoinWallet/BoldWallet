package dkls

import (
	"encoding/json"
	"fmt"
	"runtime/debug"
	"sync"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

type lanPartyRunner struct {
	selfID    libtss.Identifier
	localKey  string
	peerIDs   []libtss.Identifier
	router    *MessageRouter
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

// JoinKeygen performs LAN DKG via HTTP relay (duo 2-of-2 or trio 2-of-3).
func JoinKeygen(key, partiesCSV, session, server, chaincode, sessionKey string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("internal error (panic): %v", r)
			debug.PrintStack()
		}
	}()

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
	tss.ReportKeygenProgress(session, 2, "starting DKLs DKG", false)

	selfID := partyIDFromKey(key)
	router := NewMessageRouter(PartyIdentifiers(len(parties)))
	messenger := tss.NewLANMessenger(server, session, sessionKey)
	peerIDs := PartyIdentifiers(len(parties))
	runner := &lanPartyRunner{
		selfID:    selfID,
		localKey:  key,
		peerIDs:   peerIDs,
		router:    router,
		messenger: messenger,
	}

	endCh := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go startLANMessagePump(server, session, sessionKey, key, func(body string) error {
		msgs, decErr := DecodeMessages(body)
		if decErr != nil {
			return decErr
		}
		router.Post(selfID, msgs)
		return nil
	}, endCh, &wg)

	share, _, err := runDKGWithSender(session, selfID, []byte(session), threshold, runner, router)
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
	_ = tss.LANEndSession(server, session)
	_ = tss.LANFlagPartyComplete(server, session, key)
	return ksJSON, nil
}

func runDKGWithSender(
	progressSession string,
	selfID libtss.Identifier,
	sessionID []byte,
	threshold libtss.ThresholdConfig,
	sender messageSender,
	router *MessageRouter,
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

	for {
		in := router.Drain(selfID)
		if len(in) == 0 {
			time.Sleep(100 * time.Millisecond)
			continue
		}
		step, err := session.Next(in)
		if err != nil {
			return nil, libtss.PublicKeyPackage{}, err
		}
		if step.Complete {
			return step.KeyShare, step.PublicKeyPackage, nil
		}
		tss.ReportKeygenProgress(progressSession, stepNo, "DKLs DKG round", false)
		stepNo++
		if err := sender.sendMessages(step.Messages); err != nil {
			return nil, libtss.PublicKeyPackage{}, err
		}
	}
}

// JoinKeysign performs LAN DKLs23 signing and returns signature JSON.
func JoinKeysign(server, key, partiesCSV, session, sessionKey, keyshareJSON, message string) (string, error) {
	share, ks, err := ImportKeyshare(keyshareJSON)
	if err != nil {
		return "", err
	}
	defer share.Free()

	parties := splitCSV(partiesCSV)
	if err := tss.LANJoinSession(server, session, key); err != nil {
		return "", err
	}
	if err := tss.LANAwaitJoiners(parties, server, session); err != nil {
		return "", err
	}

	signSess, err := ResolveSigningSessionLAN(share, ks, partiesCSV)
	if err != nil {
		return "", err
	}

	hash := HashMessageForDKLs([]byte(message))
	tss.InitKeysignProgress(session)

	router := NewMessageRouter(signSess.SigningIDs)
	messenger := tss.NewLANMessenger(server, session, sessionKey)
	runner := &lanPartyRunner{
		selfID:    signSess.SelfID,
		localKey:  key,
		peerIDs:   signSess.SigningIDs,
		router:    router,
		messenger: messenger,
	}

	endCh := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go startLANMessagePump(server, session, sessionKey, key, func(body string) error {
		msgs, decErr := DecodeMessages(body)
		if decErr != nil {
			return decErr
		}
		router.Post(signSess.SelfID, msgs)
		return nil
	}, endCh, &wg)

	sig, err := runSignWithSender(share, hash, []byte(session), signSess.SelfID, signSess.SigningIDs, runner, router, session)
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
	_ = tss.LANEndSession(server, session)
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
	router *MessageRouter,
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

	stepNo := 3
	for {
		in := router.Drain(selfID)
		if len(in) == 0 {
			time.Sleep(100 * time.Millisecond)
			continue
		}
		step, err := session.Next(in)
		if err != nil {
			return libtss.Signature{}, err
		}
		if step.Complete {
			step.Signature.Protocol = libtss.ProtocolDKLs23
			return step.Signature, nil
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
