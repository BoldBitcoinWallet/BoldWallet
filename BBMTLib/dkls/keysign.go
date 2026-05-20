package dkls

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

func init() {
	tss.RegisterDKLsKeysignHandlers(NostrJoinKeysignWithSighash, JoinKeysignWithSighash)
}

func keysignResponseJSON(sig libtss.Signature, sighashBase64 string) (string, error) {
	if len(sig.Data) < 64 {
		return "", fmt.Errorf("invalid signature length %d", len(sig.Data))
	}
	rBytes := sig.Data[:32]
	sBytes := sig.Data[32:64]
	r := new(big.Int).SetBytes(rBytes)
	s := new(big.Int).SetBytes(sBytes)
	derSig, err := tss.GetDERSignature(r, s)
	if err != nil {
		return "", err
	}
	resp := tss.KeysignResponse{
		Msg:          sighashBase64,
		MsgHex:       hex.EncodeToString(rBytes),
		R:            hex.EncodeToString(rBytes),
		S:            hex.EncodeToString(sBytes),
		DerSignature: hex.EncodeToString(derSig),
	}
	raw, err := json.Marshal(resp)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// NostrJoinKeysignWithSighash signs a base64-encoded 32-byte Bitcoin sighash over Nostr.
func NostrJoinKeysignWithSighash(
	relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, keyshareJSON, derivationPath, sighashBase64 string,
) (string, error) {
	sighash, err := base64.StdEncoding.DecodeString(sighashBase64)
	if err != nil {
		return "", fmt.Errorf("decode sighash: %w", err)
	}
	if len(sighash) != 32 {
		return "", fmt.Errorf("invalid sighash length %d (expected 32)", len(sighash))
	}

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
		MaxTimeout:    90 * time.Second,
	}
	cfg.ApplyDefaults()
	if err := cfg.Validate(); err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), cfg.MaxTimeout)
	defer cancel()
	RegisterCancel(sessionID, cancel)

	tss.InitKeysignProgress(sessionID)

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

	participatingNpubs := splitCSV(partiesNpubsCSV)
	roundCh := make(chan []libtss.Message, 16)

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = pump.Run(pumpCtx, func(payload []byte) error {
			msgs, decErr := DecodeMessages(string(payload))
			if decErr != nil {
				return decErr
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
		peers:     participatingNpubs,
	}
	signingShare, err := deriveShareForSigning(share, derivationPath, ks.ChainCodeHex)
	if err != nil {
		return "", err
	}
	if signingShare != share {
		defer signingShare.Free()
	}
	sig, err := runSignWithSender(signingShare, sighash, []byte(sessionID), signSess.SelfID, signSess.SigningIDs, runner, roundCh, sessionID)
	pumpCancel()
	wg.Wait()
	if err != nil {
		return "", err
	}
	tss.ReportKeysignProgress(sessionID, 99, "keysign ok", true)
	return keysignResponseJSON(sig, sighashBase64)
}

// JoinKeysignWithSighash performs LAN DKLs23 signing for a base64-encoded 32-byte sighash.
func JoinKeysignWithSighash(
	server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshareJSON, derivePath, sighashBase64 string,
) (string, error) {
	defer tss.ClearLANTransportKeys()
	if _, _, _, err := normalizeLANTransportKeys(session, server, sessionKey, encKey, decKey); err != nil {
		return "", err
	}

	sighash, err := base64.StdEncoding.DecodeString(sighashBase64)
	if err != nil {
		return "", fmt.Errorf("decode sighash: %w", err)
	}
	if len(sighash) != 32 {
		return "", fmt.Errorf("invalid sighash length %d", len(sighash))
	}

	share, ks, err := ImportKeyshare(keyshareJSON)
	if err != nil {
		return "", err
	}
	defer share.Free()

	signSess, err := ResolveSigningSessionLAN(share, ks, partiesCSV)
	if err != nil {
		return "", err
	}

	parties := splitCSV(partiesCSV)
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

	signingShare, err := deriveShareForSigning(share, derivePath, ks.ChainCodeHex)
	if err != nil {
		return "", err
	}
	if signingShare != share {
		defer signingShare.Free()
	}
	sig, err := runSignWithSender(signingShare, sighash, []byte(session), signSess.SelfID, signSess.SigningIDs, runner, roundCh, session)
	close(endCh)
	wg.Wait()
	if err != nil {
		return "", err
	}
	tss.ReportKeysignProgress(session, 99, "keysign ok", true)
	return keysignResponseJSON(sig, sighashBase64)
}
