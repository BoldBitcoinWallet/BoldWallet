import {Buffer} from 'buffer';
import {DeviceEventEmitter, EmitterSubscription, NativeModules, Platform} from 'react-native';
import {dbg, getKeyshareMetadata, getNostrRelays} from '../utils';
import {TssProvider, type NostrServiceRoomPolicy} from './TssProvider';
import chatRepository, {
  type ChatThreadStatus,
  type ChatThreadType,
} from './repositories/ChatRepository';

const {BBMTLibNativeModule} = NativeModules;

export type NostrMessageType =
  | 'COSIGN_REQUEST'
  | 'COSIGN_RESPONSE'
  | 'COSIGN_READY'
  | 'MPC_PAYLOAD'
  | 'CHAT_MESSAGE'
  | 'DEVICE_PING';

export interface NostrEnvelope<T = unknown> {
  id: string;
  type: NostrMessageType;
  senderFingerprint: string;
  recipientFingerprint: string;
  timestamp: number;
  payload: T;
}

export interface CoSignRequestPayload {
  txId: string;
  traceId?: string;
  psbtHex: string;
  psbtBase64?: string;
  amountSats: number;
  feeSats: number;
  recipientAddress: string;
  network: 'mainnet' | 'testnet' | 'testnet4';
  requestMode?: 'dkls' | 'psbt';
  utxosJson?: string;
  changeAddress?: string;
  senderDerivationPath?: string;
  senderAddressType?: string;
  signingNpubsCSV?: string;
  targetSigners?: string[];
  requiredSignerCount?: number;
  txTemplateHash?: string;
  utxoSetHash?: string;
}

export interface CoSignResponsePayload {
  txId: string;
  signedPsbtHex?: string;
  signedPsbtBase64?: string;
  approved: boolean;
  reason?: string;
}

export interface CoSignReadyPayload {
  txId: string;
  traceId?: string;
}

export type NostrConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'degraded';

export interface NostrIncomingMessage<T = unknown> {
  envelope: NostrEnvelope<T>;
  senderNpub: string;
  relayUrl: string;
  eventId: string;
}

export interface Nip46Request {
  id: string;
  method: string;
  params: unknown[];
  secret?: string;
}

export interface Nip46Response {
  id: string;
  result?: unknown;
  error?: string;
}

export interface Nip46IncomingRequest {
  request: Nip46Request;
  senderNpub: string;
  senderPubHex: string;
  relayUrl: string;
  eventId: string;
}

export interface Nip46IncomingResponse {
  response: Nip46Response;
  senderNpub: string;
  senderPubHex: string;
  relayUrl: string;
  eventId: string;
}

type NativeServiceEvent = {
  roomHash: string;
  type: string;
  eventId?: string;
  traceId?: string;
  txId?: string;
  senderNpub?: string;
  payload?: unknown;
  receivedAt?: number;
};

type SeenInboundEntry = {
  ts: number;
};

const DEFAULT_RELAYS = [
  'wss://bbw-nostr.xyz',
  'wss://nostr.hifish.org',
  'wss://nostr.mom',
  'wss://relay.damus.io',
  'wss://nos.lol',
];

const CRITICAL_MPC_DEFER_TTL_MS = 45_000;
const PENDING_COSIGN_DEFER_TTL_MS = 90_000;
const SUBSCRIPTION_REFRESH_THROTTLE_MS = 4_000;
const STALE_AUTO_RECOVER_COOLDOWN_MS = 20_000;
const STALE_AUTO_RECOVER_MIN_IDLE_MS = 18_000;
const STALE_AUTO_RECOVER_MIN_PUBLISH_GAP_MS = 5_000;
const STANDARD_HEARTBEAT_TIMEOUT_MS = 30_000;
const MPC_ACTIVE_HEARTBEAT_TIMEOUT_MS = 60_000;
const COSIGN_REQUEST_DEDUP_TTL_MS = 10 * 60_000;
const MAX_COSIGN_REQUEST_DEDUP_KEYS = 4000;

function randomId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseEnvelopePayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object') {
    return payload as Record<string, unknown>;
  }
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {text: payload};
    }
    return {text: payload};
  }
  return {};
}

function threadStatusFromEnvelope(type: NostrMessageType, payload: Record<string, unknown>): ChatThreadStatus {
  const requestId = typeof payload.nip46RequestId === 'string' ? payload.nip46RequestId.trim() : '';
  const txId = typeof payload.txId === 'string' ? payload.txId.trim() : '';
  const hasCoSignContext = !!requestId || !!txId;

  if (type === 'COSIGN_RESPONSE') {
    return payload.approved ? 'approved' : 'closed';
  }
  if (type === 'COSIGN_REQUEST') {
    return 'pending';
  }
  if (hasCoSignContext) {
    return 'pending';
  }
  return 'approved';
}

function threadIdentityForEnvelope(
  type: NostrMessageType,
  payload: Record<string, unknown>,
  senderNpub: string,
  envelopeId: string,
  eventId: string,
): {threadId: string; threadType: ChatThreadType} {
  const requestId = typeof payload.nip46RequestId === 'string' ? payload.nip46RequestId.trim() : '';
  const txId = typeof payload.txId === 'string' ? payload.txId.trim() : '';

  if (type === 'COSIGN_REQUEST' || type === 'COSIGN_RESPONSE' || requestId || txId) {
    if (requestId) return {threadId: `req:${requestId}`, threadType: 'cosign'};
    if (txId) return {threadId: `tx:${txId}`, threadType: 'cosign'};
    if (eventId) return {threadId: `evt:${eventId}`, threadType: 'cosign'};
    return {threadId: `env:${envelopeId}`, threadType: 'cosign'};
  }

  return {
    threadId: `peer:${senderNpub}`,
    threadType: 'direct',
  };
}

function contentFromPayload(payload: Record<string, unknown>, type: NostrMessageType): {
  content: string;
  isPayload: boolean;
} {
  if (type === 'CHAT_MESSAGE' && typeof payload.text === 'string' && payload.text.trim()) {
    return {content: payload.text.trim(), isPayload: false};
  }
  return {content: JSON.stringify(payload), isPayload: true};
}

function shouldPersistEnvelopeType(type: NostrMessageType): boolean {
  return (
    type === 'CHAT_MESSAGE' ||
    type === 'COSIGN_REQUEST' ||
    type === 'COSIGN_RESPONSE'
  );
}

function normalizeMaybeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

class NostrMessagingService {
  private listeners = new Set<(msg: NostrIncomingMessage) => void>();
  private nip46RequestListeners = new Set<(msg: Nip46IncomingRequest) => void>();
  private nip46ResponseListeners = new Set<(msg: Nip46IncomingResponse) => void>();
  private stateListeners = new Set<(state: NostrConnectionState) => void>();
  private connectionState: NostrConnectionState = 'disconnected';
  private connectPromise: Promise<void> | null = null;
  private seenInboundEvents = new Map<string, SeenInboundEntry>();
  private localNpub = '';
  private roomHash = '';
  private peerNpubs: string[] = [];
  private nativeBridgeSubscription?: EmitterSubscription;
  private routedEventSubscription?: EmitterSubscription;
  private mpcStateSubscription?: EmitterSubscription;
  private coSignStatusSubscription?: EmitterSubscription;
  private relays: string[] = [...DEFAULT_RELAYS];
  private reconnectPromise: Promise<void> | null = null;
  private lastReconnectAtMs = 0;
  private lastStaleHeartbeatLogAtMs = 0;
  private activeCriticalMpcTxDeadlinesMs = new Map<string, number>();
  private activePendingCoSignTxDeadlinesMs = new Map<string, number>();
  private lastDeferredRoomStaleLogAtMs = 0;
  private lastSubscriptionRefreshAtMs = new Map<string, number>();
  private lastStaleAutoRecoverAtMs = 0;
  private lastPublishAttemptAtMs = 0;
  private seenCoSignRequestMessageKeys = new Map<string, number>();
  private seenCoSignRequestIntentKeys = new Map<string, number>();
  private coSignRequestMessageKeysByTxId = new Map<string, Set<string>>();
  private coSignRequestIntentKeysByTxId = new Map<string, Set<string>>();
  private currentHeartbeatTimeoutMs = STANDARD_HEARTBEAT_TIMEOUT_MS;

  private pruneCoSignRequestDedupCache(now = Date.now()): void {
    const cutoff = now - COSIGN_REQUEST_DEDUP_TTL_MS;

    for (const [key, ts] of this.seenCoSignRequestMessageKeys.entries()) {
      if (ts < cutoff) {
        this.seenCoSignRequestMessageKeys.delete(key);
      }
    }
    for (const [key, ts] of this.seenCoSignRequestIntentKeys.entries()) {
      if (ts < cutoff) {
        this.seenCoSignRequestIntentKeys.delete(key);
      }
    }

    if (this.seenCoSignRequestMessageKeys.size > MAX_COSIGN_REQUEST_DEDUP_KEYS) {
      const overflow = this.seenCoSignRequestMessageKeys.size - MAX_COSIGN_REQUEST_DEDUP_KEYS;
      let i = 0;
      for (const key of this.seenCoSignRequestMessageKeys.keys()) {
        this.seenCoSignRequestMessageKeys.delete(key);
        i += 1;
        if (i >= overflow) break;
      }
    }
    if (this.seenCoSignRequestIntentKeys.size > MAX_COSIGN_REQUEST_DEDUP_KEYS) {
      const overflow = this.seenCoSignRequestIntentKeys.size - MAX_COSIGN_REQUEST_DEDUP_KEYS;
      let i = 0;
      for (const key of this.seenCoSignRequestIntentKeys.keys()) {
        this.seenCoSignRequestIntentKeys.delete(key);
        i += 1;
        if (i >= overflow) break;
      }
    }
  }

  private rememberCoSignRequestDedupKey(
    txId: string,
    messageKey: string,
    intentKey: string,
    now = Date.now(),
  ): void {
    this.seenCoSignRequestMessageKeys.set(messageKey, now);
    this.seenCoSignRequestIntentKeys.set(intentKey, now);

    const messageSet = this.coSignRequestMessageKeysByTxId.get(txId) || new Set<string>();
    messageSet.add(messageKey);
    this.coSignRequestMessageKeysByTxId.set(txId, messageSet);

    const intentSet = this.coSignRequestIntentKeysByTxId.get(txId) || new Set<string>();
    intentSet.add(intentKey);
    this.coSignRequestIntentKeysByTxId.set(txId, intentSet);
  }

  private cleanupCoSignRequestDedupForTx(txId: string): void {
    const id = String(txId || '').trim();
    if (!id) return;

    const messageSet = this.coSignRequestMessageKeysByTxId.get(id);
    if (messageSet) {
      for (const key of messageSet) {
        this.seenCoSignRequestMessageKeys.delete(key);
      }
      this.coSignRequestMessageKeysByTxId.delete(id);
    }

    const intentSet = this.coSignRequestIntentKeysByTxId.get(id);
    if (intentSet) {
      for (const key of intentSet) {
        this.seenCoSignRequestIntentKeys.delete(key);
      }
      this.coSignRequestIntentKeysByTxId.delete(id);
    }
  }

  private shouldDropDuplicateCoSignRequest(
    envelope: NostrEnvelope,
    payloadObject: Record<string, unknown>,
    event: NativeServiceEvent,
  ): boolean {
    const envelopePayload = parseEnvelopePayload(envelope.payload);
    const txId =
      normalizeMaybeString(envelopePayload.txId) ||
      normalizeMaybeString(payloadObject.txId) ||
      normalizeMaybeString(event.txId);
    if (!txId) {
      return false;
    }

    const traceId =
      normalizeMaybeString(envelopePayload.traceId) ||
      normalizeMaybeString(payloadObject.traceId) ||
      normalizeMaybeString(event.traceId);
    const senderFingerprint =
      normalizeMaybeString(envelope.senderFingerprint) ||
      normalizeMaybeString(payloadObject.senderFingerprint) ||
      normalizeMaybeString(envelopePayload.senderFingerprint) ||
      'unknown';
    const messageKey =
      normalizeMaybeString(event.eventId) ||
      normalizeMaybeString(envelope.id) ||
      `${txId}:${traceId}:msg-fallback`;
    const intentKey = `${txId}:${traceId}:sender:${senderFingerprint}`;

    const now = Date.now();
    this.pruneCoSignRequestDedupCache(now);

    const seenMessageAt = this.seenCoSignRequestMessageKeys.get(messageKey);
    if (seenMessageAt && now - seenMessageAt <= COSIGN_REQUEST_DEDUP_TTL_MS) {
      dbg('[NIP46-TLM][NostrMessaging] dropping duplicate COSIGN_REQUEST by message key', {
        txId,
        traceId: traceId || undefined,
        messageKey,
        ageMs: now - seenMessageAt,
      });
      return true;
    }

    const seenIntentAt = this.seenCoSignRequestIntentKeys.get(intentKey);
    if (seenIntentAt && now - seenIntentAt <= COSIGN_REQUEST_DEDUP_TTL_MS) {
      dbg('[NIP46-TLM][NostrMessaging] dropping duplicate COSIGN_REQUEST by intent key', {
        txId,
        traceId: traceId || undefined,
        intentKey,
        ageMs: now - seenIntentAt,
      });
      return true;
    }

    this.rememberCoSignRequestDedupKey(txId, messageKey, intentKey, now);
    return false;
  }

  private isCriticalMpcInFlight(): boolean {
    const now = Date.now();
    for (const [txId, untilMs] of this.activeCriticalMpcTxDeadlinesMs.entries()) {
      if (untilMs <= now) {
        this.activeCriticalMpcTxDeadlinesMs.delete(txId);
      }
    }
    return this.activeCriticalMpcTxDeadlinesMs.size > 0;
  }

  private isPendingCoSignInFlight(): boolean {
    const now = Date.now();
    for (const [txId, untilMs] of this.activePendingCoSignTxDeadlinesMs.entries()) {
      if (untilMs <= now) {
        this.activePendingCoSignTxDeadlinesMs.delete(txId);
      }
    }
    return this.activePendingCoSignTxDeadlinesMs.size > 0;
  }

  private shouldThrottleSubscriptionRefresh(reason: string): boolean {
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) return false;

    const isBridgeRefresh =
      normalizedReason === 'bridge-legacy-event' ||
      normalizedReason === 'bridge-ready-event';
    if (!isBridgeRefresh) {
      return false;
    }

    if (!this.isPendingCoSignInFlight()) {
      return false;
    }

    const now = Date.now();
    const key = `reason:${normalizedReason}`;
    const last = this.lastSubscriptionRefreshAtMs.get(key) || 0;
    if (now - last < SUBSCRIPTION_REFRESH_THROTTLE_MS) {
      return true;
    }
    this.lastSubscriptionRefreshAtMs.set(key, now);
    return false;
  }

  private desiredHeartbeatTimeoutMs(): number {
    if (this.isCriticalMpcInFlight() || this.isPendingCoSignInFlight()) {
      return MPC_ACTIVE_HEARTBEAT_TIMEOUT_MS;
    }
    return STANDARD_HEARTBEAT_TIMEOUT_MS;
  }

  private refreshDynamicRoomPolicy(reason: string): void {
    const desired = this.desiredHeartbeatTimeoutMs();
    if (desired === this.currentHeartbeatTimeoutMs) {
      return;
    }
    this.currentHeartbeatTimeoutMs = desired;
    dbg('[NIP46-TLM][NostrMessaging] heartbeat timeout policy updated', {
      reason,
      heartbeatTimeoutMs: desired,
      activeCriticalMpcSessions: this.activeCriticalMpcTxDeadlinesMs.size,
      activePendingCoSignSessions: this.activePendingCoSignTxDeadlinesMs.size,
    });

    if (this.connectionState !== 'connected') {
      return;
    }

    const now = Date.now();
    const canRefreshNow =
      !this.isCriticalMpcInFlight() &&
      now - this.lastPublishAttemptAtMs > 2_000;
    if (!canRefreshNow) {
      return;
    }

    // Nostr room policy is applied on service start; reconnect once to apply the
    // new heartbeat timeout without forcing an immediate reconnect race.
    void this.reconnectWithRelayFallback({
      force: false,
      reason: `policy-refresh:${reason}`,
    }).catch(err => {
      dbg('[NIP46-TLM][NostrMessaging] policy refresh reconnect failed', {
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private shouldAutoRecoverStaleRoom(idleMs?: number): boolean {
    if (this.isCriticalMpcInFlight()) {
      return false;
    }

    const now = Date.now();
    if (now - this.lastPublishAttemptAtMs < STALE_AUTO_RECOVER_MIN_PUBLISH_GAP_MS) {
      return false;
    }

    if (now - this.lastStaleAutoRecoverAtMs < STALE_AUTO_RECOVER_COOLDOWN_MS) {
      return false;
    }

    if (typeof idleMs === 'number' && idleMs < STALE_AUTO_RECOVER_MIN_IDLE_MS) {
      return false;
    }

    return true;
  }

  private triggerStaleAutoRecover(reason: string, idleMs?: number): void {
    if (!this.shouldAutoRecoverStaleRoom(idleMs)) {
      return;
    }
    this.lastStaleAutoRecoverAtMs = Date.now();
    dbg('[NIP46-TLM][NostrMessaging] stale room auto-recover triggered', {
      roomHash: this.roomHash,
      reason,
      idleMs,
      activeCriticalMpcSessions: this.activeCriticalMpcTxDeadlinesMs.size,
      activePendingCoSignSessions: this.activePendingCoSignTxDeadlinesMs.size,
    });
    void this.reconnectWithRelayFallback({
      force: false,
      reason: `stale-auto-recover:${reason}`,
    }).catch(err => {
      dbg('[NIP46-TLM][NostrMessaging] stale room auto-recover failed', {
        reason,
        idleMs,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private roomPolicy(): NostrServiceRoomPolicy {
    return {
      reconnectInitialMs: 200,
      reconnectMaxMs: 1200,
      heartbeatEveryMs: 1000,
      heartbeatTimeoutMs: this.currentHeartbeatTimeoutMs,
    };
  }

  getConnectionState(): NostrConnectionState {
    return this.connectionState;
  }

  getLocalNpub(): string {
    return this.localNpub;
  }

  async getOrCreateLocalNpub(): Promise<string> {
    await this.ensureIdentity();
    if (!this.localNpub) {
      throw new Error('Nostr npub unavailable in keyshare metadata');
    }
    return this.localNpub;
  }

  onMessage(listener: (msg: NostrIncomingMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onConnectionStateChange(listener: (state: NostrConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.connectionState);
    return () => this.stateListeners.delete(listener);
  }

  onNip46Request(listener: (msg: Nip46IncomingRequest) => void): () => void {
    this.nip46RequestListeners.add(listener);
    return () => this.nip46RequestListeners.delete(listener);
  }

  onNip46Response(listener: (msg: Nip46IncomingResponse) => void): () => void {
    this.nip46ResponseListeners.add(listener);
    return () => this.nip46ResponseListeners.delete(listener);
  }

  async connect(relays?: string[]): Promise<void> {
    if (this.connectionState === 'connected') {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      this.setConnectionState('connecting');
      await this.ensureIdentity();
      this.attachNativeListeners();

      let nextRelays = relays;
      if (!nextRelays || nextRelays.length === 0) {
        try {
          nextRelays = await getNostrRelays(false);
        } catch {
          nextRelays = DEFAULT_RELAYS;
        }
      }
      this.relays = Array.from(new Set((nextRelays || DEFAULT_RELAYS).map(r => r.trim()).filter(Boolean)));

      const relaysCSV = this.relays.join(',');
      const peersCSV = this.peerNpubs.join(',');
      const policy = this.roomPolicy();

      await TssProvider.nostrServiceStart(
        relaysCSV,
        peersCSV,
        this.roomHash,
        policy,
      );
      await TssProvider.nostrServiceSubscribe(this.roomHash);
      this.setConnectionState('connected');
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async ensureActiveSubscription(reason = 'unspecified'): Promise<void> {
    if (this.shouldThrottleSubscriptionRefresh(reason)) {
      return;
    }
    await this.connect();
    try {
      await TssProvider.nostrServiceSubscribe(this.roomHash);
    } catch (err) {
      if (!this.isRecoverablePublishError(err)) {
        throw err;
      }
      dbg('[NIP46-TLM][NostrMessaging] active subscription refresh failed; reconnecting', {
        reason,
        roomHash: this.roomHash,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.reconnectWithRelayFallback({
        force: true,
        reason: `ensure-active-subscription:${reason}`,
      });
      await TssProvider.nostrServiceSubscribe(this.roomHash);
    }
  }

  disconnect(): void {
    const activeRoom = this.roomHash;
    this.connectPromise = null;
    this.detachNativeListeners();
    this.setConnectionState('disconnected');
    if (activeRoom) {
      void TssProvider.nostrServiceStop(activeRoom).catch(err => {
        dbg('NostrMessaging: nostrServiceStop failed', err);
      });
    }
  }

  async sendEnvelope<T>(recipientNpubOrNpubs: string | string[], envelope: NostrEnvelope<T>): Promise<void> {
    await this.ensureReadyForPublish(recipientNpubOrNpubs);
    await this.ensureHealthyTransportBeforePublish();
    this.persistOutgoingMessage(
      Array.isArray(recipientNpubOrNpubs) ? recipientNpubOrNpubs[0] || '' : recipientNpubOrNpubs,
      envelope,
    );
    try {
      this.lastPublishAttemptAtMs = Date.now();
      await TssProvider.nostrServicePublish(this.roomHash, envelope);
    } catch (err) {
      if (!this.isRecoverablePublishError(err)) {
        throw err;
      }

      dbg('[NIP46-TLM][NostrMessaging] publish failed with recoverable transport error; attempting reconnect and retry', {
        roomHash: this.roomHash,
        reason: err instanceof Error ? err.message : String(err),
      });

      const forceReconnect = this.shouldForceReconnectOnPublishRetry(err);

      await this.reconnectWithRelayFallback({
        force: forceReconnect,
        reason: forceReconnect ? 'publish-retry:force' : 'publish-retry:soft',
      });
      this.lastPublishAttemptAtMs = Date.now();
      await TssProvider.nostrServicePublish(this.roomHash, envelope);
    }
  }

  private shouldForceReconnectOnPublishRetry(err: unknown): boolean {
    const msg = String(err instanceof Error ? err.message : err || '').toLowerCase();
    const severeTransportFailure =
      msg.includes('all relays failed') ||
      msg.includes('pool closed') ||
      msg.includes('failed to connect');

    if (this.isCriticalMpcInFlight()) {
      return false;
    }

    if (this.isPendingCoSignInFlight() && !severeTransportFailure) {
      return false;
    }

    return severeTransportFailure;
  }

  private isRecoverablePublishError(err: unknown): boolean {
    const msg = String(err instanceof Error ? err.message : err || '').toLowerCase();
    if (!msg) return false;
    return (
      msg.includes('heartbeat timeout') ||
      msg.includes('pool closed') ||
      msg.includes('failed to connect') ||
      msg.includes('websocket') ||
      msg.includes('context cancelled') ||
      msg.includes('all relays failed')
    );
  }

  private async reconnectWithRelayFallback(input?: {
    force?: boolean;
    reason?: string;
  }): Promise<void> {
    const force = input?.force === true;
    const reason = input?.reason || 'unspecified';
    const now = Date.now();
    const reconnectCooldownMs = 5000;

    if (this.reconnectPromise) {
      return this.reconnectPromise;
    }

    if (!force && now - this.lastReconnectAtMs < reconnectCooldownMs) {
      dbg('[NIP46-TLM][NostrMessaging] reconnect request skipped by cooldown', {
        roomHash: this.roomHash,
        reason,
        sinceLastReconnectMs: now - this.lastReconnectAtMs,
        reconnectCooldownMs,
      });
      return;
    }

    this.lastReconnectAtMs = now;
    this.reconnectPromise = this.performReconnectWithRelayFallback(reason);
    try {
      await this.reconnectPromise;
    } finally {
      this.reconnectPromise = null;
    }
  }

  private async performReconnectWithRelayFallback(reason: string): Promise<void> {
    await this.ensureIdentity();

    const relayCandidates: string[][] = [];
    const currentRelays = Array.from(new Set(this.relays.map(r => r.trim()).filter(Boolean)));
    if (currentRelays.length > 0) {
      relayCandidates.push(currentRelays);
    }

    try {
      const dynamicRelays = await getNostrRelays(true);
      const filtered: string[] = Array.from(
        new Set(
          (Array.isArray(dynamicRelays) ? dynamicRelays : [])
            .map((r: unknown) => String(r || '').trim())
            .filter((r): r is string => r.length > 0),
        ),
      );
      if (filtered.length > 0) {
        relayCandidates.push(filtered);
      }
    } catch (fetchErr) {
      dbg('[NIP46-TLM][NostrMessaging] failed to fetch dynamic fallback relays', fetchErr);
    }

    const defaultRelays = Array.from(new Set(DEFAULT_RELAYS.map(r => r.trim()).filter(Boolean)));
    if (defaultRelays.length > 0) {
      relayCandidates.push(defaultRelays);
    }

    const normalizedSets = relayCandidates
      .map(set => Array.from(new Set(set.map(r => r.trim()).filter(Boolean))))
      .filter(set => set.length > 0);

    const uniqueSets: string[][] = [];
    const seenSetKeys = new Set<string>();
    for (const set of normalizedSets) {
      const key = set.join(',');
      if (seenSetKeys.has(key)) continue;
      seenSetKeys.add(key);
      uniqueSets.push(set);
    }

    if (uniqueSets.length === 0) {
      throw new Error('No relay sets available for reconnect fallback');
    }

    this.setConnectionState('connecting');
    const peersCSV = this.peerNpubs.join(',');
    const policy = this.roomPolicy();
    const failures: string[] = [];

    for (const relaySet of uniqueSets) {
      const relaysCSV = relaySet.join(',');
      try {
        await TssProvider.nostrServiceStop(this.roomHash).catch(() => undefined);
        await TssProvider.nostrServiceStart(relaysCSV, peersCSV, this.roomHash, policy);
        await TssProvider.nostrServiceSubscribe(this.roomHash);
        this.relays = relaySet;
        this.setConnectionState('connected');
        dbg('[NIP46-TLM][NostrMessaging] reconnect fallback succeeded', {
          roomHash: this.roomHash,
          reason,
          relays: relaySet,
        });
        return;
      } catch (reconnectErr) {
        const attemptReason = reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr);
        failures.push(`${relaysCSV} => ${attemptReason}`);
        dbg('[NIP46-TLM][NostrMessaging] reconnect fallback attempt failed', {
          roomHash: this.roomHash,
          relays: relaySet,
          reason: attemptReason,
        });
      }
    }

    this.setConnectionState('degraded');
    throw new Error(`Unable to reconnect Nostr service after publish failure: ${failures.join(' | ')}`);
  }

  async sendCoSignRequest(
    recipientNpub: string,
    senderFingerprint: string,
    recipientFingerprint: string,
    payload: CoSignRequestPayload,
  ): Promise<void> {
    const envelope: NostrEnvelope<CoSignRequestPayload> = {
      id: randomId(),
      type: 'COSIGN_REQUEST',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
    };
    await this.sendEnvelope(recipientNpub, envelope);
  }

  async sendCoSignRequestToMany(
    recipientNpubs: string[],
    senderFingerprint: string,
    recipientFingerprint: string,
    payload: CoSignRequestPayload,
  ): Promise<void> {
    const envelope: NostrEnvelope<CoSignRequestPayload> = {
      id: randomId(),
      type: 'COSIGN_REQUEST',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
    };
    await this.sendEnvelope(recipientNpubs, envelope);
  }

  async sendCoSignResponse(
    recipientNpub: string,
    senderFingerprint: string,
    recipientFingerprint: string,
    payload: CoSignResponsePayload,
  ): Promise<void> {
    const envelope: NostrEnvelope<CoSignResponsePayload> = {
      id: randomId(),
      type: 'COSIGN_RESPONSE',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
    };
    await this.sendEnvelope(recipientNpub, envelope);
  }

  async sendCoSignReady(
    recipientNpub: string,
    senderFingerprint: string,
    recipientFingerprint: string,
    payload: CoSignReadyPayload,
  ): Promise<void> {
    await this.sendEnvelope(recipientNpub, {
      id: randomId(),
      type: 'COSIGN_READY',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
    });
  }

  async sendNip46Response(recipientNpub: string, response: Nip46Response): Promise<void> {
    await this.sendEnvelope(recipientNpub, {
      id: randomId(),
      type: 'CHAT_MESSAGE',
      senderFingerprint: 'nip46-signer',
      recipientFingerprint: 'nip46-client',
      timestamp: Date.now(),
      payload: response,
    });
  }

  psbtBase64ToHex(psbtBase64: string): string {
    return Buffer.from(psbtBase64, 'base64').toString('hex');
  }

  psbtHexToBase64(psbtHex: string): string {
    return Buffer.from(psbtHex, 'hex').toString('base64');
  }

  private setConnectionState(next: NostrConnectionState): void {
    if (this.connectionState === next) return;
    this.connectionState = next;
    for (const listener of this.stateListeners) listener(next);
  }

  private attachNativeListeners(): void {
    if (!this.nativeBridgeSubscription) {
      const channel = Platform.OS === 'android' ? 'BBMT_DROID' : 'BBMT_APPLE';
      this.nativeBridgeSubscription = DeviceEventEmitter.addListener(channel, (event: any) => {
        const tag = typeof event?.tag === 'string' ? event.tag : '';
        if (tag !== 'NostrServiceEvent') return;
        const message = typeof event?.message === 'string' ? event.message : '';
        if (!message) return;
        try {
          const parsed = JSON.parse(message) as NativeServiceEvent;
          this.consumeServiceEvent(parsed, 'native');
        } catch (err) {
          dbg('NostrMessaging: failed to parse native service event', err);
        }
      });
    }

    if (!this.routedEventSubscription) {
      this.routedEventSubscription = DeviceEventEmitter.addListener('nostr-service:event', (event: NativeServiceEvent) => {
        this.consumeServiceEvent(event, 'routed');
      });
    }

    if (!this.mpcStateSubscription) {
      this.mpcStateSubscription = DeviceEventEmitter.addListener(
        'nostr-mpc:state',
        (event: any) => {
          const txId =
            typeof event?.txId === 'string' ? event.txId.trim() : '';
          const state =
            typeof event?.state === 'string' ? event.state.trim() : '';
          if (!txId) return;

          const isCritical =
            state === 'awaiting_peer' ||
            state === 'computing_nonces' ||
            state === 'signing' ||
            state === 'broadcasting';
          if (isCritical) {
            this.activeCriticalMpcTxDeadlinesMs.set(
              txId,
              Date.now() + CRITICAL_MPC_DEFER_TTL_MS,
            );
            this.refreshDynamicRoomPolicy(`mpc-state:${state}`);
            return;
          }

          if (state === 'completed' || state === 'failed') {
            this.cleanupCoSignRequestDedupForTx(txId);
          }

          this.activeCriticalMpcTxDeadlinesMs.delete(txId);
          this.refreshDynamicRoomPolicy(`mpc-state:${state}`);
        },
      );
    }

    if (!this.coSignStatusSubscription) {
      this.coSignStatusSubscription = DeviceEventEmitter.addListener(
        'nostr-cosign:status',
        (event: any) => {
          const txId =
            typeof event?.txId === 'string' ? event.txId.trim() : '';
          const status =
            typeof event?.status === 'string' ? event.status.trim() : '';
          if (!txId) return;

          if (status === 'pending' || status === 'signing') {
            this.activePendingCoSignTxDeadlinesMs.set(
              txId,
              Date.now() + PENDING_COSIGN_DEFER_TTL_MS,
            );
            this.refreshDynamicRoomPolicy(`cosign-status:${status}`);
            return;
          }

          if (
            status === 'signed' ||
            status === 'broadcasted' ||
            status === 'rejected'
          ) {
            this.activePendingCoSignTxDeadlinesMs.delete(txId);
            this.cleanupCoSignRequestDedupForTx(txId);
            this.refreshDynamicRoomPolicy(`cosign-status:${status}`);
          }
        },
      );
    }
  }

  private detachNativeListeners(): void {
    this.nativeBridgeSubscription?.remove();
    this.routedEventSubscription?.remove();
    this.mpcStateSubscription?.remove();
    this.coSignStatusSubscription?.remove();
    this.nativeBridgeSubscription = undefined;
    this.routedEventSubscription = undefined;
    this.mpcStateSubscription = undefined;
    this.coSignStatusSubscription = undefined;
    this.activeCriticalMpcTxDeadlinesMs.clear();
    this.activePendingCoSignTxDeadlinesMs.clear();
    this.lastSubscriptionRefreshAtMs.clear();
    this.seenCoSignRequestMessageKeys.clear();
    this.seenCoSignRequestIntentKeys.clear();
    this.coSignRequestMessageKeysByTxId.clear();
    this.coSignRequestIntentKeysByTxId.clear();
    this.currentHeartbeatTimeoutMs = STANDARD_HEARTBEAT_TIMEOUT_MS;
  }

  private async ensureIdentity(): Promise<void> {
    if (this.localNpub && this.roomHash && this.peerNpubs.length > 0) {
      return;
    }

    const prepJson = await BBMTLibNativeModule.getKeyshareNostrPrepJSON();
    const prep = JSON.parse(prepJson || '{}') as {
      nostr_npub?: string;
      keygen_committee_keys?: unknown;
    };
    const localNpub = typeof prep.nostr_npub === 'string' ? prep.nostr_npub.trim() : '';

    const meta = await getKeyshareMetadata();
    const committeeFromMetaSource =
      (meta as {nostr_committee_npubs?: unknown} | null | undefined)
        ?.nostr_committee_npubs;
    const committeeFromMeta = Array.isArray(committeeFromMetaSource)
      ? committeeFromMetaSource.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
    const committeeFromPrep = Array.isArray(prep.keygen_committee_keys)
      ? prep.keygen_committee_keys.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];

    const committee = Array.from(new Set([...committeeFromMeta, ...committeeFromPrep, localNpub])).filter(Boolean).sort();
    if (!localNpub) {
      throw new Error('Nostr identity unavailable: nostr_npub missing in keyshare prep');
    }

    const peers = committee.filter(npub => npub !== localNpub);
    if (peers.length === 0) {
      throw new Error('Nostr peers unavailable in keyshare metadata');
    }

    const roomSeed = `nostrservice:room:${committee.join(',')}`;
    const roomHash = await BBMTLibNativeModule.sha256(roomSeed);

    this.localNpub = localNpub;
    this.peerNpubs = peers;
    this.roomHash = String(roomHash || '').trim();
    if (!this.roomHash) {
      throw new Error('Failed to derive nostr room hash');
    }
  }

  private async ensureReadyForPublish(recipientNpubOrNpubs: string | string[]): Promise<void> {
    await this.connect();
    const recipients = Array.from(
      new Set(
        (Array.isArray(recipientNpubOrNpubs)
          ? recipientNpubOrNpubs
          : [recipientNpubOrNpubs])
          .map(v => String(v || '').trim())
          .filter(Boolean),
      ),
    );
    if (recipients.length === 0) {
      throw new Error('No valid Nostr recipients provided');
    }
  }

  private async ensureHealthyTransportBeforePublish(): Promise<void> {
    if (this.connectionState === 'degraded') {
      dbg('[NIP46-TLM][NostrMessaging] pre-publish health check detected degraded state; reconnecting');
      await this.reconnectWithRelayFallback({
        force: true,
        reason: 'pre-publish-degraded',
      });
      return;
    }

    // Lightweight preflight probe: if room subscription validation fails,
    // recover before attempting to publish payload chunks.
    try {
      await TssProvider.nostrServiceSubscribe(this.roomHash);
    } catch (probeErr) {
      if (!this.isRecoverablePublishError(probeErr)) {
        throw probeErr;
      }
      dbg('[NIP46-TLM][NostrMessaging] pre-publish subscription probe failed; reconnecting with relay fallback', {
        roomHash: this.roomHash,
        reason: probeErr instanceof Error ? probeErr.message : String(probeErr),
      });
      await this.reconnectWithRelayFallback({
        force: true,
        reason: 'pre-publish-probe-failed',
      });
    }
  }

  private consumeServiceEvent(event: NativeServiceEvent, source: 'native' | 'routed'): void {
    if (!event || typeof event !== 'object') return;

    if (this.roomHash && typeof event.roomHash === 'string' && event.roomHash.trim() !== this.roomHash) {
      return;
    }

    const eventType = typeof event.type === 'string' ? event.type.trim() : '';
    if (!eventType) return;

    if (eventType === 'ROOM_RECONNECTING') {
      this.setConnectionState('connecting');
      return;
    }
    if (eventType === 'ROOM_HEARTBEAT') {
      const payload = event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : {};
      const stale = payload.stale === true;
      this.setConnectionState(stale ? 'degraded' : 'connected');
      if (stale) {
        const idleMs =
          typeof payload.idleMs === 'number' ? payload.idleMs : undefined;
        this.triggerStaleAutoRecover('heartbeat', idleMs);
        const now = Date.now();
        if (now - this.lastStaleHeartbeatLogAtMs > 10000) {
          this.lastStaleHeartbeatLogAtMs = now;
          dbg('[NIP46-TLM][NostrMessaging] stale heartbeat observed; deferring reconnect until publish/probe failure', {
            roomHash: this.roomHash,
            idleMs,
            heartbeatTimeoutMs:
              typeof payload.heartbeatTimeoutMs === 'number'
                ? payload.heartbeatTimeoutMs
                : undefined,
          });
        }
      }
      return;
    }
    if (eventType === 'ROOM_RECOVERED') {
      this.setConnectionState('connected');
      return;
    }
    if (eventType === 'ROOM_STALE') {
      this.setConnectionState('degraded');
      const payload =
        event.payload && typeof event.payload === 'object'
          ? (event.payload as Record<string, unknown>)
          : {};
      const idleMs =
        typeof payload.idleMs === 'number' ? payload.idleMs : undefined;

      if (this.isCriticalMpcInFlight()) {
        const now = Date.now();
        if (now - this.lastDeferredRoomStaleLogAtMs > 3000) {
          this.lastDeferredRoomStaleLogAtMs = now;
          dbg(
            '[NIP46-TLM][NostrMessaging] ROOM_STALE observed during active MPC; deferring reconnect to avoid transport desync',
            {
              roomHash: this.roomHash,
              idleMs,
              activeMpcSessions: this.activeCriticalMpcTxDeadlinesMs.size,
            },
          );
        }
        return;
      }
      this.triggerStaleAutoRecover('room-stale', idleMs);
      const now = Date.now();
      if (now - this.lastDeferredRoomStaleLogAtMs > 3000) {
        this.lastDeferredRoomStaleLogAtMs = now;
        dbg(
          '[NIP46-TLM][NostrMessaging] ROOM_STALE observed while idle; keeping room degraded and deferring reconnect until publish/probe failure',
          {
            roomHash: this.roomHash,
            idleMs,
          },
        );
      }
      return;
    }

    if (
      eventType !== 'COSIGN_REQUEST' &&
      eventType !== 'COSIGN_RESPONSE' &&
      eventType !== 'COSIGN_READY' &&
      eventType !== 'CHAT_MESSAGE' &&
      eventType !== 'MPC_PAYLOAD'
    ) {
      return;
    }

    const payloadObject = event.payload && typeof event.payload === 'object'
      ? (event.payload as Record<string, unknown>)
      : {};

    const envelope = this.coerceEnvelope(eventType as NostrMessageType, payloadObject, event);
    if (eventType === 'COSIGN_REQUEST') {
      if (this.shouldDropDuplicateCoSignRequest(envelope, payloadObject, event)) {
        return;
      }
    }
    const resolvedSenderNpub = this.resolveSenderNpub(event, payloadObject, envelope);
    const stableEventId = this.buildStableInboundEventId(event, envelope, payloadObject, eventType);
    const semanticEventId = this.buildSemanticInboundEventId(
      event,
      envelope,
      payloadObject,
      eventType,
      resolvedSenderNpub,
    );
    if (this.shouldDropInboundEvent(stableEventId, semanticEventId)) {
      return;
    }
    const msg: NostrIncomingMessage = {
      envelope,
      senderNpub: resolvedSenderNpub,
      relayUrl: source,
      eventId: semanticEventId || stableEventId,
    };

    this.persistIncomingMessage(msg);

    if (envelope.type === 'CHAT_MESSAGE') {
      const p = parseEnvelopePayload(envelope.payload);
      if (typeof p.method === 'string' && typeof p.id === 'string') {
        const request: Nip46Request = {
          id: p.id,
          method: p.method,
          params: Array.isArray(p.params) ? p.params : [],
          ...(typeof p.secret === 'string' ? {secret: p.secret} : {}),
        };
        for (const listener of this.nip46RequestListeners) {
          listener({request, senderNpub: msg.senderNpub, senderPubHex: '', relayUrl: msg.relayUrl, eventId: msg.eventId});
        }
      } else if (typeof p.id === 'string' && ('result' in p || 'error' in p)) {
        const response: Nip46Response = {
          id: p.id,
          ...(Object.prototype.hasOwnProperty.call(p, 'result') ? {result: p.result} : {}),
          ...(typeof p.error === 'string' ? {error: p.error} : {}),
        };
        for (const listener of this.nip46ResponseListeners) {
          listener({response, senderNpub: msg.senderNpub, senderPubHex: '', relayUrl: msg.relayUrl, eventId: msg.eventId});
        }
      }
    }

    for (const listener of this.listeners) {
      listener(msg);
    }
  }

  private resolveSenderNpub(
    event: NativeServiceEvent,
    payloadObject: Record<string, unknown>,
    envelope: NostrEnvelope,
  ): string {
    const directSender = normalizeMaybeString(event.senderNpub);
    if (directSender) {
      return directSender;
    }

    const envelopeSender = normalizeMaybeString((envelope as any).senderNpub);
    if (envelopeSender) {
      return envelopeSender;
    }

    const payloadSender = normalizeMaybeString(payloadObject.senderNpub);
    if (payloadSender) {
      return payloadSender;
    }

    const nestedPayload =
      envelope.payload && typeof envelope.payload === 'object'
        ? (envelope.payload as Record<string, unknown>)
        : {};
    const nestedSender = normalizeMaybeString(nestedPayload.senderNpub);
    if (nestedSender) {
      return nestedSender;
    }

    const fingerprintCandidates = [
      normalizeMaybeString(payloadObject.senderFingerprint),
      normalizeMaybeString((envelope as any).senderFingerprint),
      normalizeMaybeString(nestedPayload.senderFingerprint),
    ].filter(Boolean);

    for (const candidate of fingerprintCandidates) {
      const resolved = this.resolveKnownNpubFromFingerprint(candidate);
      if (resolved) {
        return resolved;
      }
    }

    return '';
  }

  private resolveKnownNpubFromFingerprint(fingerprint: string): string {
    const normalized = normalizeMaybeString(fingerprint);
    if (!normalized || normalized === 'native') {
      return '';
    }

    if (normalized.startsWith('npub1')) {
      return normalized;
    }

    const knownNpubs = Array.from(
      new Set([this.localNpub, ...this.peerNpubs].map(v => String(v || '').trim()).filter(Boolean)),
    );
    for (const npub of knownNpubs) {
      if (npub === normalized) {
        return npub;
      }
      if (
        normalized.length >= 8 &&
        npub.startsWith(normalized.slice(0, 4)) &&
        npub.endsWith(normalized.slice(-4))
      ) {
        return npub;
      }
    }

    return '';
  }

  private buildStableInboundEventId(
    event: NativeServiceEvent,
    envelope: NostrEnvelope,
    payloadObject: Record<string, unknown>,
    eventType: string,
  ): string {
    const room = String(event.roomHash || this.roomHash || 'room').trim();
    const envelopeId = String(envelope.id || '').trim();
    const txId =
      typeof payloadObject.txId === 'string'
        ? payloadObject.txId.trim()
        : typeof event.txId === 'string'
        ? event.txId.trim()
        : '';
    const traceId =
      typeof payloadObject.traceId === 'string'
        ? payloadObject.traceId.trim()
        : typeof event.traceId === 'string'
        ? event.traceId.trim()
        : '';
    const sender = String(event.senderNpub || '').trim();

    if (event.eventId && String(event.eventId).trim()) {
      return `${room}:evt:${String(event.eventId).trim()}`;
    }
    if (envelopeId) {
      return `${room}:env:${envelopeId}`;
    }
    if (txId) {
      return `${room}:tx:${txId}:trace:${traceId}:type:${eventType}:sender:${sender}`;
    }

    return `${room}:fallback:${eventType}:${sender}:${JSON.stringify(payloadObject)}`;
  }

  private buildSemanticInboundEventId(
    event: NativeServiceEvent,
    envelope: NostrEnvelope,
    payloadObject: Record<string, unknown>,
    eventType: string,
    resolvedSenderNpub: string,
  ): string {
    if (
      eventType !== 'COSIGN_REQUEST' &&
      eventType !== 'COSIGN_RESPONSE' &&
      eventType !== 'COSIGN_READY' &&
      eventType !== 'MPC_PAYLOAD'
    ) {
      return '';
    }

    const room = String(event.roomHash || this.roomHash || 'room').trim();
    const envelopePayload = parseEnvelopePayload(envelope.payload);
    const txId =
      typeof envelopePayload.txId === 'string'
        ? envelopePayload.txId.trim()
        : typeof payloadObject.txId === 'string'
        ? payloadObject.txId.trim()
        : typeof event.txId === 'string'
        ? event.txId.trim()
        : '';
    if (!txId) {
      return '';
    }
    const traceId =
      typeof envelopePayload.traceId === 'string'
        ? envelopePayload.traceId.trim()
        : typeof payloadObject.traceId === 'string'
        ? payloadObject.traceId.trim()
        : typeof event.traceId === 'string'
        ? event.traceId.trim()
        : '';
    const senderFingerprint =
      normalizeMaybeString(envelope.senderFingerprint) ||
      normalizeMaybeString((envelopePayload as any).senderFingerprint) ||
      normalizeMaybeString(payloadObject.senderFingerprint) ||
      'unknown';
    const senderIdentity = String(resolvedSenderNpub || '').trim() || senderFingerprint;
    const approvalKey =
      eventType === 'COSIGN_RESPONSE'
        ? `:approved:${String((envelopePayload as any).approved === true)}`
        : '';

    return `${room}:semantic:type:${eventType}:tx:${txId}:trace:${traceId}:sender:${senderIdentity}${approvalKey}`;
  }

  private shouldDropInboundEvent(stableEventId: string, semanticEventId?: string): boolean {
    const keys = [semanticEventId, stableEventId]
      .map(v => String(v || '').trim())
      .filter(Boolean);
    if (keys.length === 0) return false;

    const now = Date.now();
    const hasCoSignSemantic = keys.some(
      key =>
        key.includes('semantic:type:COSIGN_REQUEST') ||
        key.includes('semantic:type:COSIGN_RESPONSE') ||
        key.includes('semantic:type:COSIGN_READY'),
    );
    const ttlMs = hasCoSignSemantic ? 5 * 60_000 : 12_000;

    for (const key of keys) {
      const prev = this.seenInboundEvents.get(key);
      if (prev && now - prev.ts <= ttlMs) {
        return true;
      }
    }

    for (const key of keys) {
      this.seenInboundEvents.set(key, {ts: now});
    }

    if (this.seenInboundEvents.size > 4000) {
      const cutoff = now - ttlMs;
      for (const [id, entry] of this.seenInboundEvents.entries()) {
        if (entry.ts < cutoff) {
          this.seenInboundEvents.delete(id);
        }
      }
      if (this.seenInboundEvents.size > 4000) {
        this.seenInboundEvents.clear();
        for (const key of keys) {
          this.seenInboundEvents.set(key, {ts: now});
        }
      }
    }

    return false;
  }

  private coerceEnvelope(
    fallbackType: NostrMessageType,
    payloadObject: Record<string, unknown>,
    event: NativeServiceEvent,
  ): NostrEnvelope {
    const looksLikeEnvelope =
      typeof payloadObject.id === 'string' &&
      typeof payloadObject.type === 'string' &&
      Object.prototype.hasOwnProperty.call(payloadObject, 'payload');

    if (looksLikeEnvelope) {
      const candidateType = String(payloadObject.type || fallbackType) as NostrMessageType;
      return {
        id: String(payloadObject.id || randomId()),
        type: candidateType,
        senderFingerprint: typeof payloadObject.senderFingerprint === 'string' ? payloadObject.senderFingerprint : 'native',
        recipientFingerprint:
          typeof payloadObject.recipientFingerprint === 'string' ? payloadObject.recipientFingerprint : 'native',
        timestamp:
          typeof payloadObject.timestamp === 'number' ? payloadObject.timestamp : Number(event.receivedAt || Date.now()),
        payload: payloadObject.payload,
      };
    }

    return {
      id: randomId(),
      type: fallbackType,
      senderFingerprint: 'native',
      recipientFingerprint: 'native',
      timestamp: Number(event.receivedAt || Date.now()),
      payload: payloadObject,
    };
  }

  private persistIncomingMessage(msg: NostrIncomingMessage): void {
    try {
      if (!shouldPersistEnvelopeType(msg.envelope.type)) {
        return;
      }
      const now = Date.now();
      const payload = parseEnvelopePayload(msg.envelope.payload);
      const thread = threadIdentityForEnvelope(
        msg.envelope.type,
        payload,
        msg.senderNpub,
        String(msg.envelope.id || ''),
        String(msg.eventId || ''),
      );
      const status = threadStatusFromEnvelope(msg.envelope.type, payload);
      const timestamp = Number(msg.envelope.timestamp || now);
      const {content, isPayload} = contentFromPayload(payload, msg.envelope.type);
      const messageId = msg.eventId
        ? `nostr:${msg.eventId}`
        : `envelope:${msg.envelope.id}:${timestamp}`;

      chatRepository.upsertThreadAndMessage(
        {
          threadId: thread.threadId,
          peerNpub: msg.senderNpub || 'unknown',
          threadType: thread.threadType,
          status,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          messageId,
          threadId: thread.threadId,
          senderNpub: msg.senderNpub || 'unknown',
          content,
          timestamp,
          isPayload,
          isRead: false,
        },
      );
    } catch (err) {
      dbg('NostrMessaging: persistIncomingMessage failed', err);
    }
  }

  private persistOutgoingMessage<T>(recipientNpub: string, envelope: NostrEnvelope<T>): void {
    try {
      if (!shouldPersistEnvelopeType(envelope.type)) {
        return;
      }
      const now = Date.now();
      const payload = parseEnvelopePayload(envelope.payload);
      const thread = threadIdentityForEnvelope(
        envelope.type,
        payload,
        recipientNpub,
        String(envelope.id || ''),
        '',
      );
      const status = threadStatusFromEnvelope(envelope.type, payload);
      const timestamp = Number(envelope.timestamp || now);
      const {content, isPayload} = contentFromPayload(payload, envelope.type);
      const messageId = `local:${String(envelope.id || `${timestamp}`)}`;

      chatRepository.upsertThreadAndMessage(
        {
          threadId: thread.threadId,
          peerNpub: recipientNpub || 'unknown',
          threadType: thread.threadType,
          status,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          messageId,
          threadId: thread.threadId,
          senderNpub: this.localNpub || 'local',
          content,
          timestamp,
          isPayload,
          isRead: true,
        },
      );
    } catch (err) {
      dbg('NostrMessaging: persistOutgoingMessage failed', err);
    }
  }
}

export const nostrMessaging = new NostrMessagingService();
