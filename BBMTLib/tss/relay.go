package tss

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/patrickmn/go-cache"
)

// Global Cache
var dataCache = cache.New(5*time.Minute, 10*time.Minute)

// Mutex for safe concurrent operations
var mutex sync.Mutex

// Session structure
type Session struct {
	SessionID    string   `json:"sessionID"`
	Participants []string `json:"participants"`
}

// Message structure
type Message struct {
	SessionID string   `json:"session_id,omitempty"`
	From      string   `json:"from,omitempty"`
	To        []string `json:"to,omitempty"`
	Body      string   `json:"body,omitempty"`
	SeqNo     string   `json:"sequence_no,omitempty"`
	Hash      string   `json:"hash,omitempty"`
}

// ---- Helper Functions ----
func getSessionID(r *http.Request) string {
	vars := mux.Vars(r)
	return vars["sessionID"]
}

func getKeyParam(r *http.Request) string {
	vars := mux.Vars(r)
	return vars["participantKey"]
}

func getHashParam(r *http.Request) string {
	vars := mux.Vars(r)
	return vars["hash"]
}

func pf(format string, v ...interface{}) {
	log.Printf(format, v...)
}

// ---- Session Handlers ----
func postSession(w http.ResponseWriter, r *http.Request) {
	sessionID := getSessionID(r)
	if sessionID == "" {
		http.Error(w, "sessionID is required", http.StatusBadRequest)
		return
	}

	var participants []string
	if err := json.NewDecoder(r.Body).Decode(&participants); err != nil {
		http.Error(w, "invalid JSON payload", http.StatusBadRequest)
		return
	}

	mutex.Lock()
	defer mutex.Unlock()

	key := "session-" + sessionID
	if session, found := getData(key); found {
		existingSession := session.(Session)
		existingSession.Participants = append(existingSession.Participants, participants...)
		setData(key, existingSession)
	} else {
		setData(key, Session{SessionID: sessionID, Participants: participants})
	}

	w.WriteHeader(http.StatusCreated)
	pf("Session %s registered with participants: %v", sessionID, participants)
}

func getSession(w http.ResponseWriter, r *http.Request) {
	sessionID := getSessionID(r)
	key := "session-" + sessionID

	if session, found := getData(key); found {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(session.(Session).Participants)
		return
	}

	http.Error(w, "session not found", http.StatusNotFound)
}

func deleteSession(w http.ResponseWriter, r *http.Request) {
	sessionID := getSessionID(r)
	key := "session-" + sessionID

	mutex.Lock()
	defer mutex.Unlock()

	dataCache.Delete(key)
	dataCache.Delete(key + "-start")
	w.WriteHeader(http.StatusOK)
	pf("Session %s deleted", sessionID)
}

func completedKeysign(w http.ResponseWriter, r *http.Request) {
	sessionID := getSessionID(r)

	// Read 'message' header and 'body' from the request body
	messageID := r.Header.Get("message_id")
	if messageID == "" {
		http.Error(w, "message_id header is required", http.StatusBadRequest)
		return
	}

	// Read the request body to get the body data
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read request body", http.StatusInternalServerError)
		return
	}
	defer r.Body.Close()

	// Example operation to mark local party keysign complete (you can change it to suit your logic)
	keysignCompleteKey := "keysign-complete-" + sessionID
	setData(keysignCompleteKey, map[string]interface{}{
		"sessionID": sessionID,
		"messageID": messageID,
		"body":      string(bodyBytes),
	})

	// Respond to client
	w.WriteHeader(http.StatusOK)
	log.Printf("BBMTLog: completedKeysign succeeded: Session %s, MessageID %s", sessionID, messageID)
}

func completedKeygen(w http.ResponseWriter, r *http.Request) {
	sessionID := getSessionID(r)

	// Read request body (local party ID)
	var localPartyID []string
	if err := json.NewDecoder(r.Body).Decode(&localPartyID); err != nil || len(localPartyID) == 0 {
		http.Error(w, "invalid or missing localPartyID", http.StatusBadRequest)
		return
	}

	// Save the completed local party ID to session data (this can be an operation to mark a local party's completion)
	partyCompletionKey := "local-party-complete-" + sessionID
	setData(partyCompletionKey, localPartyID)

	// Respond to client
	w.WriteHeader(http.StatusCreated)
	log.Printf("BBMTLog: completedKeygen succeeded: Session %s, LocalPartyID %s", sessionID, localPartyID[0])
}

// ---- Message Handlers ----
func postMessage(w http.ResponseWriter, r *http.Request) {
	sessionID := getSessionID(r)
	key := "message-" + sessionID

	var msg Message
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		http.Error(w, "invalid JSON payload", http.StatusBadRequest)
		return
	}

	mutex.Lock()
	defer mutex.Unlock()

	var messages []Message
	if data, found := getData(key); found {
		messages = data.([]Message)
	}
	messages = append(messages, msg)
	setData(key, messages)

	w.WriteHeader(http.StatusOK)
	pf("Message added to session %s: %+v", sessionID, msg)
}

func getMessage(w http.ResponseWriter, r *http.Request) {
	sessionID := getSessionID(r)
	participantKey := getKeyParam(r)
	key := "message-" + sessionID

	if data, found := getData(key); found {
		messages := data.([]Message)
		filtered := []Message{}
		for _, msg := range messages {
			for _, to := range msg.To {
				if to == participantKey {
					filtered = append(filtered, msg)
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(filtered)
		return
	}

	http.Error(w, "no messages found", http.StatusNotFound)
}

func deleteTssMessage(w http.ResponseWriter, r *http.Request) {
	sessionID := getSessionID(r)
	participantKey := getKeyParam(r)
	hash := getHashParam(r)
	key := "message-" + sessionID

	mutex.Lock()
	defer mutex.Unlock()

	if data, found := getData(key); found {
		messages := data.([]Message)
		filtered := []Message{}
		for _, msg := range messages {
			if !(msg.Hash == hash && msg.From == participantKey) {
				filtered = append(filtered, msg)
			}
		}
		setData(key, filtered)
		w.WriteHeader(http.StatusOK)
		pf("Message deleted from session %s by %s with hash %s", sessionID, participantKey, hash)
		return
	}

	http.Error(w, "message not found", http.StatusNotFound)
}

// ---- Utility Functions ----
func setData(key string, value interface{}) {
	dataCache.Set(key, value, cache.DefaultExpiration)
}

func getData(key string) (interface{}, bool) {
	return dataCache.Get(key)
}

// ==============================
// 🚀 Server Initialization
// ==============================
func listen(port string) *http.Server {
	r := mux.NewRouter()

	// Session Routes
	r.HandleFunc("/{sessionID}", postSession).Methods("POST")
	r.HandleFunc("/{sessionID}", getSession).Methods("GET")
	r.HandleFunc("/{sessionID}", deleteSession).Methods("DELETE")

	// Handlers for session completions
	r.HandleFunc("/complete/keysign/{sessionID}", completedKeysign).Methods("POST")
	r.HandleFunc("/complete/keygen/{sessionID}", completedKeygen).Methods("POST")

	// Message Routes
	r.HandleFunc("/message/{sessionID}", postMessage).Methods("POST")
	r.HandleFunc("/message/{sessionID}/{participantKey}", getMessage).Methods("GET")
	r.HandleFunc("/message/{sessionID}/{participantKey}/{hash}", deleteTssMessage).Methods("DELETE")

	server := &http.Server{
		Addr:    "0.0.0.0:" + port,
		Handler: r,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	return server
}

var server *http.Server = nil

func RunRelay(port string) (string, error) {
	if server != nil {
		StopRelay()
	}
	time.Sleep(time.Second)
	go func() {
		server = listen(port)
	}()
	return "ok", nil
}

func StopRelay() (string, error) {
	if server == nil {
		return "already_closed", nil
	}
	server.Close()
	server = nil
	return "ok", nil
}
