package tss

import (
	"bytes"
	"context"
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
	"os"
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
	statusMutex      sync.RWMutex // Mutex to protect concurrent access to statusMap and statusLog
	encryptionKey    = ""
	decryptionKey    = ""
	localStateMemory = ""
	keyMutex         sync.RWMutex // Mutex to protect concurrent access to encryptionKey, decryptionKey, and localStateMemory
	keyGenTimeout    = 120
	keySignTimeout   = 60
	msgFetchTimeout  = 70
)

func SessionState(session string) string {
	statusMutex.RLock()
	defer statusMutex.RUnlock()
	status, exists := statusMap[session]
	if !exists {
		return fmt.Sprintf(`{ "session": %q }`, session)
	}
	return fmt.Sprintf(
		`{ "session": %q, "time": %d, "step": %d, "type": "%s", "info": %q, "sentNo": %d, "receivedNo": %d, "done": %t }`,
		session, status.Time, status.Step, status.Type, status.Info, status.SeqNo, status.Index, status.Done,
	)
}

func ClearSessionLog(session string) {
	statusMutex.Lock()
	defer statusMutex.Unlock()
	delete(statusMap, session)
	delete(statusLog, session)
}

func SessionLog(session string) string {
	statusMutex.RLock()
	defer statusMutex.RUnlock()
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
	statusMutex.RLock()
	defer statusMutex.RUnlock()
	return statusMap[session]
}

func setSeqNo(session, info string, step, seqNo int) {
	statusMutex.Lock()
	defer statusMutex.Unlock()
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
	statusMutex.Lock()
	defer statusMutex.Unlock()
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
	statusMutex.Lock()
	status := statusMap[session]
	status.Step = step
	status.Info = info
	status.Time = int(time.Now().Unix())
	statusMap[session] = status
	if _, exists := statusLog[session]; !exists {
		statusLog[session] = []Status{}
	}
	statusLog[session] = append(statusLog[session], status)
	statusMutex.Unlock()
	Hook(SessionState(session))
}

func setStatus(session string, status Status) {
	statusMutex.Lock()
	status.Time = int(time.Now().Unix())
	statusMap[session] = status
	if _, exists := statusLog[session]; !exists {
		statusLog[session] = []Status{}
	}
	statusLog[session] = append(statusLog[session], status)
	statusMutex.Unlock()
	Hook(SessionState(session))
}

func JoinKeygen(ppmPath, key, partiesCSV, encKey, decKey, session, server, chaincode, sessionKey string) (result string, err error) {
	defer RecoverAsError("JoinKeygen", &err, &result)

	parties := strings.Split(partiesCSV, ",")

	if len(sessionKey) > 0 && (len(encKey) > 0 || len(decKey) > 0) {
		return "", fmt.Errorf("either a session key, either enc/dec keys")
	}

	if len(sessionKey) == 0 && (len(encKey) == 0 || len(decKey) == 0) {
		return "", fmt.Errorf("either a session key, either both enc/dec keys")
	}

	keyMutex.Lock()
	encryptionKey = encKey
	decryptionKey = decKey
	localStateMemory = ""
	keyMutex.Unlock()

	status := Status{Step: 0, SeqNo: 0, Index: 0, Info: "initializing...", Type: "keygen", Done: false, Time: 0}
	setStatus(session, status)

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
	chainCodeHex, err := normalizeChainCodeHex(chaincode)
	if err != nil {
		close(endCh)
		return "", fmt.Errorf("fail to normalize chain code: %w", err)
	}
	_, err = tssServerImp.KeygenECDSA(&KeygenRequest{
		LocalPartyID: key,
		AllParties:   strings.Join(parties, ","),
		ChainCodeHex: chainCodeHex,
	})
	if err != nil {
		close(endCh)
		return "", fmt.Errorf("fail to generate ECDSA key: %w", err)
	}
	keyMutex.Lock()
	localState := localStateMemory
	localStateMemory = ""
	keyMutex.Unlock()
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
	defer RecoverAsError("JoinKeysign", &err, &result)
	parties := strings.Split(partiesCSV, ",")

	// Ensure the session has a cancel channel (prefix-cancellable) and clean it up at end.
	cancelCh := getOrCreateCancelCh(session)
	defer cleanupCancelState(session)

	if len(sessionKey) > 0 && (len(encKey) > 0 || len(decKey) > 0) {
		return "", fmt.Errorf("either a session key, either enc/dec keys")
	}

	if len(sessionKey) == 0 && (len(encKey) == 0 || len(decKey) == 0) {
		return "", fmt.Errorf("either a session key, either both enc/dec keys")
	}

	keyMutex.Lock()
	encryptionKey = encKey
	decryptionKey = decKey
	localStateMemory = ""
	keyMutex.Unlock()

	status := Status{Step: 0, SeqNo: 0, Index: 0, Info: "initializing...", Type: "keysign", Done: false, Time: 0}
	setStatus(session, status)

	Logln("BBMTLog", "start joinSession", session, "...")
	status.Step++
	status.Info = "start joinSession"
	setStatus(session, status)

	if sessionIsCancelled(session) {
		return "", context.Canceled
	}

	if err := joinSession(server, session, key); err != nil {
		return "", fmt.Errorf("fail to register session: %w", err)
	}

	Logln("BBMTLog", "waiting parties...")
	status.Step++
	status.Info = "waiting parties"
	setStatus(session, status)

	if sessionIsCancelled(session) {
		return "", context.Canceled
	}

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
	// Wire cancellation signal into the signing loop.
	tssServerImp.cancelCh = cancelCh
	endCh := make(chan struct{})
	wg := &sync.WaitGroup{}
	wg.Add(1)
	Logln("BBMTLog", "downloadMessage active...")
	go downloadMessage(server, session, sessionKey, key, *tssServerImp, endCh, wg)
	Logln("BBMTLog", "start ECDSA keysign...")
	if sessionIsCancelled(session) {
		close(endCh)
		wg.Wait()
		return "", context.Canceled
	}
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
	defer RecoverAsError("AesEncrypt", &err, &result)

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
	defer RecoverAsError("AesDecrypt", &err, &result)

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
	} else {
		keyMutex.RLock()
		encKey := encryptionKey
		keyMutex.RUnlock()
		if len(encKey) > 0 {
			payload, err = EciesEncrypt(body, encKey)
			if err != nil {
				return fmt.Errorf("fail to ECIES-encrypt message: %w", err)
			}
		}
	}

	// Compute MD5 hash of the body
	hash, err := md5Hash(body)
	if err != nil {
		Logln("BBMTLog", "Error computing MD5 hash:", err)
	}

	// Per-party seq so parallel LAN parties in one process (integration tests) do not share SeqNo.
	seqKey := m.SessionID + "\x1f" + from
	status := getStatus(seqKey)

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

	ReportTransportProgress(m.SessionID, "lan", "out", 0, 1, true)
	defer ReportTransportProgress(m.SessionID, "lan", "out", 0, 1, false)

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
	setSeqNo(seqKey, status.Info, status.Step, status.SeqNo)

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
	keyMutex.Lock()
	localStateMemory = localState
	keyMutex.Unlock()
	return nil
}

func joinSession(server, session, key string) error {
	timeout := time.NewTimer(60 * time.Second)
	defer timeout.Stop()
	retry := time.NewTicker(2 * time.Second)
	defer retry.Stop()
	sessionUrl := server + "/" + session
	body := []byte("[\"" + key + "\"]")
	attempts := 0
	tryJoin := func() bool {
		attempts++
		bodyReader := bytes.NewReader(body)
		resp, err := http.Post(sessionUrl, "application/json", bodyReader)
		if err != nil {
			Logln("BBMTLog", "joinSession: POST failed", "url=", sessionUrl, "party=", key, "attempt=", attempts, "err=", err)
			return false
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			Logln("BBMTLog", "joinSession: unexpected status", "url=", sessionUrl, "party=", key, "attempt=", attempts, "status=", resp.Status)
			return false
		}
		Logln("BBMTLog", "joinSession: registered", "party=", key, "session=", session)
		return true
	}
	if tryJoin() {
		return nil
	}
	for {
		select {
		case <-timeout.C:
			return fmt.Errorf(
				"timeout joining the session (server=%s session=%s party=%s attempts=%d)",
				server, session, key, attempts,
			)
		case <-retry.C:
			if tryJoin() {
				return nil
			}
		}
	}
}

func lanJoinAwaitTimeout(partyCount int) time.Duration {
	if s := os.Getenv("DKLS_TEST_AWAIT_SEC"); s != "" {
		if sec, err := strconv.Atoi(s); err == nil && sec > 0 {
			return time.Duration(sec) * time.Second
		}
	}
	if partyCount >= 3 {
		return 120 * time.Second
	}
	// Duo: joiner probes relay after master starts it; allow time for Join-first pacing.
	return 30 * time.Second
}

func partiesMissing(have, need []string) []string {
	haveSet := make(map[string]struct{}, len(have))
	for _, h := range have {
		haveSet[h] = struct{}{}
	}
	var missing []string
	for _, n := range need {
		if _, ok := haveSet[n]; !ok {
			missing = append(missing, n)
		}
	}
	return missing
}

func awaitJoiners(parties []string, server, session string) error {
	sessionUrl := server + "/" + session
	waitFor := lanJoinAwaitTimeout(len(parties))
	timeout := time.NewTimer(waitFor)
	defer timeout.Stop()
	poll := time.NewTicker(2 * time.Second)
	defer poll.Stop()
	lastLog := time.Time{}
	check := func() (bool, error) {
		keys, err := fetchSessionParticipants(sessionUrl)
		if err != nil {
			Logln("BBMTLog", "awaitJoiners: get session failed", err)
			return false, nil
		}
		if equalUnordered(keys, parties) {
			Logln("BBMTLog", "awaitJoiners: all parties joined", session, keys)
			return true, nil
		}
		if missing := partiesMissing(keys, parties); len(missing) > 0 {
			ReportKeygenProgress(
				session, 1,
				fmt.Sprintf("waiting for %s", strings.Join(missing, ", ")),
				false,
			)
		}
		if time.Since(lastLog) >= 10*time.Second {
			lastLog = time.Now()
			Logln(
				"BBMTLog", "awaitJoiners: waiting",
				"session=", session,
				"have=", keys,
				"need=", parties,
			)
		}
		return false, nil
	}
	if done, err := check(); err != nil || done {
		return err
	}
	for {
		select {
		case <-timeout.C:
			keys, _ := fetchSessionParticipants(sessionUrl)
			return fmt.Errorf(
				"timeout waiting for all parties after %v (have %v, need %v)",
				waitFor, keys, parties,
			)
		case <-poll.C:
			if done, err := check(); err != nil || done {
				return err
			}
		}
	}
}

func fetchSessionParticipants(sessionUrl string) ([]string, error) {
	resp, err := http.Get(sessionUrl)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("session status %s", resp.Status)
	}
	buff, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var keys []string
	if err := json.Unmarshal(buff, &keys); err != nil {
		return nil, err
	}
	return keys, nil
}

func equalUnordered(a, b []string) bool {
	aset := stringSet(a)
	bset := stringSet(b)
	if len(aset) != len(bset) {
		return false
	}
	for k := range bset {
		if _, ok := aset[k]; !ok {
			return false
		}
	}
	return true
}

func stringSet(vals []string) map[string]struct{} {
	out := make(map[string]struct{}, len(vals))
	for _, v := range vals {
		out[v] = struct{}{}
	}
	return out
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
				} else {
					keyMutex.RLock()
					decKey := decryptionKey
					keyMutex.RUnlock()
					if len(decKey) > 0 {
						body, err = EciesDecrypt(message.Body, decKey)
						if err != nil {
							Logln("BBMTLog", "Failed to decrypt ECIES message:", err)
							continue
						}
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
