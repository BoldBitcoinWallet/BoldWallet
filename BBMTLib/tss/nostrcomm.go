package tss

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip04"
	"github.com/patrickmn/go-cache"
)

// Global variables
var (
	nostrSessionList          []NostrSession
	nostrHandShakeList        []ProtoMessage
	nostrMessageCache         = cache.New(5*time.Minute, 10*time.Minute)
	relay                     *nostr.Relay
	globalCtx                 context.Context
	nostrRelayURL             string
	KeysignApprovalTimeout    = 4 * time.Second
	KeysignApprovalMaxRetries = 14
	totalSentMessages         []ProtoMessage
	nostrMutex                sync.Mutex
	sessionMutex              sync.Mutex
	nostrSendMutex            sync.Mutex
	nostrDownloadMutex        sync.Mutex
)

type NostrPartyPubKeys struct {
	Peer   string `json:"peer"`
	PubKey string `json:"pubkey"`
}

type ProtoMessage struct {
	FunctionType    string              `json:"function_type"`
	MessageType     string              `json:"message_type"`
	Participants    []string            `json:"participants"`
	Recipients      []NostrPartyPubKeys `json:"recipients"`
	FromNostrPubKey string              `json:"from_nostr_pubkey"`
	SessionID       string              `json:"sessionID"`
	RawMessage      []byte              `json:"raw_message"`
	SeqNo           string              `json:"seq_no"`
	From            string              `json:"from"`
	To              string              `json:"to"`
	TxRequest       TxRequest           `json:"tx_request"`
	Master          Master              `json:"master"`
	SessionKey      string              `json:"session_key"`
}

type NostrSession struct {
	Status       string    `json:"status"`
	SessionID    string    `json:"session_id"`
	SessionKey   string    `json:"session_key"`
	Participants []string  `json:"participants"`
	Master       Master    `json:"master"`
	TxRequest    TxRequest `json:"tx_request"`
}

type Master struct {
	MasterPeer   string `json:"master_peer"`
	MasterPubKey string `json:"master_pubkey"`
}

type NostrStatus struct {
	SessionID string `json:"session_id,omitempty"`
	Status    string `json:"status,omitempty"`
}

type NostrEvent struct {
	ID        string     `json:"id"`
	PubKey    string     `json:"pubkey"` //sender pubkey
	CreatedAt int64      `json:"created_at"`
	Kind      int        `json:"kind"`
	Tags      [][]string `json:"tags"`    //recipients
	Content   string     `json:"content"` //raw message
	Sig       string     `json:"sig"`
}

type TxRequest struct {
	SenderAddress   string `json:"sender_address"`
	ReceiverAddress string `json:"receiver_address"`
	AmountSatoshi   int64  `json:"amount_satoshi"`
	FeeSatoshi      int64  `json:"fee_satoshi"`
	DerivePath      string `json:"derive_path"`
	BtcPub          string `json:"btc_pub"`
}

func GetKeyShare(party string) (LocalState, error) {

	data, err := os.ReadFile(party + ".ks")
	if err != nil {
		fmt.Printf("Go Error GetKeyShare: %v\n", err)
	}

	// Decode base64
	decodedData, err := base64.StdEncoding.DecodeString(string(data))
	if err != nil {
		fmt.Printf("Go Error Decoding Base64: %v\n", err)
	}

	// Parse JSON into LocalState
	var keyShare LocalState
	if err := json.Unmarshal(decodedData, &keyShare); err != nil {
		fmt.Printf("Go Error Unmarshalling LocalState: %v\n", err)
	}

	return keyShare, nil
}

func GetNostrPartyPubKeys(party string) (map[string]string, error) {
	keyShare, err := GetKeyShare(party)
	if err != nil {
		return nil, err
	}
	return keyShare.NostrPartyPubKeys, nil
}

func NostrListen(localParty, nostrRelay string) {
	nostrRelayURL = nostrRelay

	if globalCtx == nil {
		globalCtx, _ = context.WithCancel(context.Background())
	}

	keyShare, err := GetKeyShare(localParty)
	if err != nil {
		log.Printf("Error getting key share: %v\n", err)
		return
	}

	if !nostr.IsValidPublicKey(keyShare.LocalNostrPubKey) || validateKeys(keyShare.LocalNostrPrivKey, keyShare.LocalNostrPubKey) != nil {
		log.Printf("Invalid key format or validation failed\n")
		return
	}

	retryInterval := 3 * time.Second

	for {
		ctx, cancel := context.WithCancel(globalCtx)

		// Connect to relay
		relay, err = nostr.RelayConnect(ctx, nostrRelay)
		if err != nil {
			log.Printf("Connection failed: %v, retrying in %v...\n", err, retryInterval)
			cancel()
			time.Sleep(retryInterval)
			continue
		}

		// Subscribe to events
		since := nostr.Timestamp(time.Now().Add(-10 * time.Second).Unix())
		filters := nostr.Filters{{
			Kinds: []int{nostr.KindEncryptedDirectMessage},
			Tags:  nostr.TagMap{"p": []string{keyShare.LocalNostrPubKey}},
			Since: &since,
		}}

		sub, err := relay.Subscribe(ctx, filters)
		if err != nil {
			log.Printf("Subscription failed: %v, retrying in %v...\n", err, retryInterval)
			cancel()
			time.Sleep(retryInterval)
			continue
		}

		log.Printf("%s subscribed to nostr\n", localParty)

		for {
			select {
			case event := <-sub.Events:
				if event == nil {
					log.Printf("Connection lost, reconnecting...\n")
					cancel()
					break
				}

				if err := processNostrEvent(event, keyShare, localParty); err != nil {
					log.Printf("Error processing event: %v\n", err)
				}

			case <-ctx.Done():
				log.Printf("Context cancelled, reconnecting...\n")
				cancel()
				break

			case <-sub.EndOfStoredEvents:
				continue
			}
		}

	}
}

func processNostrEvent(event *nostr.Event, keyShare LocalState, localParty string) error {
	// Decrypt message
	sharedSecret, err := nip04.ComputeSharedSecret(event.PubKey, keyShare.LocalNostrPrivKey)
	if err != nil {
		return fmt.Errorf("compute shared secret: %w", err)
	}

	decryptedMessage, err := nip04.Decrypt(event.Content, sharedSecret)
	if err != nil {
		return fmt.Errorf("decrypt message: %w", err)
	}

	var protoMessage ProtoMessage
	if err := json.Unmarshal([]byte(decryptedMessage), &protoMessage); err != nil {
		return fmt.Errorf("parse message: %w", err)
	}

	if protoMessage.From == localParty {
		return nil // Ignore messages from self
	}

	switch protoMessage.FunctionType {
	case "init_handshake":
		go AckNostrHandshake(protoMessage.SessionID, localParty, protoMessage)

	case "ack_handshake":
		if protoMessage.Master.MasterPeer == localParty {
			collectAckHandshake(localParty, protoMessage.SessionID, protoMessage)
		}

	case "start_keysign":
		Logf("start_keysign received from %s to %s for SessionID:%v", protoMessage.From, localParty, protoMessage.SessionID)
		go startPartyNostrMPCsendBTC(protoMessage.SessionID, protoMessage.Participants, localParty)

	case "keysign":
		Logf("keysign received from %s to %s for SessionID:%v", protoMessage.From, localParty, protoMessage.SessionID)
		key := protoMessage.MessageType + "-" + protoMessage.SessionID
		nostrMutex.Lock()
		nostrSetData(key, &protoMessage)
		nostrMutex.Unlock()
	}

	return nil
}

func initiateNostrHandshake(SessionID, localParty string, sessionKey string, txRequest TxRequest) (bool, error) {

	keyShare, err := GetKeyShare(localParty)
	if err != nil {
		log.Printf("Error getting key share: %v\n", err)
		return false, err
	}

	protoMessage := ProtoMessage{
		SessionID:       SessionID,
		SessionKey:      sessionKey,
		FunctionType:    "init_handshake",
		From:            localParty,
		FromNostrPubKey: keyShare.LocalNostrPubKey,
		Recipients:      make([]NostrPartyPubKeys, 0, len(keyShare.NostrPartyPubKeys)),
		TxRequest:       txRequest,
		Master:          Master{MasterPeer: keyShare.LocalPartyKey, MasterPubKey: keyShare.LocalNostrPubKey},
	}

	// map nostrpartypubkeys
	for party, pubKey := range keyShare.NostrPartyPubKeys {
		if party != localParty {
			protoMessage.Recipients = append(protoMessage.Recipients, NostrPartyPubKeys{
				Peer:   party,
				PubKey: pubKey,
			})
		}
	}

	nostrSession := NostrSession{
		SessionID:    SessionID,
		Participants: []string{localParty},
		TxRequest:    protoMessage.TxRequest,
		Master:       protoMessage.Master,
		Status:       "pending",
		SessionKey:   sessionKey,
	}

	if !nostrSessionAlreadyExists(nostrSessionList, nostrSession) {
		nostrSessionList = append(nostrSessionList, nostrSession)
	}

	//==============================SEND (INIT_HANDSHAKE) TO ALL PARTIES========================
	Logf("Sending (init_handshake) message for SessionID: %s", SessionID)
	nostrSend(localParty, protoMessage)
	//==============================COLLECT ACK_HANDSHAKES==============================

	partyCount := len(keyShare.NostrPartyPubKeys)
	retryCount := 0
	maxRetries := KeysignApprovalMaxRetries
	sessionReady := false
	for retryCount <= maxRetries {
		for _, item := range nostrSessionList {
			if item.SessionID == SessionID {

				participantCount := len(item.Participants)
				if participantCount == partyCount {
					Logf("All participants have approved, sending (start_keysign) for session: %s", SessionID)
					if item.Status == "pending" {
						sessionReady = true
						startKeysignMaster(SessionID, item.Participants, localParty)
					} else {
						return false, fmt.Errorf("session not ready")
					}
					return sessionReady, nil
				} else {
					if retryCount >= maxRetries {
						participationRatio := float64(participantCount) / float64(partyCount)
						if participationRatio >= 0.66 {
							Logf("We have 2/3 of participants approved, sending (start_keysign) for session: %s", SessionID)
							sessionReady = true
							startKeysignMaster(SessionID, item.Participants, localParty)
						} else {
							Logf("Max retries reached, giving up on session: %s", SessionID)
							return false, fmt.Errorf("max retries reached")
						}
					} else {
						Logf("Waiting before retrying")
						time.Sleep(KeysignApprovalTimeout)
					}
				}
			}
		}
		if sessionReady {
			break
		}
		retryCount++
	}
	return sessionReady, nil
}

func collectAckHandshake(localParty, sessionID string, protoMessage ProtoMessage) {

	keyShare, err := GetKeyShare(localParty)
	if err != nil {
		log.Printf("Error getting key share: %v\n", err)
		return
	}

	for i, item := range nostrSessionList {
		if item.SessionID == sessionID && item.TxRequest == protoMessage.TxRequest {
			if !contains(item.Participants, protoMessage.From) {
				item.Participants = append(item.Participants, protoMessage.From)
				nostrSessionList[i] = item
				Logf("%s has approved session: %s", protoMessage.From, sessionID)
				Logf("%v out of %v participants have approved", int(len(item.Participants)), int(len(keyShare.NostrPartyPubKeys)))
			}
		}
	}
}

func AckNostrHandshake(session, localParty string, protoMessage ProtoMessage) {
	// send handshake to master

	keyShare, err := GetKeyShare(localParty)
	if err != nil {
		log.Printf("Error getting key share: %v\n", err)
		return
	}

	Logf("(init_handshake) message received from %s\n", protoMessage.From)
	Logf("sending (ack_handshake) message to %s\n", protoMessage.From)
	//============== UI - ask user to approve TX==================
	//TODO
	//if approved, send ack, and set status="pending"
	//If not approved, then status="rejected"
	//===================USER APPROVED TX======================
	nostrSession := NostrSession{
		SessionID:    session,
		Participants: []string{localParty},
		TxRequest:    protoMessage.TxRequest,
		Master:       protoMessage.Master,
		Status:       "pending",
		SessionKey:   protoMessage.SessionKey,
	}
	if !contains(nostrSession.Participants, protoMessage.From) {
		nostrSession.Participants = append(nostrSession.Participants, protoMessage.From)
		Logf("Collected ack handshake from %s for session: %s", protoMessage.From, session)
	}

	if !nostrSessionAlreadyExists(nostrSessionList, nostrSession) {
		nostrSessionList = append(nostrSessionList, nostrSession)
	}

	ackProtoMessage := ProtoMessage{
		SessionID:       session,
		FunctionType:    "ack_handshake",
		From:            localParty,
		FromNostrPubKey: keyShare.LocalNostrPubKey,
		Recipients:      []NostrPartyPubKeys{{Peer: protoMessage.Master.MasterPeer, PubKey: protoMessage.Master.MasterPubKey}},
		Participants:    []string{localParty},
		TxRequest:       protoMessage.TxRequest,
		Master:          Master{MasterPeer: protoMessage.Master.MasterPeer, MasterPubKey: protoMessage.Master.MasterPubKey},
	}

	nostrSend(localParty, ackProtoMessage)

}

func startKeysignMaster(sessionID string, participants []string, localParty string) {

	keyShare, err := GetKeyShare(localParty)
	if err != nil {
		log.Printf("Error getting key share: %v\n", err)
		return
	}

	for i, item := range nostrSessionList {
		if item.SessionID == sessionID && item.Status == "pending" {
			nostrSessionList[i].Status = "start_keysign"

			recipients := make([]NostrPartyPubKeys, 0, len(participants))
			for _, participant := range participants {
				if participant != item.Master.MasterPeer { // Skip if participant is the master
					if pubKey, ok := keyShare.NostrPartyPubKeys[participant]; ok {
						recipients = append(recipients, NostrPartyPubKeys{
							Peer:   participant,
							PubKey: pubKey,
						})
					}
				}
			}

			startKeysignProtoMessage := ProtoMessage{
				SessionID:    sessionID,
				SessionKey:   item.SessionKey,
				FunctionType: "start_keysign",
				From:         localParty,
				Recipients:   recipients,
				Participants: participants,
				TxRequest:    item.TxRequest,
				Master:       Master{MasterPeer: item.Master.MasterPeer, MasterPubKey: item.Master.MasterPubKey},
			}

			nostrSend(localParty, startKeysignProtoMessage)
		}
	}
}

func startPartyNostrMPCsendBTC(sessionID string, participants []string, localParty string) {

	for i, item := range nostrSessionList {
		if item.SessionID == sessionID {

			nostrSessionList[i].Status = "start_keysign"
			nostrSessionList[i].Participants = participants
			sessionKey := nostrSessionList[i].SessionKey

			keyshare, err := GetKeyShare(localParty)
			if err != nil {
				Logf("Error getting key share: %v", err)
				return
			}

			// Marshal the keyshare to JSON
			keyshareJSON, err := json.Marshal(keyshare)
			if err != nil {
				Logf("Error marshaling keyshare: %v", err)
				return
			}
			//sessionID = sessionID[:len(sessionID)-1]

			peers := strings.Join(item.Participants, ",")

			result, err := MpcSendBTC("", localParty, peers, sessionID, sessionKey, "", "", string(keyshareJSON), item.TxRequest.DerivePath, item.TxRequest.BtcPub, item.TxRequest.SenderAddress, item.TxRequest.ReceiverAddress, int64(item.TxRequest.AmountSatoshi), int64(item.TxRequest.FeeSatoshi), "nostr", "false")
			if err != nil {
				fmt.Printf("Go Error: %v\n", err)
			} else {
				fmt.Printf("\n [%s] Keysign Result %s\n", localParty, result)
			}
		}
	}
}

func nostrFlagPartyKeysignComplete(sessionID string) error {
	for i := len(nostrSessionList) - 1; i >= 0; i-- {
		if nostrSessionList[i].SessionID == sessionID {
			nostrSessionList[i].Status = "keysign_complete"
		}
	}
	Logf("Nostr Keysign Complete: %s", sessionID)
	return nil
}

func nostrDeleteSession(sessionID string) {
	for i := len(nostrSessionList) - 1; i >= 0; i-- {
		if nostrSessionList[i].SessionID == sessionID {
			nostrSessionList = append(nostrSessionList[:i], nostrSessionList[i+1:]...)
		}
	}
	Logf("Nostr Session Deleted: %s", sessionID)
}

func nostrSessionAlreadyExists(list []NostrSession, nostrSession NostrSession) bool {

	for _, element := range list {
		if element.SessionID == nostrSession.SessionID {
			return true
		}
	}
	return false
}

func validateKeys(privateKey, publicKey string) error {
	if len(privateKey) != 64 || !nostr.IsValidPublicKey(publicKey) {
		return fmt.Errorf("invalid key format")
	}
	derivedPubKey, err := nostr.GetPublicKey(privateKey)
	if err != nil {
		return fmt.Errorf("error deriving public key: %v", err)
	}
	if derivedPubKey != publicKey {
		return fmt.Errorf("private key does not match public key")
	}
	return nil
}

func nostrSend(from string, protoMessage ProtoMessage) error {

	if globalCtx == nil {
		globalCtx = context.Background()
	}

	keyShare, err := GetKeyShare(from)
	if err != nil {
		log.Printf("Error getting key share: %v\n", err)
		return err
	}

	protoMessageJSON, err := json.Marshal(protoMessage)
	if err != nil {
		log.Printf("Error marshalling protoMessage: %v\n", err)
		return err
	}

	for _, recipient := range protoMessage.Recipients {
		sharedSecret, err := nip04.ComputeSharedSecret(recipient.PubKey, keyShare.LocalNostrPrivKey)
		if err != nil {
			log.Printf("Error computing shared secret: %v\n", err)
			return err
		}

		encryptedContent, err := nip04.Encrypt(string(protoMessageJSON), sharedSecret)
		if err != nil {
			log.Printf("Error encrypting message: %v\n", err)
			return err
		}

		event := nostr.Event{
			PubKey:    keyShare.LocalNostrPubKey,
			CreatedAt: nostr.Now(),
			Kind:      nostr.KindEncryptedDirectMessage,
			Tags:      nostr.Tags{{"p", recipient.PubKey}},
			Content:   encryptedContent,
		}

		event.Sign(keyShare.LocalNostrPrivKey)

		ctx, cancel := context.WithTimeout(globalCtx, 600*time.Second)
		defer cancel()

		err = relay.Publish(ctx, event)

		if err != nil {
			log.Printf("Error publishing event: %v\n", err)
			return err
		}
	}
	return nil
}

func nostrGetData(key string) (interface{}, bool) {
	return nostrMessageCache.Get(key)
}

func nostrSetData(key string, newMsg *ProtoMessage) {
	value, found := nostrGetData(key)
	var msgs []*ProtoMessage
	if found {
		msgs = value.([]*ProtoMessage)

	}

	msgs = append(msgs, newMsg)
	nostrMessageCache.Set(key, msgs, cache.DefaultExpiration)
}

func nostrClearSessionCache(sessionID string) {
	nostrMutex.Lock()
	defer nostrMutex.Unlock()

	// Clear messages for this session
	nostrMessageCache.Delete("message-" + sessionID)
	Logf("Cleared nostr message cache for session: %s", sessionID)
}

func nostrDownloadMessage(session, sessionKey, key string, tssServerImp ServiceImpl, endCh chan struct{}, wg *sync.WaitGroup) {
	defer wg.Done()
	isApplyingMessages := false
	msgMap := make(map[string]bool)

	// Create a mutex for protecting nostr message operations
	var nostrMsgMutex sync.Mutex

	for {
		select {
		case <-endCh:
			return
		default:
			if isApplyingMessages {
				continue
			}

			isApplyingMessages = true

			var err error

			var messages []struct {
				SessionID string   `json:"session_id,omitempty"`
				From      string   `json:"from,omitempty"`
				To        []string `json:"to,omitempty"`
				Body      string   `json:"body,omitempty"`
				SeqNo     string   `json:"sequence_no,omitempty"`
				Hash      string   `json:"hash,omitempty"`
			}

			nostrMsgMutex.Lock()
			msgs, found := nostrGetData("message-" + session)
			nostrMsgMutex.Unlock()

			if !found {
				isApplyingMessages = false
				continue
			}

			protoMessages, ok := msgs.([]*ProtoMessage)
			if !ok {
				Logln("BBMTLog", "Invalid message type for session:", session)
				isApplyingMessages = false
				continue
			}

			messages = make([]struct {
				SessionID string   `json:"session_id,omitempty"`
				From      string   `json:"from,omitempty"`
				To        []string `json:"to,omitempty"`
				Body      string   `json:"body,omitempty"`
				SeqNo     string   `json:"sequence_no,omitempty"`
				Hash      string   `json:"hash,omitempty"`
			}, 0, len(protoMessages))

			for _, protoMsg := range protoMessages {
				var message struct {
					SessionID string   `json:"session_id,omitempty"`
					From      string   `json:"from,omitempty"`
					To        []string `json:"to,omitempty"`
					Body      string   `json:"body,omitempty"`
					SeqNo     string   `json:"sequence_no,omitempty"`
					Hash      string   `json:"hash,omitempty"`
				}

				if err := json.Unmarshal(protoMsg.RawMessage, &message); err != nil {
					Logln("BBMTLog", "Failed to parse RawMessage:", err)
					continue
				}

				messages = append(messages, message)
			}

			// Sort messages by sequence number
			sort.SliceStable(messages, func(i, j int) bool {
				seqNoI, errI := strconv.Atoi(messages[i].SeqNo)
				seqNoJ, errJ := strconv.Atoi(messages[j].SeqNo)

				if errI != nil || errJ != nil {
					Logln("BBMTLog", "Error converting SeqNo to int:", errI, errJ)
					return false
				}
				return seqNoI < seqNoJ
			})

			// Process messages sequentially
			for _, message := range messages {
				if message.From == key { //Skip messages from self
					continue
				}

				_, exists := msgMap[message.Hash]
				if exists {
					continue
				} else {
					msgMap[message.Hash] = true
				}

				status := getStatus(session)

				// Only process messages that match the expected seqNo

				status.Step++
				status.Index++
				status.Info = fmt.Sprintf("Received Message %s", message.SeqNo)
				setIndex(session, status.Info, status.Step, status.Index)

				// Decrypt message if necessary
				body := message.Body
				if len(sessionKey) > 0 {
					body, err = AesDecrypt(message.Body, sessionKey)
					if err != nil {
						Logln("BBMTLog", "Failed to decrypt message:", err)
						continue
					}
				} else if len(decryptionKey) > 0 {
					body, err = EciesDecrypt(message.Body, decryptionKey)
					if err != nil {
						Logln("BBMTLog", "Failed to decrypt ECIES message:", err)
						continue
					}
				}

				Logln("BBMTLog", "Applying message body:", body[:min(50, len(body))])
				if err := tssServerImp.ApplyData(body); err != nil {
					Logln("BBMTLog", "Failed to apply message data:", err)
				}

				// Mark message as applied
				Logln("BBMTLog", "Message applied:", message.SeqNo)
				status.Step++
				status.Info = fmt.Sprintf("Applied Message %d", status.Index)
				setStep(session, status.Info, status.Step)

			}
			isApplyingMessages = false
		}
	}
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
