# Nostr Flow - Function Call Sequence

This document maps out the complete sequence of function calls when using Nostr for keygen and Bitcoin transactions in this library.

## Entry Points

### Keygen Entry Point

**<a href="tss/mpc_nostr.go#L132"><span style="color: #0066cc; font-weight: bold;">NostrJoinKeygen</span></a>** (`tss/mpc_nostr.go:132`)
- Main entry point for generating a shared key via Nostr
- Parameters: relays, party nsec, parties npubs, sessionID, sessionKey, chaincode, ppmPath
- Returns: keyshare JSON with Nostr fields

### Transaction Entry Point

**<a href="tss/mpc_nostr.go#L569"><span style="color: #0066cc; font-weight: bold;">NostrMpcSendBTC</span></a>** (`tss/mpc_nostr.go:569`)
- Main entry point for sending Bitcoin transactions via Nostr
- Parameters: relays, party nsec, parties npubs, session info, keyshare, addresses, amounts, fees

---

## Keygen Flow

### Keygen via Nostr

<pre>
<a href="tss/mpc_nostr.go#L132"><span style="color: #0066cc; font-weight: bold;">NostrJoinKeygen</span></a>(relaysCSV, partyNsec, partiesNpubsCSV, sessionID, sessionKey, chaincode, ppmPath)
  ├─> <a href="tss/mpc_nostr.go#L49"><span style="color: #0066cc; font-weight: bold;">DeriveNpubFromNsec</span></a>(partyNsec)
  │   └─> <a href="tss/mpc_nostr.go#L28"><span style="color: #0066cc; font-weight: bold;">decodeNsecFromBech32</span></a>(partyNsec)
  │       └─> nip19.Decode(nsec)
  │   └─> nostr.GetPublicKey(skHex)
  │   └─> nip19.EncodePublicKey(pkHex)
  │
  ├─> [Create config]
  │   └─> nostrtransport.Config{...}
  │
  └─> <a href="tss/mpc_nostr.go#L1059"><span style="color: #0066cc; font-weight: bold;">runNostrKeygenInternal</span></a>(cfg, chaincode, ppmPath, localNpub, sessionID)
      ├─> <a href="tss/nostrtransport/client.go#L35"><span style="color: #0066cc; font-weight: bold;">nostrtransport.NewClient</span></a>(cfg)
      │   └─> nostr.NewSimplePool(ctx)
      │   └─> pool.EnsureRelay(relayURL)  // For each relay
      │
      ├─> nostrtransport.NewSessionCoordinator(cfg, client)
      │
      ├─> <a href="tss/nostrtransport/session.go#L235"><span style="color: #0066cc; font-weight: bold;">coordinator.PublishReady</span></a>(ctx)
      │   └─> <a href="tss/nostrtransport/client.go#L81"><span style="color: #0066cc; font-weight: bold;">client.Publish</span></a>(ctx, readyEvent)
      │       └─> event.Sign(nsecHex)
      │       └─> pool.PublishMany(ctx, urls, *event)
      │
      ├─> time.Sleep(500ms)  // Allow propagation
      │
      ├─> <a href="tss/nostrtransport/session.go#L31"><span style="color: #0066cc; font-weight: bold;">coordinator.AwaitPeers</span></a>(ctx)
      │   ├─> <a href="tss/nostrtransport/client.go#L256"><span style="color: #0066cc; font-weight: bold;">client.Subscribe</span></a>(ctx, filter)  // Subscribe to ready events (kind:30301)
      │   └─> [Wait for all peers' ready events]
      │
      ├─> <a href="tss/nostrtransport/messenger.go#L18"><span style="color: #0066cc; font-weight: bold;">nostrtransport.NewMessenger</span></a>(cfg, client)
      │
      ├─> &nostrMessengerAdapter{messenger, ctx}
      │
      ├─> &nostrLocalStateAccessor{saveFunc}
      │
      ├─> <a href="tss/tss.go#L116"><span style="color: #0066cc; font-weight: bold;">NewService</span></a>(messengerAdapter, stateAccessor, true, ppmPath)
      │   └─> [Load or generate pre-params if needed]
      │
      ├─> <a href="tss/nostrtransport/pump.go#L28"><span style="color: #0066cc; font-weight: bold;">nostrtransport.NewMessagePump</span></a>(cfg, client)
      │
      ├─> [GOROUTINE] <a href="tss/nostrtransport/pump.go#L38"><span style="color: #0066cc; font-weight: bold;">pump.Run</span></a>(pumpCtx, handler)
      │   └─> <a href="tss/nostrtransport/client.go#L256"><span style="color: #0066cc; font-weight: bold;">client.Subscribe</span></a>(ctx, filter)  // Subscribe to gift wraps (kind:1059)
      │       └─> pool.SubscribeMany(ctx, urls, filter)
      │
      ├─> <a href="tss/tss.go#L186"><span style="color: #0066cc; font-weight: bold;">tssService.KeygenECDSA</span></a>(&KeygenRequest{...})
      │   ├─> hex.DecodeString(chainCodeHex)
      │   ├─> getParties(allParties, localPartyID)
      │   │   └─> tss.NewPartyID(...)
      │   │   └─> tss.SortPartyIDs(...)
      │   │
      │   ├─> tss.NewPeerContext(partyIDs)
      │   ├─> tss.NewParameters(curve, ctx, localPartyID, totalPartiesCount, threshold)
      │   ├─> ecdsaKeygen.NewLocalParty(params, outCh, endCh, preParams)
      │   │
      │   └─> [GOROUTINE] localPartyECDSA.Start()
      │
      └─> <a href="tss/tss.go#L262"><span style="color: #0066cc; font-weight: bold;">processKeygen</span></a>(localParty, errCh, outCh, endCh, localState, sortedPartyIds)
          └─> [Event loop]
              ├─> [Case: outCh]  // Outgoing TSS message
              │   ├─> msg.WireBytes()
              │   ├─> json.MarshalIndent(MessageFromTss{...})
              │   ├─> base64.StdEncoding.EncodeToString(jsonBytes)
              │   └─> messengerAdapter.Send(from, to, payload)
              │       └─> <a href="tss/nostrtransport/messenger.go#L29"><span style="color: #0066cc; font-weight: bold;">messenger.SendMessage</span></a>(ctx, from, to, body)
              │           └─> [Same chunking/encryption flow as keysign]
              │
              ├─> [Case: inboundMessageCh]  // Incoming TSS message
              │   └─> <a href="tss/tss.go#L235"><span style="color: #0066cc; font-weight: bold;">applyMessageToTssInstance</span></a>(localParty, msg, sortedPartyIds)
              │       ├─> base64.StdEncoding.DecodeString(msg)
              │       ├─> json.Unmarshal(originalBytes, &msgFromTss)
              │       └─> localParty.UpdateFromBytes(msgFromTss.WireBytes, fromParty, isBroadcast)
              │
              └─> [Case: ecdsaEndCh]  // Keygen complete
                  ├─> GetHexEncodedPubKey(saveData.ECDSAPub)
                  ├─> saveLocalStateData(localState)
                  └─> Returns: pubKey
      │
      ├─> [Wait for pump to finish]
      │
      ├─> <a href="tss/nostrtransport/session.go#L259"><span style="color: #0066cc; font-weight: bold;">coordinator.PublishComplete</span></a>(ctx, "keygen")
      │   └─> <a href="tss/nostrtransport/client.go#L81"><span style="color: #0066cc; font-weight: bold;">client.Publish</span></a>(ctx, completeEvent)
      │
      ├─> [Extend localState with Nostr fields]
      │   └─> LocalStateNostr{LocalState, NostrNpub, ...}
      │
      └─> json.MarshalIndent(localStateNostr, "", "  ")
          └─> Returns: keyshare JSON
</pre>

---

## Transaction Flow

## Phase 1: Pre-Agreement

### 1.1 Session Flag Calculation

<pre>
<a href="tss/mpc_nostr.go#L569"><span style="color: #0066cc; font-weight: bold;">NostrMpcSendBTC</span></a>
  └─> <a href="tss/common.go#L217"><span style="color: #0066cc; font-weight: bold;">Sha256</span></a>(fmt.Sprintf("%s,%s,%d", npubsSorted, balanceSats, amountSatoshi))
      └─> Returns: sessionFlag
</pre>

### 1.2 Pre-Agreement Execution

<pre>
<a href="tss/mpc_nostr.go#L569"><span style="color: #0066cc; font-weight: bold;">NostrMpcSendBTC</span></a>
  └─> <a href="tss/mpc_nostr.go#L350"><span style="color: #0066cc; font-weight: bold;">runNostrPreAgreementSendBTC</span></a>(relaysCSV, partyNsec, partiesNpubsCSV, sessionFlag, estimatedFee)
      ├─> <a href="tss/mpc_nostr.go#L49"><span style="color: #0066cc; font-weight: bold;">DeriveNpubFromNsec</span></a>(partyNsec)
      │   └─> <a href="tss/mpc_nostr.go#L28"><span style="color: #0066cc; font-weight: bold;">decodeNsecFromBech32</span></a>(partyNsec)
      │       └─> nip19.Decode(nsec)
      │   └─> nostr.GetPublicKey(skHex)
      │   └─> nip19.EncodePublicKey(pkHex)
      │
      ├─> <a href="tss/common.go#L217"><span style="color: #0066cc; font-weight: bold;">Sha256</span></a>(sessionFlag)  // Generate session key
      │
      ├─> <a href="tss/common.go#L234"><span style="color: #0066cc; font-weight: bold;">SecureRandom</span></a>(64)  // Generate peerNonce
      │
      ├─> <a href="tss/nostrtransport/client.go#L35"><span style="color: #0066cc; font-weight: bold;">nostrtransport.NewClient</span></a>(cfg)
      │   └─> nostr.NewSimplePool(ctx)
      │   └─> pool.EnsureRelay(relayURL)  // For each relay
      │
      ├─> <a href="tss/nostrtransport/messenger.go#L18"><span style="color: #0066cc; font-weight: bold;">nostrtransport.NewMessenger</span></a>(cfg, client)
      │
      ├─> <a href="tss/nostrtransport/pump.go#L28"><span style="color: #0066cc; font-weight: bold;">nostrtransport.NewMessagePump</span></a>(cfg, client)
      │   └─> <a href="tss/nostrtransport/chunker.go#L93"><span style="color: #0066cc; font-weight: bold;">NewChunkAssembler</span></a>(cfg.ChunkTTL)
      │
      ├─> [GOROUTINE] <a href="tss/nostrtransport/pump.go#L38"><span style="color: #0066cc; font-weight: bold;">pump.Run</span></a>(ctx, handler)
      │   └─> <a href="tss/nostrtransport/client.go#L256"><span style="color: #0066cc; font-weight: bold;">client.Subscribe</span></a>(ctx, filter)
      │       └─> pool.SubscribeMany(ctx, urls, filter)
      │
      ├─> <a href="tss/nostrtransport/messenger.go#L29"><span style="color: #0066cc; font-weight: bold;">messenger.SendMessage</span></a>(ctx, localNpub, peerNpub, localMessage)
      │   └─> npubToHex(m.cfg.LocalNpub)
      │   └─> <a href="tss/nostrtransport/chunker.go#L52"><span style="color: #0066cc; font-weight: bold;">ChunkPayload</span></a>(sessionID, to, body, chunkSize)
      │   └─> [For each chunk]
      │       ├─> <a href="tss/nostrtransport/crypto.go#L114"><span style="color: #0066cc; font-weight: bold;">createRumor</span></a>(chunkJSON, senderNpubHex, to)
      │       ├─> <a href="tss/nostrtransport/crypto.go#L128"><span style="color: #0066cc; font-weight: bold;">createSeal</span></a>(rumor, localNsec, to)
      │       │   └─> nip44.Encrypt(rumorJSON, sharedSecret)
      │       ├─> <a href="tss/nostrtransport/crypto.go#L163"><span style="color: #0066cc; font-weight: bold;">createWrap</span></a>(seal, to, sessionID, chunkTag)
      │       │   └─> nip59.GiftWrap(seal, recipientNpub)
      │       └─> <a href="tss/nostrtransport/client.go#L337"><span style="color: #0066cc; font-weight: bold;">client.PublishWrap</span></a>(ctx, wrap)
      │           └─> pool.PublishMany(ctx, urls, *wrap)
      │
      └─> [Wait for peer message via pump]
          └─> <a href="tss/nostrtransport/pump.go#L38"><span style="color: #0066cc; font-weight: bold;">pump.Run</span></a> handler receives event
              ├─> <a href="tss/nostrtransport/crypto.go#L216"><span style="color: #0066cc; font-weight: bold;">unwrapGift</span></a>(event, localNsec)
              │   └─> nip59.UnwrapGift(event, nsec)
              ├─> <a href="tss/nostrtransport/crypto.go#L240"><span style="color: #0066cc; font-weight: bold;">unseal</span></a>(seal, localNsec, senderNpub)
              │   └─> nip44.Decrypt(sealContent, sharedSecret)
              ├─> <a href="tss/nostrtransport/chunker.go#L26"><span style="color: #0066cc; font-weight: bold;">ParseChunkTag</span></a>(chunkTag)
              └─> <a href="tss/nostrtransport/chunker.go#L104"><span style="color: #0066cc; font-weight: bold;">assembler.Add</span></a>(meta, chunkData)
                  └─> Returns: reassembled payload when complete
      │
      └─> Parse peer message: <peerNonce>:<fees>
      └─> Calculate fullNonce: sorted join of nonces
      └─> Calculate averageFees: (localFees + peerFees) / 2
      └─> Return: preAgreementResult{fullNonce, averageFees}
</pre>

### 1.3 Session ID and Key Calculation

<pre>
<a href="tss/mpc_nostr.go#L569"><span style="color: #0066cc; font-weight: bold;">NostrMpcSendBTC</span></a>
  ├─> <a href="tss/common.go#L217"><span style="color: #0066cc; font-weight: bold;">Sha256</span></a>(fmt.Sprintf("%s,%s,%d,%s", npubsSorted, balanceSats, amountSatoshi, fullNonce))
  │   └─> Returns: sessionID
  │
  └─> <a href="tss/common.go#L217"><span style="color: #0066cc; font-weight: bold;">Sha256</span></a>(fmt.Sprintf("%s,%s", npubsSorted, sessionID))
      └─> Returns: sessionKey
</pre>

---

## Phase 2: Transaction Construction

### 2.1 UTXO Selection

<pre>
<a href="tss/mpc_nostr.go#L569"><span style="color: #0066cc; font-weight: bold;">NostrMpcSendBTC</span></a>
  ├─> <a href="tss/btc.go#L82"><span style="color: #0066cc; font-weight: bold;">FetchUTXOs</span></a>(senderAddress)
  ├─> <a href="tss/btc.go#L219"><span style="color: #0066cc; font-weight: bold;">SelectUTXOs</span></a>(utxos, amountSatoshi+agreedFee, "smallest")
  │
  └─> [For each selected UTXO]
      └─> <a href="tss/btc.go#L120"><span style="color: #0066cc; font-weight: bold;">FetchUTXODetails</span></a>(utxo.TxID, utxo.Vout)
</pre>

### 2.2 Transaction Building

<pre>
<a href="tss/mpc_nostr.go#L569"><span style="color: #0066cc; font-weight: bold;">NostrMpcSendBTC</span></a>
  ├─> wire.NewMsgTx(wire.TxVersion)
  │
  ├─> [For each UTXO]
  │   ├─> chainhash.NewHashFromStr(utxo.TxID)
  │   ├─> wire.NewOutPoint(hash, utxo.Vout)
  │   └─> wire.NewTxIn(outPoint, nil, nil)
  │       └─> Set Sequence = 0xfffffffd (RBF enabled)
  │
  ├─> txscript.PayToAddrScript(toAddr)  // Recipient output
  ├─> tx.AddTxOut(wire.NewTxOut(amountSatoshi, pkScript))
  │
  └─> [If change needed]
      ├─> txscript.PayToAddrScript(fromAddr)  // Change output
      └─> tx.AddTxOut(wire.NewTxOut(changeAmount, changePkScript))
</pre>

---

## Phase 3: Signing Each Input (Keysign)

For each UTXO input, the following sequence occurs:

### 3.1 Sighash Calculation

<pre>
<a href="tss/mpc_nostr.go#L569"><span style="color: #0066cc; font-weight: bold;">NostrMpcSendBTC</span></a>
  └─> [For each input i]
      ├─> txscript.NewTxSigHashes(tx, prevOutFetcher)
      │
      ├─> [If SegWit (P2WPKH, P2SH-P2WPKH, etc.)]
      │   └─> txscript.CalcWitnessSigHash(pkScript, hashCache, SigHashAll, tx, i, value)
      │
      └─> [If Legacy (P2PKH, P2SH)]
          └─> txscript.CalcSignatureHash(pkScript, SigHashAll, tx, i)
      │
      └─> base64.StdEncoding.EncodeToString(sigHash)
          └─> Returns: sighashBase64
</pre>

### 3.2 Keysign via Nostr

<pre>
<a href="tss/mpc_nostr.go#L569"><span style="color: #0066cc; font-weight: bold;">NostrMpcSendBTC</span></a>
  └─> <a href="tss/mpc_nostr.go#L200"><span style="color: #0066cc; font-weight: bold;">NostrJoinKeysignWithSighash</span></a>(relaysCSV, partyNsec, partiesNpubsCSV, utxoSession, sessionKey, keyshareJSON, derivePath, sighashBase64)
      ├─> <a href="tss/mpc_nostr.go#L49"><span style="color: #0066cc; font-weight: bold;">DeriveNpubFromNsec</span></a>(partyNsec)
      ├─> json.Unmarshal(keyshareJSON, &keyshare)
      ├─> [Create config]
      │   └─> nostrtransport.Config{...}
      │
      └─> <a href="tss/mpc_nostr.go#L1498"><span style="color: #0066cc; font-weight: bold;">runNostrKeysignInternalWithSighash</span></a>(cfg, keyshare, derivePath, sighashBase64, allParties)
          ├─> <a href="tss/nostrtransport/client.go#L35"><span style="color: #0066cc; font-weight: bold;">nostrtransport.NewClient</span></a>(cfg)
          │   └─> nostr.NewSimplePool(ctx)
          │   └─> pool.EnsureRelay(relayURL)  // For each relay
          │
          ├─> nostrtransport.NewSessionCoordinator(cfg, client)
          │
          ├─> <a href="tss/nostrtransport/session.go#L235"><span style="color: #0066cc; font-weight: bold;">coordinator.PublishReady</span></a>(ctx)
          │   └─> <a href="tss/nostrtransport/client.go#L81"><span style="color: #0066cc; font-weight: bold;">client.Publish</span></a>(ctx, readyEvent)
          │       └─> event.Sign(nsecHex)
          │       └─> pool.PublishMany(ctx, urls, *event)
          │
          ├─> time.Sleep(500ms)  // Allow propagation
          │
          ├─> <a href="tss/nostrtransport/session.go#L31"><span style="color: #0066cc; font-weight: bold;">coordinator.AwaitPeers</span></a>(ctx)
          │   ├─> <a href="tss/nostrtransport/client.go#L256"><span style="color: #0066cc; font-weight: bold;">client.Subscribe</span></a>(ctx, filter)  // Subscribe to ready events (kind:30301)
          │   └─> [Wait for all peers' ready events]
          │
          ├─> <a href="tss/nostrtransport/messenger.go#L18"><span style="color: #0066cc; font-weight: bold;">nostrtransport.NewMessenger</span></a>(cfg, client)
          │
          ├─> &nostrMessengerAdapter{messenger, ctx}
          │
          ├─> &nostrKeysignStateAccessor{keyshare}
          │
          ├─> <a href="tss/tss.go#L116"><span style="color: #0066cc; font-weight: bold;">NewService</span></a>(messengerAdapter, stateAccessor, false, "-")
          │
          ├─> <a href="tss/nostrtransport/pump.go#L28"><span style="color: #0066cc; font-weight: bold;">nostrtransport.NewMessagePump</span></a>(cfg, client)
          │
          ├─> [GOROUTINE] <a href="tss/nostrtransport/pump.go#L38"><span style="color: #0066cc; font-weight: bold;">pump.Run</span></a>(pumpCtx, handler)
          │   └─> <a href="tss/nostrtransport/client.go#L256"><span style="color: #0066cc; font-weight: bold;">client.Subscribe</span></a>(ctx, filter)  // Subscribe to gift wraps (kind:1059)
          │       └─> pool.SubscribeMany(ctx, urls, filter)
          │
          ├─> <a href="tss/tss.go#L375"><span style="color: #0066cc; font-weight: bold;">tssService.KeysignECDSA</span></a>(&KeysignRequest{...})
          │   ├─> validateKeysignRequest(req)
          │   ├─> stateAccessor.GetLocalState(pubKey)
          │   │   └─> json.Marshal(keyshare.LocalState)
          │   │
          │   ├─> getParties(keysignCommitteeKeys, localPartyKey)
          │   │   └─> tss.NewPartyID(...)
          │   │   └─> tss.SortPartyIDs(...)
          │   │
          │   ├─> <a href="tss/common.go#L178"><span style="color: #0066cc; font-weight: bold;">GetDerivePathBytes</span></a>(derivePath)
          │   ├─> <a href="tss/common.go#L157"><span style="color: #0066cc; font-weight: bold;">derivingPubkeyFromPath</span></a>(...)
          │   ├─> signing.UpdatePublicKeyAndAdjustBigXj(...)
          │   │
          │   ├─> signing.NewLocalPartyWithKDD(...)
          │   │
          │   └─> [GOROUTINE] localParty.Start()
          │
          └─> <a href="tss/tss.go#L470"><span style="color: #0066cc; font-weight: bold;">processKeySign</span></a>(localParty, errCh, outCh, endCh, sortedPartyIds)
              └─> [Event loop]
                  ├─> [Case: outCh]  // Outgoing TSS message
                  │   ├─> msg.WireBytes()
                  │   ├─> json.MarshalIndent(MessageFromTss{...})
                  │   ├─> base64.StdEncoding.EncodeToString(jsonBytes)
                  │   └─> messengerAdapter.Send(from, to, payload)
                  │       └─> <a href="tss/nostrtransport/messenger.go#L29"><span style="color: #0066cc; font-weight: bold;">messenger.SendMessage</span></a>(ctx, from, to, body)
                  │           └─> [Same chunking/encryption flow as pre-agreement]
                  │
                  ├─> [Case: inboundMessageCh]  // Incoming TSS message
                  │   └─> <a href="tss/tss.go#L235"><span style="color: #0066cc; font-weight: bold;">applyMessageToTssInstance</span></a>(localParty, msg, sortedPartyIds)
                  │       ├─> base64.StdEncoding.DecodeString(msg)
                  │       ├─> json.Unmarshal(originalBytes, &msgFromTss)
                  │       └─> localParty.UpdateFromBytes(msgFromTss.WireBytes, fromParty, isBroadcast)
                  │
                  └─> [Case: endCh]  // Signature complete
                      └─> Returns: *common.SignatureData
          │
          ├─> [Wait for pump to finish]
          │
          ├─> <a href="tss/nostrtransport/session.go#L259"><span style="color: #0066cc; font-weight: bold;">coordinator.PublishComplete</span></a>(ctx, "keysign")
          │   └─> <a href="tss/nostrtransport/client.go#L81"><span style="color: #0066cc; font-weight: bold;">client.Publish</span></a>(ctx, completeEvent)
          │
          └─> json.MarshalIndent(keysignResp, "", "  ")
              └─> Returns: sigJSON
</pre>

### 3.3 Signature Application

<pre>
<a href="tss/mpc_nostr.go#L569"><span style="color: #0066cc; font-weight: bold;">NostrMpcSendBTC</span></a>
  └─> [For each input i]
      ├─> json.Unmarshal(sigJSON, &sig)
      ├─> hex.DecodeString(sig.DerSignature)
      │
      ├─> [If SegWit]
      │   ├─> append(signature, byte(SigHashAll))
      │   └─> tx.TxIn[i].Witness = wire.TxWitness{signatureWithHashType, pubKeyBytes}
      │
      └─> [If Legacy]
          ├─> append(signature, byte(SigHashAll))
          ├─> txscript.NewScriptBuilder()
          │   ├─> builder.AddData(signatureWithHashType)
          │   └─> builder.AddData(pubKeyBytes)
          └─> tx.TxIn[i].SignatureScript = scriptSig
      │
      └─> [Script validation]
          └─> txscript.NewEngine(pkScript, tx, i, flags, nil, hashCache, value, prevOutFetcher)
              └─> vm.Execute()
</pre>

---

## Phase 4: Transaction Broadcast

<pre>
<a href="tss/mpc_nostr.go#L569"><span style="color: #0066cc; font-weight: bold;">NostrMpcSendBTC</span></a>
  ├─> tx.Serialize(&signedTx)
  ├─> hex.EncodeToString(signedTx.Bytes())
  │
  └─> <a href="tss/btc.go#L181"><span style="color: #0066cc; font-weight: bold;">PostTx</span></a>(rawTx)
      └─> [Broadcast to Bitcoin network]
      └─> Returns: txid
</pre>

---

## Message Flow Details

### Outgoing Message (TSS → Nostr)

<pre>
TSS Library generates message
  └─> <a href="tss/tss.go#L470"><span style="color: #0066cc; font-weight: bold;">processKeySign</span></a> (outCh case)
      └─> msg.WireBytes()  // Get TSS wire format
      └─> json.MarshalIndent(MessageFromTss{...})
      └─> base64.EncodeToString(jsonBytes)
      └─> messengerAdapter.Send(from, to, payload)
          └─> <a href="tss/nostrtransport/messenger.go#L29"><span style="color: #0066cc; font-weight: bold;">messenger.SendMessage</span></a>(ctx, from, to, body)
              ├─> <a href="tss/nostrtransport/chunker.go#L52"><span style="color: #0066cc; font-weight: bold;">ChunkPayload</span></a>(sessionID, to, body, chunkSize)
              │   └─> Returns: []Chunk
              │
              └─> [For each chunk]
                  ├─> <a href="tss/nostrtransport/crypto.go#L114"><span style="color: #0066cc; font-weight: bold;">createRumor</span></a>(chunkJSON, senderNpubHex, to)
                  │   └─> Returns: rumor event (kind:14, unsigned)
                  │
                  ├─> <a href="tss/nostrtransport/crypto.go#L128"><span style="color: #0066cc; font-weight: bold;">createSeal</span></a>(rumor, localNsec, to)
                  │   ├─> json.Marshal(rumor)
                  │   ├─> nip44.Encrypt(rumorJSON, sharedSecret)
                  │   └─> Returns: seal event (kind:13, encrypted)
                  │
                  ├─> <a href="tss/nostrtransport/crypto.go#L163"><span style="color: #0066cc; font-weight: bold;">createWrap</span></a>(seal, to, sessionID, chunkTag)
                  │   ├─> json.Marshal(seal)
                  │   ├─> nip59.GiftWrap(seal, recipientNpub)
                  │   └─> Returns: wrap event (kind:1059, gift wrapped)
                  │
                  └─> <a href="tss/nostrtransport/client.go#L337"><span style="color: #0066cc; font-weight: bold;">client.PublishWrap</span></a>(ctx, wrap)
                      └─> pool.PublishMany(ctx, urls, *wrap)
                          └─> [Publishes to all relays in parallel]
</pre>

### Incoming Message (Nostr → TSS)

<pre>
Nostr relay event received
  └─> <a href="tss/nostrtransport/pump.go#L38"><span style="color: #0066cc; font-weight: bold;">pump.Run</span></a> handler
      ├─> <a href="tss/nostrtransport/client.go#L256"><span style="color: #0066cc; font-weight: bold;">client.Subscribe</span></a>(ctx, filter)
      │   └─> pool.SubscribeMany(ctx, urls, filter)
      │       └─> [Filters: kind=1059, tags include sessionID and recipient]
      │
      └─> [Event received]
          ├─> <a href="tss/nostrtransport/crypto.go#L216"><span style="color: #0066cc; font-weight: bold;">unwrapGift</span></a>(event, localNsec)
          │   └─> nip59.UnwrapGift(event, nsec)
          │       └─> Returns: seal event
          │
          ├─> <a href="tss/nostrtransport/crypto.go#L240"><span style="color: #0066cc; font-weight: bold;">unseal</span></a>(seal, localNsec, senderNpub)
          │   └─> nip44.Decrypt(sealContent, sharedSecret)
          │       └─> Returns: rumor event
          │
          ├─> json.Unmarshal(rumor.Content, &chunkMessage)
          ├─> <a href="tss/nostrtransport/chunker.go#L26"><span style="color: #0066cc; font-weight: bold;">ParseChunkTag</span></a>(chunkTag)
          ├─> base64.DecodeString(chunkDataB64)
          │
          ├─> <a href="tss/nostrtransport/chunker.go#L104"><span style="color: #0066cc; font-weight: bold;">assembler.Add</span></a>(meta, chunkData)
          │   └─> [When all chunks received]
          │       └─> Returns: reassembled payload
          │
          └─> handler(reassembled)  // Callback
              └─> tssService.ApplyData(string(payload))
                  └─> inboundMessageCh <- msg
                      └─> <a href="tss/tss.go#L470"><span style="color: #0066cc; font-weight: bold;">processKeySign</span></a> (inboundMessageCh case)
                          └─> <a href="tss/tss.go#L235"><span style="color: #0066cc; font-weight: bold;">applyMessageToTssInstance</span></a>(...)
                              └─> localParty.UpdateFromBytes(...)
</pre>

---

## Key Components

### 1. **Nostr Client** (`nostrtransport.Client`)
- Manages connection pool to Nostr relays
- Handles event publishing and subscription
- Converts between Bech32 (npub/nsec) and hex formats

### 2. **Messenger** (`nostrtransport.Messenger`)
- Encrypts messages using NIP-44
- Chunks large messages
- Wraps messages in NIP-59 gift wraps
- Publishes to relays

### 3. **Message Pump** (`nostrtransport.MessagePump`)
- Subscribes to gift wrap events
- Unwraps and decrypts messages
- Reassembles chunked messages
- Feeds messages to TSS service

### 4. **Session Coordinator** (`nostrtransport.SessionCoordinator`)
- Publishes "ready" events (kind:30301)
- Waits for all peers to be ready
- Publishes "complete" events (kind:30302)

### 5. **TSS Service** (`tss.ServiceImpl`)
- Manages TSS protocol state
- Processes incoming/outgoing TSS messages
- Coordinates keygen/keysign operations

---

## Event Kinds Used

- **Kind 14**: Rumor (unsigned event containing chunk metadata)
- **Kind 13**: Seal (NIP-44 encrypted rumor)
- **Kind 1059**: Gift Wrap (NIP-59 wrapped seal for recipient)
- **Kind 30301**: Ready (session coordination - party is ready)
- **Kind 30302**: Complete (session coordination - party completed)

---

## Session Flow Summary

1. **Pre-Agreement**: Exchange nonces and fees, agree on session parameters
2. **Session Setup**: Calculate sessionID and sessionKey from agreed parameters
3. **Transaction Build**: Select UTXOs, build transaction structure
4. **Per-Input Signing**: For each UTXO input:
   - Calculate sighash
   - Run keysign via Nostr (with ready/await coordination)
   - Apply signature to transaction
5. **Broadcast**: Serialize and broadcast signed transaction

Each keysign operation follows the same pattern:
- Publish ready → Await peers → Exchange TSS messages → Complete
