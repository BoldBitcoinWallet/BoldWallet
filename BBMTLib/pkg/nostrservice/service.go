package nostrservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
)

const (
	bridgeEventPrefix       = "NOSTR_SERVICE_EVENT:"
	staleRoomTTL            = 15 * time.Minute
	roomInboundDedupeTTL    = 8 * time.Second
	maxRoomInboundDedupeIDs = 4096
	defaultReconnectInitial = 500 * time.Millisecond
	defaultReconnectMax     = 5 * time.Second
	defaultHeartbeatEvery   = 10 * time.Second
	defaultHeartbeatTimeout = 45 * time.Second
)

// CoSignRequest is the canonical outgoing/incoming request shape for co-sign rounds.
type CoSignRequest struct {
	Type             string `json:"type,omitempty"`
	TxID             string `json:"txId"`
	TraceID          string `json:"traceId,omitempty"`
	PSBTHex          string `json:"psbtHex,omitempty"`
	PSBTBase64       string `json:"psbtBase64,omitempty"`
	AmountSats       int64  `json:"amountSats,omitempty"`
	FeeSats          int64  `json:"feeSats,omitempty"`
	RecipientAddress string `json:"recipientAddress,omitempty"`
	Network          string `json:"network,omitempty"`
	RequestMode      string `json:"requestMode,omitempty"`
}

// CoSignReady is emitted when a peer enters the native signing flow.
type CoSignReady struct {
	Type    string `json:"type,omitempty"`
	TxID    string `json:"txId"`
	TraceID string `json:"traceId,omitempty"`
}

// KeysignPayload is a generic payload for MPC chunk/intent traffic.
type KeysignPayload struct {
	Type      string          `json:"type,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	TraceID   string          `json:"traceId,omitempty"`
	TxID      string          `json:"txId,omitempty"`
	Body      json.RawMessage `json:"body,omitempty"`
}

// Event is emitted by the room event loop and fanned out to subscribers.
type Event struct {
	RoomHash   string          `json:"roomHash"`
	Type       string          `json:"type"`
	TraceID    string          `json:"traceId,omitempty"`
	TxID       string          `json:"txId,omitempty"`
	SenderNpub string          `json:"senderNpub,omitempty"`
	Payload    json.RawMessage `json:"payload"`
	ReceivedAt int64           `json:"receivedAt"`
}

// RoomConfig defines transport inputs for a room subscription/publication context.
type RoomConfig struct {
	RoomHash      string
	RelaysCSV     string
	LocalNsec     string
	LocalNpub     string
	PeersNpubsCSV string
	Policy        RoomPolicy
}

// RoomPolicy controls per-room reconnect and liveness behavior.
type RoomPolicy struct {
	ReconnectInitialMs int64 `json:"reconnectInitialMs,omitempty"`
	ReconnectMaxMs     int64 `json:"reconnectMaxMs,omitempty"`
	HeartbeatEveryMs   int64 `json:"heartbeatEveryMs,omitempty"`
	HeartbeatTimeoutMs int64 `json:"heartbeatTimeoutMs,omitempty"`
}

type roomPolicy struct {
	ReconnectInitial time.Duration
	ReconnectMax     time.Duration
	HeartbeatEvery   time.Duration
	HeartbeatTimeout time.Duration
}

type roomSession struct {
	id          string
	cfg         nostrtransport.Config
	policy      roomPolicy
	ctx         context.Context
	cancel      context.CancelFunc
	client      *nostrtransport.Client
	messenger   *nostrtransport.Messenger
	pump        *nostrtransport.MessagePump
	subscribers map[uint64]chan Event
	lastTouch   time.Time
	lastEventMs atomic.Int64
	staleState  atomic.Int32
	retryMu     sync.Mutex
	retryDelay  time.Duration
	seenMu      sync.Mutex
	seenInbound map[string]int64
}

func (r *roomSession) touch() {
	r.lastTouch = time.Now()
}

func (r *roomSession) markEventSeen() {
	now := time.Now().UnixMilli()
	r.lastEventMs.Store(now)
	r.staleState.Store(0)
	r.retryMu.Lock()
	r.retryDelay = r.policy.ReconnectInitial
	r.retryMu.Unlock()
}

func (r *roomSession) nextRetryDelay() time.Duration {
	r.retryMu.Lock()
	defer r.retryMu.Unlock()
	if r.retryDelay <= 0 {
		r.retryDelay = r.policy.ReconnectInitial
	}
	current := r.retryDelay
	next := current * 2
	if next > r.policy.ReconnectMax {
		next = r.policy.ReconnectMax
	}
	r.retryDelay = next
	return current
}

func (r *roomSession) idleFor(now time.Time) time.Duration {
	last := r.lastEventMs.Load()
	if last <= 0 {
		return 0
	}
	return now.Sub(time.UnixMilli(last))
}

func (r *roomSession) shouldDropInbound(raw []byte) bool {
	now := time.Now().UnixMilli()
	key := inboundDedupeKey(raw)
	if key == "" {
		return false
	}

	r.seenMu.Lock()
	defer r.seenMu.Unlock()

	if prev, ok := r.seenInbound[key]; ok {
		if now-prev <= roomInboundDedupeTTL.Milliseconds() {
			return true
		}
	}
	r.seenInbound[key] = now

	if len(r.seenInbound) > maxRoomInboundDedupeIDs {
		cutoff := now - roomInboundDedupeTTL.Milliseconds()
		for k, ts := range r.seenInbound {
			if ts < cutoff {
				delete(r.seenInbound, k)
			}
		}
		if len(r.seenInbound) > maxRoomInboundDedupeIDs {
			r.seenInbound = make(map[string]int64)
			r.seenInbound[key] = now
		}
	}

	return false
}

// Service is the singleton Nostr transport orchestrator.
type Service struct {
	mu          sync.RWMutex
	rooms       map[string]*roomSession
	nextSubID   atomic.Uint64
	cleanupCtx  context.Context
	cleanupStop context.CancelFunc
}

var (
	singleton     *Service
	singletonOnce sync.Once
)

// GetService returns the process-wide singleton Nostr service.
func GetService() *Service {
	singletonOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		singleton = &Service{
			rooms:       make(map[string]*roomSession),
			cleanupCtx:  ctx,
			cleanupStop: cancel,
		}
		go singleton.cleanupLoop()
	})
	return singleton
}

// StartRoom initializes transport state for a room and starts a non-blocking subscribe loop.
func (s *Service) StartRoom(input RoomConfig) error {
	cfg, policy, err := buildConfig(input)
	if err != nil {
		return err
	}

	s.mu.Lock()
	if existing := s.rooms[cfg.SessionID]; existing != nil {
		existing.touch()
		s.mu.Unlock()
		tss.Logf("[NIP46-TLM][NostrService] room already started room=%s", cfg.SessionID)
		return nil
	}
	s.mu.Unlock()

	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return fmt.Errorf("create room client: %w", err)
	}
	messenger := nostrtransport.NewMessenger(cfg, client)
	if messenger == nil {
		client.Close("messenger init failed")
		return fmt.Errorf("create messenger: nil")
	}
	pump := nostrtransport.NewMessagePump(cfg, client)
	if pump == nil {
		client.Close("message pump init failed")
		return fmt.Errorf("create message pump: nil")
	}

	ctx, cancel := context.WithCancel(context.Background())
	room := &roomSession{
		id:          cfg.SessionID,
		cfg:         cfg,
		policy:      policy,
		ctx:         ctx,
		cancel:      cancel,
		client:      client,
		messenger:   messenger,
		pump:        pump,
		subscribers: make(map[uint64]chan Event),
		seenInbound: make(map[string]int64),
		lastTouch:   time.Now(),
		retryDelay:  policy.ReconnectInitial,
	}
	room.lastEventMs.Store(time.Now().UnixMilli())

	s.mu.Lock()
	s.rooms[cfg.SessionID] = room
	s.mu.Unlock()

	tss.Logf(
		"[NIP46-TLM][NostrService] room started room=%s relays=%d peers=%d reconnectInitialMs=%d reconnectMaxMs=%d heartbeatEveryMs=%d heartbeatTimeoutMs=%d",
		cfg.SessionID,
		len(cfg.Relays),
		len(cfg.PeersNpub),
		policy.ReconnectInitial.Milliseconds(),
		policy.ReconnectMax.Milliseconds(),
		policy.HeartbeatEvery.Milliseconds(),
		policy.HeartbeatTimeout.Milliseconds(),
	)
	go s.runRoomLoop(room)
	go s.runHeartbeatLoop(room)
	return nil
}

// StopRoom closes subscriptions and network resources for a room.
func (s *Service) StopRoom(roomHash string) error {
	roomID := strings.TrimSpace(roomHash)
	if roomID == "" {
		return fmt.Errorf("room hash is required")
	}

	s.mu.Lock()
	room := s.rooms[roomID]
	if room == nil {
		s.mu.Unlock()
		return nil
	}
	delete(s.rooms, roomID)
	s.mu.Unlock()

	s.closeRoom(room, "stop room")
	tss.Logf("[NIP46-TLM][NostrService] room stopped room=%s", roomID)
	return nil
}

// SubscribeToRoom creates a buffered subscription channel for typed room events.
func (s *Service) SubscribeToRoom(roomHash string) (<-chan Event, func(), error) {
	roomID := strings.TrimSpace(roomHash)
	if roomID == "" {
		return nil, nil, fmt.Errorf("room hash is required")
	}

	s.mu.Lock()
	room := s.rooms[roomID]
	if room == nil {
		s.mu.Unlock()
		return nil, nil, fmt.Errorf("room %s is not started", roomID)
	}
	subID := s.nextSubID.Add(1)
	ch := make(chan Event, 64)
	room.subscribers[subID] = ch
	room.touch()
	s.mu.Unlock()

	unsubscribe := func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		r := s.rooms[roomID]
		if r == nil {
			close(ch)
			return
		}
		if existing, ok := r.subscribers[subID]; ok {
			delete(r.subscribers, subID)
			close(existing)
		}
		r.touch()
	}
	return ch, unsubscribe, nil
}

// EnsureRoomSubscription validates that a room exists and marks it as recently used.
func (s *Service) EnsureRoomSubscription(roomHash string) error {
	roomID := strings.TrimSpace(roomHash)
	if roomID == "" {
		return fmt.Errorf("room hash is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	room := s.rooms[roomID]
	if room == nil {
		return fmt.Errorf("room %s is not started", roomID)
	}
	room.touch()
	return nil
}

// PublishMessage sends raw intent payloads to all room peers; encryption/chunking stays in Go.
func (s *Service) PublishMessage(roomHash string, payload interface{}) error {
	roomID := strings.TrimSpace(roomHash)
	if roomID == "" {
		return fmt.Errorf("room hash is required")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	s.mu.RLock()
	room := s.rooms[roomID]
	s.mu.RUnlock()
	if room == nil {
		return fmt.Errorf("room %s is not started", roomID)
	}

	ctx, cancel := context.WithTimeout(room.ctx, room.cfg.MaxTimeout)
	defer cancel()

	targetSigners := extractTargetSigners(body)
	peerTargets := room.cfg.PeersNpub
	if len(targetSigners) > 0 {
		allow := make(map[string]struct{}, len(targetSigners))
		for _, signer := range targetSigners {
			allow[strings.TrimSpace(signer)] = struct{}{}
		}
		filtered := make([]string, 0, len(room.cfg.PeersNpub))
		for _, peer := range room.cfg.PeersNpub {
			if _, ok := allow[strings.TrimSpace(peer)]; ok {
				filtered = append(filtered, peer)
			}
		}
		if len(filtered) > 0 {
			peerTargets = filtered
		}
		tss.Logf("[NIP46-TLM][NostrService] target signer routing room=%s selected=%d peers=%d", roomID, len(filtered), len(room.cfg.PeersNpub))
	}

	if len(peerTargets) == 0 {
		return fmt.Errorf("no target peers available for publish")
	}

	var firstErr error
	successCount := 0
	for _, peer := range peerTargets {
		if err := room.messenger.SendMessage(ctx, room.cfg.LocalNpub, peer, string(body)); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			tss.Logf("[NIP46-TLM][NostrService] publish failed room=%s peer=%s err=%v", roomID, shortRef(peer), err)
			continue
		}
		successCount++
		tss.Logf("[NIP46-TLM][NostrService] published room=%s peer=%s", roomID, shortRef(peer))
	}
	if successCount == 0 && firstErr != nil {
		return firstErr
	}
	if firstErr != nil {
		tss.Logf("[NIP46-TLM][NostrService] partial publish success room=%s success=%d total=%d", roomID, successCount, len(peerTargets))
	}

	s.mu.Lock()
	if current := s.rooms[roomID]; current != nil {
		current.touch()
	}
	s.mu.Unlock()
	return nil
}

func extractTargetSigners(payload []byte) []string {
	trimmed := strings.TrimSpace(string(payload))
	if trimmed == "" {
		return nil
	}

	var root map[string]interface{}
	if err := json.Unmarshal(payload, &root); err != nil {
		return nil
	}

	collect := func(raw interface{}) []string {
		arr, ok := raw.([]interface{})
		if !ok {
			return nil
		}
		out := make([]string, 0, len(arr))
		for _, v := range arr {
			s, ok := v.(string)
			if !ok {
				continue
			}
			t := strings.TrimSpace(s)
			if t == "" {
				continue
			}
			out = append(out, t)
		}
		return out
	}

	if direct := collect(root["targetSigners"]); len(direct) > 0 {
		return direct
	}

	payloadObj, ok := root["payload"].(map[string]interface{})
	if !ok {
		return nil
	}
	if nested := collect(payloadObj["targetSigners"]); len(nested) > 0 {
		return nested
	}
	return nil
}

func (s *Service) runRoomLoop(room *roomSession) {
	for {
		select {
		case <-room.ctx.Done():
			return
		default:
		}

		err := room.pump.Run(room.ctx, func(raw []byte) error {
			if room.shouldDropInbound(raw) {
				tss.Logf("[NIP46-TLM][NostrService] dropped duplicate inbound frame room=%s", room.id)
				return nil
			}
			room.markEventSeen()
			evt := decodeEventPayload(room.id, raw)
			s.broadcast(room.id, evt)
			return nil
		})
		if err != nil {
			if room.ctx.Err() != nil {
				return
			}
			delay := room.nextRetryDelay()
			tss.Logf("[NIP46-TLM][NostrService] room loop error room=%s retryMs=%d err=%v", room.id, delay.Milliseconds(), err)
			s.broadcast(room.id, serviceEvent(
				room.id,
				"ROOM_RECONNECTING",
				map[string]interface{}{
					"retryMs": delay.Milliseconds(),
					"error":   err.Error(),
				},
			))
			time.Sleep(delay)
			continue
		}
		room.markEventSeen()
	}
}

func (s *Service) runHeartbeatLoop(room *roomSession) {
	ticker := time.NewTicker(room.policy.HeartbeatEvery)
	defer ticker.Stop()
	for {
		select {
		case <-room.ctx.Done():
			return
		case <-ticker.C:
			now := time.Now()
			idle := room.idleFor(now)
			stale := idle >= room.policy.HeartbeatTimeout

			s.broadcast(room.id, serviceEvent(
				room.id,
				"ROOM_HEARTBEAT",
				map[string]interface{}{
					"idleMs":             idle.Milliseconds(),
					"heartbeatEveryMs":   room.policy.HeartbeatEvery.Milliseconds(),
					"heartbeatTimeoutMs": room.policy.HeartbeatTimeout.Milliseconds(),
					"stale":              stale,
				},
			))

			if stale {
				wasStale := room.staleState.Swap(1) == 1
				if !wasStale {
					tss.Logf("[NIP46-TLM][NostrService] heartbeat stale room=%s idleMs=%d forcing reconnect", room.id, idle.Milliseconds())
					s.broadcast(room.id, serviceEvent(
						room.id,
						"ROOM_STALE",
						map[string]interface{}{"idleMs": idle.Milliseconds()},
					))
					if room.client != nil {
						room.client.Close("heartbeat timeout")
					}
				}
				continue
			}

			if room.staleState.Swap(0) == 1 {
				tss.Logf("[NIP46-TLM][NostrService] heartbeat recovered room=%s", room.id)
				s.broadcast(room.id, serviceEvent(room.id, "ROOM_RECOVERED", map[string]interface{}{}))
			}
		}
	}
}

func (s *Service) broadcast(roomID string, evt Event) {
	s.mu.RLock()
	room := s.rooms[roomID]
	if room == nil {
		s.mu.RUnlock()
		return
	}
	subs := make([]chan Event, 0, len(room.subscribers))
	for _, ch := range room.subscribers {
		subs = append(subs, ch)
	}
	s.mu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- evt:
		default:
			// Keep transport non-blocking under slow consumers.
		}
	}

	payload, _ := json.Marshal(evt)
	tss.Hook(bridgeEventPrefix + string(payload))

	s.mu.Lock()
	if current := s.rooms[roomID]; current != nil {
		current.touch()
	}
	s.mu.Unlock()
}

func (s *Service) closeRoom(room *roomSession, reason string) {
	room.cancel()
	if room.client != nil {
		room.client.Close(reason)
	}
	for id, ch := range room.subscribers {
		delete(room.subscribers, id)
		close(ch)
	}
}

func (s *Service) cleanupLoop() {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-s.cleanupCtx.Done():
			return
		case <-ticker.C:
			s.evictStaleRooms()
		}
	}
}

func (s *Service) evictStaleRooms() {
	now := time.Now()
	stale := make([]*roomSession, 0)

	s.mu.Lock()
	for roomID, room := range s.rooms {
		if len(room.subscribers) > 0 {
			continue
		}
		if now.Sub(room.lastTouch) < staleRoomTTL {
			continue
		}
		delete(s.rooms, roomID)
		stale = append(stale, room)
	}
	s.mu.Unlock()

	for _, room := range stale {
		s.closeRoom(room, "stale room evicted")
		tss.Logf("[NIP46-TLM][NostrService] stale room evicted room=%s", room.id)
	}
}

func buildConfig(input RoomConfig) (nostrtransport.Config, roomPolicy, error) {
	roomHash := strings.TrimSpace(input.RoomHash)
	if roomHash == "" {
		return nostrtransport.Config{}, roomPolicy{}, fmt.Errorf("room hash is required")
	}
	relays := splitCSV(input.RelaysCSV)
	peers := splitCSV(input.PeersNpubsCSV)
	cfg := nostrtransport.Config{
		Relays:        relays,
		SessionID:     roomHash,
		SessionKeyHex: deriveSessionKeyHex(roomHash),
		LocalNpub:     strings.TrimSpace(input.LocalNpub),
		LocalNsec:     strings.TrimSpace(input.LocalNsec),
		PeersNpub:     peers,
	}
	cfg.ApplyDefaults()
	if err := cfg.Validate(); err != nil {
		return nostrtransport.Config{}, roomPolicy{}, err
	}
	policy := buildRoomPolicy(input.Policy)
	return cfg, policy, nil
}

func buildRoomPolicy(in RoomPolicy) roomPolicy {
	toDuration := func(ms int64, fallback time.Duration) time.Duration {
		if ms <= 0 {
			return fallback
		}
		return time.Duration(ms) * time.Millisecond
	}

	policy := roomPolicy{
		ReconnectInitial: toDuration(in.ReconnectInitialMs, defaultReconnectInitial),
		ReconnectMax:     toDuration(in.ReconnectMaxMs, defaultReconnectMax),
		HeartbeatEvery:   toDuration(in.HeartbeatEveryMs, defaultHeartbeatEvery),
		HeartbeatTimeout: toDuration(in.HeartbeatTimeoutMs, defaultHeartbeatTimeout),
	}
	if policy.ReconnectMax < policy.ReconnectInitial {
		policy.ReconnectMax = policy.ReconnectInitial
	}
	if policy.HeartbeatTimeout < policy.HeartbeatEvery {
		policy.HeartbeatTimeout = policy.HeartbeatEvery * 2
	}
	return policy
}

func splitCSV(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}

func deriveSessionKeyHex(roomHash string) string {
	raw := strings.TrimSpace(roomHash)
	if len(raw) == 64 {
		if _, err := hex.DecodeString(raw); err == nil {
			return strings.ToLower(raw)
		}
	}
	digest := sha256.Sum256([]byte("nostrservice:" + raw))
	return hex.EncodeToString(digest[:])
}

func decodeEventPayload(roomHash string, raw []byte) Event {
	now := time.Now().UnixMilli()
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		trimmed = "{}"
	}

	rawPayload := json.RawMessage(trimmed)
	out := Event{
		RoomHash:   roomHash,
		Type:       "message",
		Payload:    rawPayload,
		ReceivedAt: now,
	}

	var obj map[string]interface{}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return out
	}

	if v, ok := obj["type"].(string); ok && strings.TrimSpace(v) != "" {
		out.Type = strings.TrimSpace(v)
	} else {
		switch {
		case hasAnyKey(obj, "psbtHex", "psbtBase64", "amountSats"):
			out.Type = "COSIGN_REQUEST"
		case hasAnyKey(obj, "approved", "signedPsbtHex", "signedPsbtBase64", "broadcastTxId"):
			out.Type = "COSIGN_RESPONSE"
		case hasAnyKey(obj, "phase"):
			if phase, ok := obj["phase"].(string); ok {
				out.Type = phase
			}
		}
	}

	if txID, ok := obj["txId"].(string); ok {
		out.TxID = strings.TrimSpace(txID)
	}
	if traceID, ok := obj["traceId"].(string); ok {
		out.TraceID = strings.TrimSpace(traceID)
	}
	if senderNpub, ok := obj["senderNpub"].(string); ok {
		out.SenderNpub = strings.TrimSpace(senderNpub)
	}
	return out
}

func hasAnyKey(obj map[string]interface{}, keys ...string) bool {
	for _, key := range keys {
		if _, ok := obj[key]; ok {
			return true
		}
	}
	return false
}

func shortRef(v string) string {
	trimmed := strings.TrimSpace(v)
	if len(trimmed) <= 14 {
		return trimmed
	}
	return trimmed[:8] + "..." + trimmed[len(trimmed)-4:]
}

func serviceEvent(roomHash string, eventType string, payload interface{}) Event {
	raw, err := json.Marshal(payload)
	if err != nil {
		raw = json.RawMessage(`{}`)
	}
	return Event{
		RoomHash:   roomHash,
		Type:       eventType,
		Payload:    raw,
		ReceivedAt: time.Now().UnixMilli(),
	}
}

func inboundDedupeKey(raw []byte) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return ""
	}

	var root map[string]interface{}
	if err := json.Unmarshal(raw, &root); err == nil {
		if id, ok := root["id"].(string); ok && strings.TrimSpace(id) != "" {
			return "env:" + strings.TrimSpace(id)
		}
		if payload, ok := root["payload"].(map[string]interface{}); ok {
			if id, ok := payload["id"].(string); ok && strings.TrimSpace(id) != "" {
				return "payload-env:" + strings.TrimSpace(id)
			}
			if txID, ok := payload["txId"].(string); ok && strings.TrimSpace(txID) != "" {
				trace, _ := payload["traceId"].(string)
				typ, _ := root["type"].(string)
				return fmt.Sprintf("tx:%s:trace:%s:type:%s", strings.TrimSpace(txID), strings.TrimSpace(trace), strings.TrimSpace(typ))
			}
		}
		if txID, ok := root["txId"].(string); ok && strings.TrimSpace(txID) != "" {
			trace, _ := root["traceId"].(string)
			typ, _ := root["type"].(string)
			return fmt.Sprintf("tx:%s:trace:%s:type:%s", strings.TrimSpace(txID), strings.TrimSpace(trace), strings.TrimSpace(typ))
		}
	}

	h := sha256.Sum256([]byte(trimmed))
	return "raw:" + hex.EncodeToString(h[:])
}
