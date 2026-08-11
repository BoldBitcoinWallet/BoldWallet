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
  traceId?: string;
  txId?: string;
  senderNpub?: string;
  payload?: unknown;
  receivedAt?: number;
};

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

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

class NostrMessagingService {
  private listeners = new Set<(msg: NostrIncomingMessage) => void>();
  private nip46RequestListeners = new Set<(msg: Nip46IncomingRequest) => void>();
  private nip46ResponseListeners = new Set<(msg: Nip46IncomingResponse) => void>();
  private stateListeners = new Set<(state: NostrConnectionState) => void>();
  private connectionState: NostrConnectionState = 'disconnected';
  private localNpub = '';
  private roomHash = '';
  private peerNpubs: string[] = [];
  private nativeBridgeSubscription?: EmitterSubscription;
  private routedEventSubscription?: EmitterSubscription;
  private relays: string[] = [...DEFAULT_RELAYS];

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

    const policy: NostrServiceRoomPolicy = {
      reconnectInitialMs: 500,
      reconnectMaxMs: 5000,
      heartbeatEveryMs: 10000,
      heartbeatTimeoutMs: 45000,
    };

    await TssProvider.nostrServiceStart(
      relaysCSV,
      peersCSV,
      this.roomHash,
      policy,
    );
    await TssProvider.nostrServiceSubscribe(this.roomHash);
    this.setConnectionState('connected');
  }

  disconnect(): void {
    const activeRoom = this.roomHash;
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
    this.persistOutgoingMessage(
      Array.isArray(recipientNpubOrNpubs) ? recipientNpubOrNpubs[0] || '' : recipientNpubOrNpubs,
      envelope,
    );
    await TssProvider.nostrServicePublish(this.roomHash, envelope);
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
  }

  private detachNativeListeners(): void {
    this.nativeBridgeSubscription?.remove();
    this.routedEventSubscription?.remove();
    this.nativeBridgeSubscription = undefined;
    this.routedEventSubscription = undefined;
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
    const committeeFromMeta = Array.isArray(meta?.nostr_committee_npubs)
      ? meta.nostr_committee_npubs.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
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
    if (eventType === 'ROOM_HEARTBEAT' || eventType === 'ROOM_RECOVERED') {
      this.setConnectionState('connected');
      return;
    }
    if (eventType === 'ROOM_STALE') {
      this.setConnectionState('degraded');
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
    const msg: NostrIncomingMessage = {
      envelope,
      senderNpub: event.senderNpub || '',
      relayUrl: source,
      eventId: `${event.roomHash || 'room'}:${String(event.receivedAt || Date.now())}:${eventType}`,
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
