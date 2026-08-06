import { Buffer } from 'buffer';
import { NativeModules } from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import { dbg, getKeyshareMetadata, getNostrRelays } from '../utils';
import chatRepository, {
  type ChatThreadStatus,
  type ChatThreadType,
} from './repositories/ChatRepository';

const { BBMTLibNativeModule } = NativeModules;

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
  // Explicit sender intent, in addition to the implicit signal of psbtHex being
  // empty/populated: 'dkls' = native MPC send, 'psbt' = external PSBT co-sign/export.
  requestMode?: 'dkls' | 'psbt';
  // Optional context for native DKLS send so responders can reconstruct the same
  // transaction inputs/outputs without relying on local UTXO refresh timing.
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

/** Sent by the responding device the instant it commits to entering the native TSS
 * wait loop, so the waiting initiator wakes up and joins at (roughly) the same time. */
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

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];
const KEY_TAG = 'bold-cosign-v1';
const NIP46_TAG = 'bold-nip46-v1';
const FALLBACK_NSEC_KEY = 'nostr_fallback_nsec';
const FALLBACK_NPUB_KEY = 'nostr_fallback_npub';
const MAX_RECENT_EVENT_IDS = 1000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nip19DecodedDataToHex(data: unknown): string {
  if (typeof data === 'string') {
    const s = data.trim();
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
      return s.toLowerCase();
    }
  }

  if (data instanceof Uint8Array) {
    return bytesToHex(data);
  }

  if (Array.isArray(data) && data.every(v => typeof v === 'number')) {
    return bytesToHex(Uint8Array.from(data));
  }

  throw new Error(`Unsupported nip19 decoded key payload type: ${typeof data}`);
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
      return { text: payload };
    }
    return { text: payload };
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
  // Chat messages linked to an existing co-sign thread must not implicitly
  // transition that thread to "approved".
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
): { threadId: string; threadType: ChatThreadType } {
  const requestId = typeof payload.nip46RequestId === 'string' ? payload.nip46RequestId.trim() : '';
  const txId = typeof payload.txId === 'string' ? payload.txId.trim() : '';

  if (type === 'COSIGN_REQUEST' || type === 'COSIGN_RESPONSE' || requestId || txId) {
    if (requestId) return { threadId: `req:${requestId}`, threadType: 'cosign' };
    if (txId) return { threadId: `tx:${txId}`, threadType: 'cosign' };
    if (eventId) return { threadId: `evt:${eventId}`, threadType: 'cosign' };
    return { threadId: `env:${envelopeId}`, threadType: 'cosign' };
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
    return { content: payload.text.trim(), isPayload: false };
  }
  return { content: JSON.stringify(payload), isPayload: true };
}

function shouldPersistEnvelopeType(type: NostrMessageType): boolean {
  return (
    type === 'CHAT_MESSAGE' ||
    type === 'COSIGN_REQUEST' ||
    type === 'COSIGN_RESPONSE'
  );
}

function coordinationTagsFromEnvelope<T>(
  envelope: NostrEnvelope<T>,
): string[][] {
  const tags: string[][] = [];
  const payload =
    envelope.payload && typeof envelope.payload === 'object'
      ? (envelope.payload as Record<string, unknown>)
      : null;
  if (!payload) return tags;

  const txId = typeof payload.txId === 'string' ? payload.txId.trim() : '';
  const traceId =
    typeof payload.traceId === 'string' ? payload.traceId.trim() : '';
  const reqId =
    typeof payload.nip46RequestId === 'string'
      ? payload.nip46RequestId.trim()
      : '';

  if (txId) tags.push(['txid', txId]);
  if (traceId) tags.push(['trace', traceId]);
  if (reqId) tags.push(['req', reqId]);
  return tags;
}

class NostrMessagingService {
  private tools: any | null = null;
  private sockets = new Map<string, WebSocket>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private subscriptions = new Map<string, { filter: any; handler: (event: any, relayUrl: string) => void }>();
  private listeners = new Set<(msg: NostrIncomingMessage) => void>();
  private nip46RequestListeners = new Set<(msg: Nip46IncomingRequest) => void>();
  private nip46ResponseListeners = new Set<(msg: Nip46IncomingResponse) => void>();
  private stateListeners = new Set<(state: NostrConnectionState) => void>();
  private publishAckWaiters = new Map<
    string,
    {
      resolve: (value: { relayUrl: string; message: string }) => void;
      reject: (reason?: unknown) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private relays: string[] = [...DEFAULT_RELAYS];
  private localNsec = '';
  private localNpub = '';
  private localPrivHex = '';
  private localPubHex = '';
  private stopped = false;
  private connectionState: NostrConnectionState = 'disconnected';
  private recentIncomingEventIds = new Set<string>();

  private shouldProcessIncomingEventId(eventId: string): boolean {
    const id = String(eventId || '').trim();
    if (!id) return true;
    if (this.recentIncomingEventIds.has(id)) {
      return false;
    }
    this.recentIncomingEventIds.add(id);
    if (this.recentIncomingEventIds.size > MAX_RECENT_EVENT_IDS) {
      const oldest = this.recentIncomingEventIds.values().next().value;
      if (typeof oldest === 'string') {
        this.recentIncomingEventIds.delete(oldest);
      }
    }
    return true;
  }

  private loadToolsModule(): any {
    try {
      // Prefer explicit CJS bundle for React Native Metro compatibility.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('nostr-tools/lib/cjs/index.js');
    } catch {
      try {
        // Fallback to package root if Metro resolves it in this environment.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('nostr-tools');
      } catch (err) {
        throw new Error(
          `nostr-tools module unavailable in mobile runtime: ${String(err)}`,
        );
      }
    }
  }

  getConnectionState(): NostrConnectionState {
    return this.connectionState;
  }

  getLocalNpub(): string {
    return this.localNpub;
  }

  async getOrCreateLocalNpub(): Promise<string> {
    await this.ensureIdentity();
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
    this.stopped = false;
    await this.ensureIdentity();

    let desired = relays;
    if (!desired || desired.length === 0) {
      try {
        desired = await getNostrRelays(false);
      } catch {
        desired = DEFAULT_RELAYS;
      }
    }

    this.relays = Array.from(new Set((desired || DEFAULT_RELAYS).map(r => r.trim()).filter(Boolean)));
    this.setConnectionState('connecting');

    for (const relay of this.relays) {
      if (!this.sockets.has(relay)) {
        this.openSocket(relay);
      }
    }

    for (const existing of Array.from(this.sockets.keys())) {
      if (!this.relays.includes(existing)) {
        this.closeSocket(existing);
      }
    }

    if (!this.subscriptions.has('dm-inbox')) {
      this.subscribeInternal(
        'dm-inbox',
        {
          kinds: [4, 1059, 24133],
          '#p': [this.localPubHex],
          since: Math.floor(Date.now() / 1000) - 30,
        },
        (event, relayUrl) => {
          void this.handleIncomingEvent(event, relayUrl);
        },
      );
    }

    this.refreshConnectionState();
  }

  disconnect(): void {
    this.stopped = true;
    for (const relay of Array.from(this.sockets.keys())) {
      this.closeSocket(relay);
    }
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    this.setConnectionState('disconnected');
  }

  async sendEnvelope<T>(recipientNpubOrNpubs: string | string[], envelope: NostrEnvelope<T>): Promise<void> {
    await this.ensureIdentity();

    console.warn('[NIP46-CRITICAL] sendEnvelope invoked', {
      type: envelope?.type,
      recipientInputCount: Array.isArray(recipientNpubOrNpubs)
        ? recipientNpubOrNpubs.length
        : 1,
      socketCount: this.sockets.size,
      openSocketCount: Array.from(this.sockets.values()).filter(ws => ws.readyState === WebSocket.OPEN).length,
      connectionState: this.connectionState,
    });

    const recipients = Array.from(
      new Set(
        (Array.isArray(recipientNpubOrNpubs)
          ? recipientNpubOrNpubs
          : [recipientNpubOrNpubs])
          .map(v => v.trim())
          .filter(Boolean),
      ),
    );

    if (recipients.length === 0) {
      throw new Error('No valid Nostr recipients provided');
    }

    const failures: Array<{recipient: string; reason: string}> = [];
    let successCount = 0;

    for (const recipient of recipients) {
      try {
        await this.sendEnvelopeToSingleRecipient(recipient, envelope);
        successCount += 1;
      } catch (err) {
        failures.push({
          recipient,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (successCount === 0) {
      const detail = failures.map(f => `${f.recipient}: ${f.reason}`).join(' | ');
      throw new Error(`Failed to deliver Nostr message to all recipients (${detail})`);
    }

    if (failures.length > 0) {
      dbg('NostrMessaging: partial fan-out failure', failures);
    }
  }

  async sendCoSignRequest(
    recipientNpub: string,
    senderFingerprint: string,
    recipientFingerprint: string,
    payload: CoSignRequestPayload,
  ): Promise<void> {
    await this.ensureIdentity();
    const envelope: NostrEnvelope<CoSignRequestPayload> = {
      id: randomId(),
      type: 'COSIGN_REQUEST',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
    };

    this.persistOutgoingMessage(recipientNpub, envelope);
    await this.sendEnvelope(recipientNpub, envelope);
  }

  async sendCoSignRequestToMany(
    recipientNpubs: string[],
    senderFingerprint: string,
    recipientFingerprint: string,
    payload: CoSignRequestPayload,
  ): Promise<void> {
    await this.ensureIdentity();
    console.warn('[NIP46-CRITICAL] sendCoSignRequestToMany called', {
      txId: payload?.txId,
      traceId: payload?.traceId,
      recipientCount: Array.isArray(recipientNpubs) ? recipientNpubs.length : 0,
      hasPsbtHex: !!payload?.psbtHex,
      hasPsbtBase64: !!payload?.psbtBase64,
    });
    const envelope: NostrEnvelope<CoSignRequestPayload> = {
      id: randomId(),
      type: 'COSIGN_REQUEST',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
    };
    this.persistOutgoingMessage(recipientNpubs[0] || '', envelope);
    await this.sendEnvelope(recipientNpubs, envelope);
  }

  async sendCoSignResponse(
    recipientNpub: string,
    senderFingerprint: string,
    recipientFingerprint: string,
    payload: CoSignResponsePayload,
  ): Promise<void> {
    await this.ensureIdentity();
    const envelope: NostrEnvelope<CoSignResponsePayload> = {
      id: randomId(),
      type: 'COSIGN_RESPONSE',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
    };
    this.persistOutgoingMessage(recipientNpub, envelope);
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

  private async ensureTools(): Promise<any> {
    if (!this.tools) {
      this.tools = this.loadToolsModule();
    }
    return this.tools;
  }

  private async ensureIdentity(): Promise<void> {
    if (this.localNsec && this.localNpub && this.localPrivHex && this.localPubHex) {
      return;
    }

    const tools = await this.ensureTools();

    let nsec = '';
    let npub = '';

    try {
      const prepJson = await BBMTLibNativeModule.getKeyshareNostrPrepJSON();
      const prep = JSON.parse(prepJson || '{}');
      nsec = typeof prep.nsec === 'string' ? prep.nsec.trim() : '';
      npub = typeof prep.nostr_npub === 'string' ? prep.nostr_npub.trim() : '';
    } catch (err) {
      dbg('NostrMessaging: getKeyshareNostrPrepJSON failed', err);
    }

    if (!nsec) {
      try {
        nsec = (await EncryptedStorage.getItem(FALLBACK_NSEC_KEY))?.trim() || '';
        npub = npub || (await EncryptedStorage.getItem(FALLBACK_NPUB_KEY))?.trim() || '';
      } catch (err) {
        dbg('NostrMessaging: fallback identity read failed', err);
      }
    }

    if (!nsec) {
      try {
        const keyshareRaw = await EncryptedStorage.getItem('keyshare');
        if (keyshareRaw) {
          const parsed = JSON.parse(keyshareRaw);
          nsec = typeof parsed?.nsec === 'string' ? parsed.nsec.trim() : '';
          npub = npub || (typeof parsed?.nostr_npub === 'string' ? parsed.nostr_npub.trim() : '');
        }
      } catch (err) {
        dbg('NostrMessaging: keyshare blob nsec recovery failed', err);
      }
    }

    nsec = this.normalizeNsecCandidate(nsec);

    if (!npub) {
      try {
        const meta = await getKeyshareMetadata();
        npub = typeof meta?.nostr_npub === 'string' ? meta.nostr_npub.trim() : '';
      } catch {
        // no-op
      }
    }

    if (!nsec) {
      try {
        const keypairJson = await BBMTLibNativeModule.nostrKeypair();
        const keypair = JSON.parse(keypairJson || '{}');
        const generatedNsec = this.normalizeNsecCandidate(
          typeof keypair?.nsec === 'string' ? keypair.nsec : '',
        );
        const generatedNpub = typeof keypair?.npub === 'string' ? keypair.npub.trim() : '';
        if (generatedNsec) {
          nsec = generatedNsec;
          npub = npub || generatedNpub;
          await EncryptedStorage.setItem(FALLBACK_NSEC_KEY, nsec);
          if (generatedNpub) {
            await EncryptedStorage.setItem(FALLBACK_NPUB_KEY, generatedNpub);
          }
          dbg('NostrMessaging: generated fallback Nostr identity for messaging');
        }
      } catch (err) {
        dbg('NostrMessaging: fallback keypair generation failed', err);
      }
    }

    if (!nsec) {
      throw new Error('Nostr identity unavailable: no nsec found in keyshare or fallback storage');
    }

    this.localNsec = nsec;
    this.localPrivHex = await this.nsecToHex(nsec);
    this.localPubHex = tools.getPublicKey(hexToBytes(this.localPrivHex));
    const derivedNpub = tools.nip19.npubEncode(this.localPubHex);
    if (npub && npub !== derivedNpub) {
      dbg('NostrMessaging: npub mismatch with recovered nsec, using derived npub');
    }
    this.localNpub = npub && npub === derivedNpub ? npub : derivedNpub;
    try {
      await EncryptedStorage.setItem(FALLBACK_NPUB_KEY, this.localNpub);
      await EncryptedStorage.setItem(FALLBACK_NSEC_KEY, this.localNsec);
    } catch {
      // non-fatal cache write
    }
  }

  private normalizeNsecCandidate(raw: string): string {
    const s = (raw || '').trim();
    if (!s) return '';
    if (s.startsWith('nsec1')) return s;

    const isHex = s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
    if (isHex) {
      try {
        const utf8 = Buffer.from(s, 'hex').toString('utf8').trim();
        if (utf8.startsWith('nsec1')) {
          return utf8;
        }
      } catch {
        // fall through
      }
    }

    return s;
  }

  private async nsecToHex(nsec: string): Promise<string> {
    if (!nsec.startsWith('nsec1')) return nsec.trim().toLowerCase();
    const tools = await this.ensureTools();
    const decoded = tools.nip19.decode(nsec);
    const hex = nip19DecodedDataToHex(decoded.data);
    if (hex.length !== 64) {
      throw new Error(`Invalid nsec length after decode: expected 64 hex chars, got ${hex.length}`);
    }
    return hex;
  }

  private async npubToHex(npub: string): Promise<string> {
    if (!npub.startsWith('npub1')) return npub.trim().toLowerCase();
    const tools = await this.ensureTools();
    const decoded = tools.nip19.decode(npub);
    const hex = nip19DecodedDataToHex(decoded.data);
    if (hex.length !== 64) {
      throw new Error(`Invalid npub length after decode: expected 64 hex chars, got ${hex.length}`);
    }
    return hex;
  }

  private async hexToNpub(pubHex: string): Promise<string> {
    const tools = await this.ensureTools();
    return tools.nip19.npubEncode(pubHex);
  }

  private openSocket(relayUrl: string): void {
    const ws = new WebSocket(relayUrl);
    this.sockets.set(relayUrl, ws);

    ws.onopen = () => {
      for (const [subId, sub] of this.subscriptions.entries()) {
        ws.send(JSON.stringify(['REQ', subId, sub.filter]));
      }
      this.refreshConnectionState();
    };

    ws.onmessage = evt => {
      try {
        const msg = JSON.parse(String(evt.data));
        if (!Array.isArray(msg)) return;
        if (msg[0] === 'OK') {
          const eventId = String(msg[1] || '');
          const accepted = !!msg[2];
          const relayMessage = String(msg[3] || '');
          const waiter = this.publishAckWaiters.get(eventId);
          if (waiter) {
            clearTimeout(waiter.timeout);
            this.publishAckWaiters.delete(eventId);
            if (accepted) {
              waiter.resolve({ relayUrl, message: relayMessage });
            } else {
              waiter.reject(new Error(`Relay rejected event ${eventId}: ${relayMessage || 'no reason provided'}`));
            }
          }
          return;
        }
        if (msg[0] === 'EVENT') {
          const subId = String(msg[1] || '');
          const event = msg[2];
          console.log(`[NIP46-TLM][Receiver] Received Kind ${String(event?.kind)} from ${String(event?.pubkey || 'unknown')}`);
          const sub = this.subscriptions.get(subId);
          if (sub) sub.handler(event, relayUrl);
        }
      } catch (err) {
        dbg('NostrMessaging: relay frame parse failed', err);
      }
    };

    ws.onerror = () => {
      this.refreshConnectionState();
    };

    ws.onclose = () => {
      this.sockets.delete(relayUrl);
      this.refreshConnectionState();
      if (!this.stopped) {
        const t = setTimeout(() => this.openSocket(relayUrl), 2500);
        this.reconnectTimers.set(relayUrl, t);
      }
    };
  }

  private closeSocket(relayUrl: string): void {
    const ws = this.sockets.get(relayUrl);
    if (ws) {
      try {
        ws.close();
      } catch {
        // no-op
      }
      this.sockets.delete(relayUrl);
    }

    const timer = this.reconnectTimers.get(relayUrl);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(relayUrl);
    }
  }

  private refreshConnectionState(): void {
    const open = Array.from(this.sockets.values()).filter(ws => ws.readyState === WebSocket.OPEN).length;
    if (open === 0) {
      this.setConnectionState(this.sockets.size ? 'connecting' : 'disconnected');
      return;
    }
    this.setConnectionState(open === this.relays.length ? 'connected' : 'degraded');
  }

  private subscribeInternal(
    subId: string,
    filter: any,
    handler: (event: any, relayUrl: string) => void,
  ): void {
    this.subscriptions.set(subId, { filter, handler });
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['REQ', subId, filter]));
      }
    }
  }

  private async signEvent(
    content: string,
    recipientHex: string,
    type: NostrMessageType,
    extraTags: string[][] = [],
  ): Promise<any> {
    const tools = await this.ensureTools();
    const unsignedEvent = {
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', recipientHex],
        ['x', KEY_TAG],
        ['t', type],
        ...extraTags,
      ],
      content,
    };
    console.log('[NIP46-TLM][Sender] Publishing Event:', JSON.stringify(unsignedEvent, null, 2));
    return tools.finalizeEvent(unsignedEvent, hexToBytes(this.localPrivHex));
  }

  private waitForPublishAck(eventId: string, timeoutMs = 12000): Promise<{ relayUrl: string; message: string }> {
    return new Promise((resolve, reject) => {
      const existing = this.publishAckWaiters.get(eventId);
      if (existing) {
        clearTimeout(existing.timeout);
        this.publishAckWaiters.delete(eventId);
      }

      const timeout = setTimeout(() => {
        this.publishAckWaiters.delete(eventId);
        reject(new Error(`Timed out waiting for relay OK ack for event ${eventId}`));
      }, timeoutMs);

      this.publishAckWaiters.set(eventId, { resolve, reject, timeout });
    });
  }

  private async encryptForRecipient(plaintext: string, recipientHex: string): Promise<string> {
    const tools = await this.ensureTools();

    const nip44 = tools.nip44 as any;
    if (nip44?.v2?.utils?.getConversationKey && nip44?.v2?.encrypt) {
      try {
        const conv = nip44.v2.utils.getConversationKey(this.localPrivHex, recipientHex);
        return `nip44:${nip44.v2.encrypt(plaintext, conv)}`;
      } catch {
        // fall through to nip04
      }
    }

    if (!tools.nip04?.encrypt) {
      throw new Error('NIP-04 encryption unavailable in nostr-tools');
    }

    const enc = await tools.nip04.encrypt(this.localPrivHex, recipientHex, plaintext);
    return `nip04:${enc}`;
  }

  private async decryptFromSender(ciphertext: string, senderHex: string): Promise<string> {
    const tools = await this.ensureTools();

    if (ciphertext.startsWith('nip44:')) {
      const nip44 = tools.nip44 as any;
      if (nip44?.v2?.utils?.getConversationKey && nip44?.v2?.decrypt) {
        const conv = nip44.v2.utils.getConversationKey(this.localPrivHex, senderHex);
        return nip44.v2.decrypt(ciphertext.slice(6), conv);
      }
    }

    const raw = ciphertext.startsWith('nip04:') ? ciphertext.slice(6) : ciphertext;
    if (!tools.nip04?.decrypt) {
      throw new Error('NIP-04 decryption unavailable in nostr-tools');
    }

    return tools.nip04.decrypt(this.localPrivHex, senderHex, raw);
  }

  private async handleIncomingEvent(event: any, relayUrl: string): Promise<void> {
    if (!event || typeof event !== 'object') return;
    if (typeof event.content !== 'string' || typeof event.pubkey !== 'string') return;
    const eventId = String(event.id || '').trim();

    if (eventId && !this.shouldProcessIncomingEventId(eventId)) {
      dbg('[NIP46-TLM][Receiver] memory dedup skipped duplicate relay event', {
        eventId,
        relayUrl,
      });
      return;
    }

    if (eventId) {
      const messageId = `nostr:${eventId}`;
      if (chatRepository.hasMessageId(messageId)) {
        dbg('[NIP46-TLM][Receiver] dedup skipped already persisted event', {
          eventId,
          relayUrl,
        });
        return;
      }
    }

    if (event.kind === 24133) {
      await this.handleIncomingNip46Event(event, relayUrl);
      return;
    }

    if (event.kind !== 4 && event.kind !== 1059) return;

    const tags = Array.isArray(event.tags) ? event.tags : [];
    const hasClientTag = tags.some((t: any) => Array.isArray(t) && t[0] === 'x' && t[1] === KEY_TAG);
    if (!hasClientTag) return;

    try {
      const plaintext = await this.decryptFromSender(event.content, event.pubkey);
      const envelope = JSON.parse(plaintext) as NostrEnvelope;
      if (!envelope?.type || !envelope?.id) return;

      const payloadTraceId =
        envelope?.payload && typeof envelope.payload === 'object'
          ? (envelope.payload as any).traceId
          : undefined;
      const traceId = typeof payloadTraceId === 'string' && payloadTraceId.trim()
        ? payloadTraceId.trim()
        : null;

      const msg: NostrIncomingMessage = {
        envelope,
        senderNpub: await this.hexToNpub(event.pubkey),
        relayUrl,
        eventId,
      };

      this.persistIncomingMessage(msg);

      if (envelope.type === 'COSIGN_REQUEST') {
        dbg('[NIP46-TLM][Receiver] decoded COSIGN_REQUEST envelope', {
          traceId,
          eventId: msg.eventId,
          envelopeId: envelope.id,
          relayUrl,
        });
      }

      for (const listener of this.listeners) listener(msg);
    } catch (err) {
      dbg('NostrMessaging: failed to decode incoming event', err);
    }
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
      const { content, isPayload } = contentFromPayload(payload, msg.envelope.type);
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
      const { content, isPayload } = contentFromPayload(payload, envelope.type);
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

  private async sendEnvelopeToSingleRecipient<T>(recipientNpub: string, envelope: NostrEnvelope<T>): Promise<void> {
    const recipientHex = await this.npubToHex(recipientNpub);
    const plaintext = JSON.stringify(envelope);
    const encrypted = await this.encryptForRecipient(plaintext, recipientHex);
    const coordinationTags = coordinationTagsFromEnvelope(envelope);
    const event = await this.signEvent(
      encrypted,
      recipientHex,
      envelope.type,
      coordinationTags,
    );

    const eventTags = Array.isArray(event?.tags) ? event.tags : [];
    const hasRecipientTag = eventTags.some(
      (t: any) => Array.isArray(t) && t[0] === 'p' && String(t[1] || '') === recipientHex,
    );
    if (!hasRecipientTag) {
      throw new Error('Refusing to publish event without required recipient p-tag');
    }

    let delivered = 0;
    const socketStates: Array<{ relayUrl: string; readyState: number }> = [];
    for (const [relayUrl, ws] of this.sockets.entries()) {
      socketStates.push({ relayUrl, readyState: ws.readyState });
    }

    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['EVENT', event]));
        delivered += 1;
      }
    }

    if (delivered === 0) {
      console.error('[NIP46-CRITICAL] Cannot send event, WebSocket is disconnected.', {
        type: envelope.type,
        eventId: event.id,
        recipientNpub,
        socketStates,
        connectionState: this.connectionState,
      });
      throw new Error('No active Nostr relay connection');
    }

    const ack = await this.waitForPublishAck(String(event.id || ''));
    console.log('[NIP46-TLM][Sender] Relay OK ack received', {
      eventId: event.id,
      relayUrl: ack.relayUrl,
      relayMessage: ack.message,
      recipientHexPrefix: recipientHex.slice(0, 12),
      type: envelope.type,
    });
  }

  private async handleIncomingNip46Event(event: any, relayUrl: string): Promise<void> {
    const tags = Array.isArray(event.tags) ? event.tags : [];
    const hasNip46Tag = tags.some((t: any) => Array.isArray(t) && t[0] === 'x' && t[1] === NIP46_TAG);
    if (!hasNip46Tag) return;

    try {
      const plaintext = await this.decryptFromSender(event.content, event.pubkey);
      const decoded = JSON.parse(plaintext) as Partial<Nip46Request & Nip46Response>;
      const senderNpub = await this.hexToNpub(event.pubkey);

      if (typeof decoded?.method === 'string') {
        const request: Nip46Request = {
          id: String(decoded.id || ''),
          method: decoded.method,
          params: Array.isArray(decoded.params) ? decoded.params : [],
          ...(typeof decoded.secret === 'string' ? {secret: decoded.secret} : {}),
        };
        if (!request.id) return;

        const incoming: Nip46IncomingRequest = {
          request,
          senderNpub,
          senderPubHex: String(event.pubkey),
          relayUrl,
          eventId: String(event.id || ''),
        };
        for (const listener of this.nip46RequestListeners) listener(incoming);
        return;
      }

      if (typeof decoded?.id === 'string' && ('result' in decoded || 'error' in decoded)) {
        const incoming: Nip46IncomingResponse = {
          response: {
            id: decoded.id,
            ...(decoded.result !== undefined ? {result: decoded.result} : {}),
            ...(typeof decoded.error === 'string' ? {error: decoded.error} : {}),
          },
          senderNpub,
          senderPubHex: String(event.pubkey),
          relayUrl,
          eventId: String(event.id || ''),
        };
        for (const listener of this.nip46ResponseListeners) listener(incoming);
      }
    } catch (err) {
      dbg('NostrMessaging: failed to decode NIP-46 event', err);
    }
  }
}

export const nostrMessaging = new NostrMessagingService();
