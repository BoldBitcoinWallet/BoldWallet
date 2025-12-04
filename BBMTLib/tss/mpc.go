package tss

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Status struct {
	Step  int
	SeqNo int
	Index int
	Info  string
	Type  string
	Done  bool
	Time  int
}

type MessengerImp struct {
	Server     string
	SessionID  string
	SessionKey string
	Mutex      sync.Mutex
}

type LocalStateAccessorImp struct {
	key string
}

var (
	statusMap        = make(map[string]Status)
	statusLog        = make(map[string][]Status)
	encryptionKey    = ""
	decryptionKey    = ""
	localStateMemory = ""
	keyGenTimeout    = 120
	keySignTimeout   = 60
	msgFetchTimeout  = 70
)

func SessionState(session string) string {
	status, exists := statusMap[session]
	if !exists {
		return "{}" // Return an empty state if session doesn't exist
	}
	step := status.Step
	seqNo := status.SeqNo
	index := status.Index
	info := status.Info
	time := status.Time
	done := status.Done

	return fmt.Sprintf(
		`{ "time": %d, "step": %d, "type": "%s", "info": "%s", "sentNo": %d, "receivedNo": %d, "done": %t }`,
		time, step, status.Type, info, seqNo, index, done,
	)
}

func ClearSessionLog(session string) {
	delete(statusMap, session)
	delete(statusLog, session)
}

func SessionLog(session string) string {

	statuses, exists := statusLog[session]
	if !exists {
		return "[]"
	}

	var result []string
	for _, status := range statuses {
		done := 0
		if status.Done {
			done = 1
		}
		result = append(result, fmt.Sprintf(
			`{"step": %d, "type": "%s", "info": "%s", "sentNo": %d, "receivedNo": %d, "done": %d, "time": %d}`,
			status.Step, status.Type, status.Info, status.SeqNo, status.Index, done, status.Time,
		))
	}

	return fmt.Sprintf("[%s]", stringJoin(result, ","))
}

func stringJoin(parts []string, delimiter string) string {
	result := ""
	for i, part := range parts {
		if i > 0 {
			result += delimiter
		}
		result += part
	}
	return result
}

func getStatus(session string) Status {
	return statusMap[session]
}

func setSeqNo(session, info string, step, seqNo int) {
	status := statusMap[session]
	status.Time = int(time.Now().Unix())
	status.Step = step
	status.SeqNo = seqNo
	status.Info = info
	statusMap[session] = status
	if _, exists := statusLog[session]; !exists {
		statusLog[session] = []Status{}
	}
	statusLog[session] = append(statusLog[session], status)
}

func setIndex(session, info string, step, index int) {
	status := statusMap[session]
	status.Time = int(time.Now().Unix())
	status.Step = step
	status.Index = index
	status.Info = info
	statusMap[session] = status
	if _, exists := statusLog[session]; !exists {
		statusLog[session] = []Status{}
	}
	statusLog[session] = append(statusLog[session], status)
}

func setStep(session, info string, step int) {
	status := statusMap[session]
	status.Step = step
	status.Info = info
	status.Time = int(time.Now().Unix())
	statusMap[session] = status
	if _, exists := statusLog[session]; !exists {
		statusLog[session] = []Status{}
	}
	statusLog[session] = append(statusLog[session], status)
	Hook(SessionState(session))
}

func setStatus(session string, status Status) {
	status.Time = int(time.Now().Unix())
	statusMap[session] = status
	if _, exists := statusLog[session]; !exists {
		statusLog[session] = []Status{}
	}
	statusLog[session] = append(statusLog[session], status)
	Hook(SessionState(session))
}

func JoinKeygen(ppmPath, key, partiesCSV, encKey, decKey, session, server, chaincode, sessionKey string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in JoinKeygen: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	parties := strings.Split(partiesCSV, ",")

	if len(sessionKey) > 0 && (len(encKey) > 0 || len(decKey) > 0) {
		return "", fmt.Errorf("either a session key, either enc/dec keys")
	}

	if len(sessionKey) == 0 && (len(encKey) == 0 || len(decKey) == 0) {
		return "", fmt.Errorf("either a session key, either both enc/dec keys")
	}

	encryptionKey = encKey
	decryptionKey = decKey

	status := Status{Step: 0, SeqNo: 0, Index: 0, Info: "initializing...", Type: "keygen", Done: false, Time: 0}
	setStatus(session, status)
	localStateMemory = ""

	Logln("BBMTLog", "start joinSession", session, "...")

	status.Step++
	status.Info = "start joinSession"
	setStatus(session, status)

	if err := joinSession(server, session, key); err != nil {
		return "", fmt.Errorf("fail to register session: %w", err)
	}

	Logln("BBMTLog", "waiting parties...")
	status.Step++
	status.Info = "waiting parties"
	setStatus(session, status)

	if err := awaitJoiners(parties, server, session); err != nil {
		Logln("BBMTLog", "fail to wait all parties", "error", err)
		return "", fmt.Errorf("fail to wait all parties: %w", err)
	}

	status.SeqNo++
	status.Index++
	setStatus(session, status)

	Logln("BBMTLog", "inbound messenger up...")
	messenger := &MessengerImp{
		Server:     server,
		SessionID:  session,
		SessionKey: sessionKey,
	}

	localStateAccessor := &LocalStateAccessorImp{
		key: key,
	}
	Logln("BBMTLog", "localStateAccessor loaded...")
	status.Step++
	status.Info = "local state loaded"
	setStatus(session, status)

	Logln("BBMTLog", "preparing NewService on ppmPath...")
	tssServerImp, err := NewService(messenger, localStateAccessor, true, ppmPath)
	if err != nil {
		return "", fmt.Errorf("fail to create tss server: %w", err)
	}
	endCh := make(chan struct{})
	wg := &sync.WaitGroup{}
	wg.Add(1)
	Logln("BBMTLog", "downloadMessage active...")
	go downloadMessage(server, session, sessionKey, key, *tssServerImp, endCh, wg)
	Logln("BBMTLog", "doing ECDSA keygen...")
	_, err = tssServerImp.KeygenECDSA(&KeygenRequest{
		LocalPartyID: key,
		AllParties:   strings.Join(parties, ","),
		ChainCodeHex: chaincode,
	})
	if err != nil {
		close(endCh)
		return "", fmt.Errorf("fail to generate ECDSA key: %w", err)
	}
	localState := localStateMemory
	localStateMemory = ""
	Logln("BBMTLog", "ECDSA keygen response ok")
	status = getStatus(session)
	status.Step++
	status.Info = "keygen ok"
	setStatus(session, status)

	time.Sleep(time.Second)
	if err = endSession(server, session); err != nil {
		close(endCh)
		Logln("BBMTLog", "Warning: endSession", "error", err)
	}
	status.Step++
	status.Info = "session ended"
	setStatus(session, status)

	err = flagPartyComplete(server, session, key)
	if err != nil {
		Logln("BBMTLog", "Warning: flagPartyComplete", "error", err)
	}
	status.Step++
	status.Info = "local party complete"
	status.Done = true
	setStatus(session, status)

	close(endCh)
	wg.Wait()

	Logln("========== DONE ==========")
	return localState, nil
}

func JoinKeysign(server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshare, derivePath, message string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in JoinKeysign: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()
	parties := strings.Split(partiesCSV, ",")

	if len(sessionKey) > 0 && (len(encKey) > 0 || len(decKey) > 0) {
		return "", fmt.Errorf("either a session key, either enc/dec keys")
	}

	if len(sessionKey) == 0 && (len(encKey) == 0 || len(decKey) == 0) {
		return "", fmt.Errorf("either a session key, either both enc/dec keys")
	}

	encryptionKey = encKey
	decryptionKey = decKey

	status := Status{Step: 0, SeqNo: 0, Index: 0, Info: "initializing...", Type: "keysign", Done: false, Time: 0}
	setStatus(session, status)

	localStateMemory = ""

	Logln("BBMTLog", "start joinSession", session, "...")
	status.Step++
	status.Info = "start joinSession"
	setStatus(session, status)

	if err := joinSession(server, session, key); err != nil {
		return "", fmt.Errorf("fail to register session: %w", err)
	}

	Logln("BBMTLog", "waiting parties...")
	status.Step++
	status.Info = "waiting parties"
	setStatus(session, status)

	if err := awaitJoiners(parties, server, session); err != nil {
		Logln("BBMTLog", "fail to wait all parties", "error", err)
		return "", fmt.Errorf("fail to wait all parties: %w", err)
	}

	status.SeqNo++
	status.Index++
	setStatus(session, status)

	Logln("BBMTLog", "inbound messenger up...")
	messenger := &MessengerImp{
		Server:     server,
		SessionID:  session,
		SessionKey: sessionKey,
	}

	localStateAccessor := &LocalStateAccessorImp{
		key: key,
	}
	Logln("BBMTLog", "localStateAccessor loaded...")
	status.Step++
	status.Info = "local state loaded"
	setStatus(session, status)

	Logln("BBMTLog", "preparing NewService...")
	tssServerImp, err := NewService(messenger, localStateAccessor, false, "-")
	if err != nil {
		return "", fmt.Errorf("fail to create tss server: %w", err)
	}
	endCh := make(chan struct{})
	wg := &sync.WaitGroup{}
	wg.Add(1)
	Logln("BBMTLog", "downloadMessage active...")
	go downloadMessage(server, session, sessionKey, key, *tssServerImp, endCh, wg)
	Logln("BBMTLog", "start ECDSA keysign...")
	resp, err := tssServerImp.KeysignECDSA(&KeysignRequest{
		PubKey:               keyshare,
		MessageToSign:        message,
		LocalPartyKey:        key,
		KeysignCommitteeKeys: strings.Join(parties, ","),
		DerivePath:           derivePath,
	})
	if err != nil {
		close(endCh)
		return "", fmt.Errorf("fail to KeysignECDSA key sign: %w", err)
	}

	sigStr, err := json.Marshal(resp)
	if err != nil {
		close(endCh)
		return "", fmt.Errorf("failed to marshal sig Resp to JSON, error: %w", err)
	}
	Logln("BBMTLog", "ECDSA keysign response ok")
	status = getStatus(session)
	status.Step++
	status.Info = "keysign ok"
	setStatus(session, status)

	time.Sleep(time.Second)
	if err := endSession(server, session); err != nil {
		close(endCh)
		return "", fmt.Errorf("fail to end session: %w", err)
	}
	status.Step++
	status.Info = "session ended"
	setStatus(session, status)

	time.Sleep(time.Second)
	err = flagPartyKeysignComplete(server, session, message, string(sigStr))
	if err != nil {
		Logln("BBMTLog", "Warning: flagPartyKeysignComplete", "error", err)
	}
	status.Step++
	status.Info = "local party complete"
	status.Done = true
	setStatus(session, status)

	close(endCh)
	wg.Wait()
	Logln("========== DONE ==========")
	return string(sigStr), nil
}

func md5Hash(data string) (string, error) {
	// Create a new MD5 hash
	hasher := md5.New()

	// Write the data to the hasher
	_, err := hasher.Write([]byte(data))
	if err != nil {
		return "", fmt.Errorf("failed to write data to hasher: %w", err)
	}

	// Get the hashed data
	hashBytes := hasher.Sum(nil)

	// Convert the hash to a hexadecimal string
	hashHex := hex.EncodeToString(hashBytes)

	return hashHex, nil
}

func AesEncrypt(data, key string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in AesEncrypt: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	decodedKey, err := hex.DecodeString(key)
	if err != nil {
		return "", fmt.Errorf("failed to decode key: %w", err)
	}
	block, err := aes.NewCipher(decodedKey)
	if err != nil {
		return "", fmt.Errorf("failed to create AES cipher block: %w", err)
	}
	paddedData := padPKCS7([]byte(data), aes.BlockSize)
	iv := make([]byte, aes.BlockSize)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return "", fmt.Errorf("failed to generate IV: %w", err)
	}
	mode := cipher.NewCBCEncrypter(block, iv)
	encryptedData := make([]byte, len(paddedData))
	mode.CryptBlocks(encryptedData, paddedData)
	combined := append(iv, encryptedData...)
	encodedData := base64.StdEncoding.EncodeToString(combined)
	return encodedData, nil
}

func AesDecrypt(encryptedData, key string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in AesDecrypt: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	// Decode the key from hex
	decodedKey, err := hex.DecodeString(key)
	if err != nil {
		return "", fmt.Errorf("failed to decode key: %w", err)
	}

	// Decode the encrypted data from base64
	encryptedBytes, err := base64.StdEncoding.DecodeString(encryptedData)
	if err != nil {
		return "", fmt.Errorf("failed to decode encrypted data: %w", err)
	}

	// Extract IV and ciphertext
	blockSize := aes.BlockSize
	iv := encryptedBytes[:blockSize]
	ciphertext := encryptedBytes[blockSize:]

	// Create AES cipher block
	block, err := aes.NewCipher(decodedKey)
	if err != nil {
		return "", fmt.Errorf("failed to create AES cipher block: %w", err)
	}

	// Decrypt the data
	mode := cipher.NewCBCDecrypter(block, iv)
	decryptedData := make([]byte, len(ciphertext))
	mode.CryptBlocks(decryptedData, ciphertext)

	// Remove padding
	decryptedData = unpadPKCS7(decryptedData)

	return string(decryptedData), nil
}

func padPKCS7(data []byte, blockSize int) []byte {
	padding := blockSize - len(data)%blockSize
	pad := make([]byte, padding)
	for i := range pad {
		pad[i] = byte(padding)
	}
	return append(data, pad...)
}

func unpadPKCS7(data []byte) []byte {
	length := len(data)
	unpadding := int(data[length-1])
	return data[:length-unpadding]
}

func (m *MessengerImp) Send(from, to, body string) error {

	m.Mutex.Lock()
	defer m.Mutex.Unlock()

	var err error
	payload := body

	// Encrypt the message if required
	if len(m.SessionKey) > 0 {
		payload, err = AesEncrypt(body, m.SessionKey)
		if err != nil {
			return fmt.Errorf("fail to encrypt message: %w", err)
		}
	} else if len(encryptionKey) > 0 {
		payload, err = EciesEncrypt(body, encryptionKey)
		if err != nil {
			return fmt.Errorf("fail to ECIES-encrypt message: %w", err)
		}
	}

	// Compute MD5 hash of the body
	hash, err := md5Hash(body)
	if err != nil {
		Logln("BBMTLog", "Error computing MD5 hash:", err)
	}

	status := getStatus(m.SessionID)

	// Marshal the request payload into JSON
	requestBody, err := json.MarshalIndent(struct {
		SessionID string   `json:"session_id,omitempty"`
		From      string   `json:"from,omitempty"`
		To        []string `json:"to,omitempty"`
		Body      string   `json:"body,omitempty"`
		SeqNo     string   `json:"sequence_no,omitempty"`
		Hash      string   `json:"hash,omitempty"`
	}{
		SessionID: m.SessionID,
		From:      from,
		To:        []string{to},
		Body:      payload,
		SeqNo:     strconv.Itoa(status.SeqNo),
		Hash:      hash,
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("fail to marshal message: %w", err)
	}

	url := m.Server + "/message/" + m.SessionID
	Logln("BBMTLog", "sending message...")

	// Prepare the HTTP request
	resp, err := http.Post(url, "application/json", bytes.NewReader(requestBody))
	if err != nil {
		Logln("BBMTLog", "fail to send message: ", err)
		return fmt.Errorf("fail to send message: %w", err)
	}
	defer resp.Body.Close()

	// Log the response
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		Logln("BBMTLog", "fail to read response: ", err)
		return fmt.Errorf("fail to read response: %w", err)
	}
	Logln("BBMTLog", "message sent, status:", resp.Status)

	// Check for non-200 status codes
	if resp.StatusCode != http.StatusOK {
		Logln("BBMTLog", "message sent, response body:", string(respBody)[:min(80, len(string(respBody)))]+"...")
		return fmt.Errorf("fail to send message: %s", resp.Status)
	}

	// Increment the sequence number after successful send
	Logln("BBMTLog", "incremented Sent Message To OutSeqNo", status.SeqNo)
	status.Info = fmt.Sprintf("Sent Message %d", status.SeqNo)
	status.Step++
	status.SeqNo++
	setSeqNo(m.SessionID, status.Info, status.Step, status.SeqNo)

	return nil
}

func (l *LocalStateAccessorImp) GetLocalState(keyshare string) (string, error) {
	pubKey := ""
	if strings.HasPrefix(keyshare, "{") {
		pubKey = keyshare
	} else {
		decodedPubKey, err := base64.StdEncoding.DecodeString(keyshare)
		if err != nil {
			return "", fmt.Errorf("invalid keyshare: %w", err)
		}
		pubKey = string(decodedPubKey)
	}
	return pubKey, nil
}

func (l *LocalStateAccessorImp) SaveLocalState(pubKey, localState string) error {
	localStateMemory = localState
	return nil
}

func joinSession(server, session, key string) error {
	timeout := time.NewTimer(30 * time.Second)
	defer timeout.Stop()
	for {
		select {
		case <-timeout.C:
			return fmt.Errorf("timeout joining the session")
		default:
			sessionUrl := server + "/" + session
			body := []byte("[\"" + key + "\"]")
			bodyReader := bytes.NewReader(body)
			resp, err := http.Post(sessionUrl, "application/json", bodyReader)
			if err != nil {
				Logln("BBMTLog", "fail to get session", "error", err)
				time.Sleep(2 * time.Second)
			} else if resp.StatusCode != http.StatusCreated {
				Logln("BBMTLog", "fail to check session", "status", resp.Status)
				time.Sleep(2 * time.Second)
			} else {
				return nil
			}
		}
	}
}

func awaitJoiners(parties []string, server, session string) error {
	sessionUrl := server + "/" + session
	timeout := time.NewTimer(30 * time.Second)
	defer timeout.Stop()

	for {
		select {
		case <-timeout.C:
			return fmt.Errorf("timeout waiting for all parties after 30 seconds")
		default:
			resp, err := http.Get(sessionUrl)
			if err != nil {
				Logln("BBMTLog", "fail to get session", "error", err)
				continue
			}

			if resp.StatusCode != http.StatusOK {
				Logln("BBMTLog", "waiting for session...")
				continue
			}

			var keys []string
			buff, err := io.ReadAll(resp.Body)
			if err != nil {
				return fmt.Errorf("fail to read session body: %w", err)
			}

			if err := json.Unmarshal(buff, &keys); err != nil {
				return fmt.Errorf("fail to unmarshal session body: %w", err)
			}

			if equalUnordered(keys, parties) {
				return nil
			}

			// backoff
			time.Sleep(2 * time.Second)
		}
	}
}

func equalUnordered(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}

	amap := make(map[string]int)
	for _, val := range a {
		amap[val]++
	}

	for _, val := range b {
		if amap[val] == 0 {
			return false
		}
		amap[val]--
	}

	return true
}

func endSession(server, session string) error {
	sessionUrl := server + "/" + session
	Logln("======================================================> Session Closure: ", session)
	client := http.Client{}
	req, err := http.NewRequest(http.MethodDelete, sessionUrl, nil)
	if err != nil {
		return fmt.Errorf("fail to end session: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("fail to end session: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fail to end session: %s", resp.Status)
	}
	return nil
}

func flagPartyKeysignComplete(relayHost, sessionID, message, body string) error {
	// Construct the server URL
	serverURL := fmt.Sprintf("%s/complete/keysign/%s", relayHost, sessionID)

	// Create the HTTP POST request with the raw body
	req, err := http.NewRequest("POST", serverURL, bytes.NewBufferString(body))
	if err != nil {
		return fmt.Errorf("failed to create POST request: %w", err)
	}

	// Set required headers
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("message_id", message)
	// req.Header.Set("Content-Type", "text/plain")

	// Configure the HTTP client with a timeout
	client := &http.Client{}

	// Execute the HTTP POST request
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send POST request: %w", err)
	}

	defer resp.Body.Close()

	// Read the response body
	respBody, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return fmt.Errorf("failed to read response body: %w", readErr)
	}

	// Check the HTTP response status
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf(
			"flagPartyKeysignComplete unexpected response status: %s, response body: %s",
			resp.Status, string(respBody),
		)
	}

	Logf("BBMTLog: flagPartyKeysignComplete succeeded: Session %s, Response Code %d", sessionID, resp.StatusCode)
	return nil
}

func flagPartyComplete(serverURL, session, localPartyID string) error {
	payload, err := json.Marshal([]string{localPartyID})
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	resp, err := http.Post(serverURL+"/complete/keygen/"+session, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return fmt.Errorf("failed to send POST request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}
	if resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("flagPartyComplete unexpected response status: %s, %s", resp.Status, &body)
	}

	Logln("BBMTLog", "flagPartyComplete:", localPartyID)
	return nil
}

func downloadMessage(server, session, sessionKey, key string, tssServerImp ServiceImpl, endCh chan struct{}, wg *sync.WaitGroup) {
	defer wg.Done()
	isApplyingMessages := false
	until := time.Now().Add(time.Duration(msgFetchTimeout) * time.Second)
	msgMap := make(map[string]bool)

	for {
		select {
		case <-endCh:
			Logln("BBMTLog", "Received signal to end downloadMessage. Stopping...")
			return

		case <-time.After(time.Second / 2):
			if time.Since(until) > 0 {
				Logln("BBMTLog", "Received timeout to end downloadMessage. Stopping...")
				return
			}

			// Prevent multiple fetch and apply processes at once
			if isApplyingMessages {
				Logln("BBMTLog", "Already applying messages, skipping fetch.")
				continue
			}
			isApplyingMessages = true
			Logln("BBMTLog", "Fetching messages...")

			// Fetch messages from the server
			resp, err := http.Get(server + "/message/" + session + "/" + key)
			if err != nil {
				Logln("BBMTLog", "Error fetching messages:", err)
				isApplyingMessages = false
				continue
			}

			if resp.StatusCode == http.StatusNotFound {
				Logln("BBMTLog", "No messages found.")
				isApplyingMessages = false
				continue
			}

			if resp.StatusCode != http.StatusOK {
				Logln("BBMTLog", "Failed to get data from server:", resp.Status)
				isApplyingMessages = false
				continue
			}

			// Read the response body
			bodyBytes, err := io.ReadAll(resp.Body)
			if err != nil {
				Logln("BBMTLog", "Failed to read response body:", err)
				isApplyingMessages = false
				continue
			}
			resp.Body.Close()

			// Decode the messages from the response
			var messages []struct {
				SessionID string   `json:"session_id,omitempty"`
				From      string   `json:"from,omitempty"`
				To        []string `json:"to,omitempty"`
				Body      string   `json:"body,omitempty"`
				SeqNo     string   `json:"sequence_no,omitempty"`
				Hash      string   `json:"hash,omitempty"`
			}
			if err := json.Unmarshal(bodyBytes, &messages); err != nil {
				Logln("BBMTLog", "Failed to decode messages:", err)
				isApplyingMessages = false
				continue
			}

			Logln("BBMTLog", "Got messages count:", len(messages))

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
				if message.From == key {
					Logln("BBMTLog", "Skipping message from self...")
					continue
				}

				Logln("BBMTLog", "Checking message seqNo", message.SeqNo)
				_, exists := msgMap[message.Hash]
				if exists {
					Logln("BBMTLog", "Already applied message:", message.SeqNo)
					deleteMessage(server, session, key, message.Hash)
					continue
				} else {
					msgMap[message.Hash] = true
				}

				status := getStatus(session)

				// Only process messages that match the expected seqNo
				Logln("BBMTLog", "Applying message:", message.SeqNo)

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

				// Delete applied message from the server
				Logln("BBMTLog", "Deleting applied message:", message.Hash)
				deleteMessage(server, session, key, message.Hash)

			}
			isApplyingMessages = false
		}
	}
}

func deleteMessage(server, session, key, messageHash string) {
	// Delete Applied Message - Lower Read Overhead
	Logln("BBMTLog", "deleting applied message", messageHash)
	delURL := server + "/message/" + session + "/" + key + "/" + messageHash

	req, err := http.NewRequest("DELETE", delURL, nil)
	if err != nil {
		Logln("BBMTLog", "HTTP_DELETE Request Error", err)
	}

	resp, rspErr := http.DefaultClient.Do(req)
	if rspErr != nil {
		Logln("BBMTLog", "HTTP_DELETE Error", rspErr)
	}
	Logln("BBMTLog", "deleted message", messageHash)

	defer resp.Body.Close()
}
