import { Buffer } from 'buffer';
import { NativeModules } from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import { dbg, getKeyshareMetadata, getNostrRelays } from '../utils';

const { BBMTLibNativeModule } = NativeModules;

export type NostrMessageType =
  | 'COSIGN_REQUEST'
  | 'COSIGN_RESPONSE'
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
  psbtHex: string;
  psbtBase64?: string;
  amountSats: number;
  feeSats: number;
  recipientAddress: string;
  network: 'mainnet' | 'testnet' | 'testnet4';
}

export interface CoSignResponsePayload {
  txId: string;
  signedPsbtHex?: string;
  signedPsbtBase64?: string;
  approved: boolean;
  reason?: string;
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

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];
const KEY_TAG = 'bold-cosign-v1';
const FALLBACK_NSEC_KEY = 'nostr_fallback_nsec';
const FALLBACK_NPUB_KEY = 'nostr_fallback_npub';

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

function nip19DataToHex(data: unknown): string {
  if (typeof data === 'string') {
    return data.trim();
  }
  if (data instanceof Uint8Array) {
    return bytesToHex(data);
  }
  if (Array.isArray(data)) {
    return bytesToHex(Uint8Array.from(data as number[]));
  }
  throw new Error('Unsupported nip19 payload format');
}

class NostrMessagingService {
  private tools: any | null = null;
  private sockets = new Map<string, WebSocket>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private subscriptions = new Map<string, { filter: any; handler: (event: any, relayUrl: string) => void }>();
  private listeners = new Set<(msg: NostrIncomingMessage) => void>();
  private stateListeners = new Set<(state: NostrConnectionState) => void>();
  private relays: string[] = [...DEFAULT_RELAYS];
  private localNsec = '';
  private localNpub = '';
  private localPrivHex = '';
  private localPubHex = '';
  private stopped = false;
  private connectionState: NostrConnectionState = 'disconnected';

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
          kinds: [4],
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

    const recipients = Array.from(
      new Set(
        (Array.isArray(recipientNpubOrNpubs) ? recipientNpubOrNpubs : [recipientNpubOrNpubs])
          .map(v => v.trim())
          .filter(Boolean),
      ),
    );

    if (recipients.length === 0) {
      throw new Error('No valid Nostr recipients provided');
    }

    const failures: Array<{ recipient: string; reason: string }> = [];
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
    await this.sendEnvelope(recipientNpub, {
      id: randomId(),
      type: 'COSIGN_REQUEST',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
    });
  }

  async sendCoSignRequestToMany(
    recipientNpubs: string[],
    senderFingerprint: string,
    recipientFingerprint: string,
    payload: CoSignRequestPayload,
  ): Promise<void> {
    await this.sendEnvelope(recipientNpubs, {
      id: randomId(),
      type: 'COSIGN_REQUEST',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
    });
  }

  async sendCoSignResponse(
    recipientNpub: string,
    senderFingerprint: string,
    recipientFingerprint: string,
    payload: CoSignResponsePayload,
  ): Promise<void> {
    await this.sendEnvelope(recipientNpub, {
      id: randomId(),
      type: 'COSIGN_RESPONSE',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
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
    if (!nsec.startsWith('nsec1')) return nsec;
    const tools = await this.ensureTools();
    const decoded = tools.nip19.decode(nsec);
    return nip19DataToHex(decoded.data);
  }

  private async npubToHex(npub: string): Promise<string> {
    if (!npub.startsWith('npub1')) return npub;
    const tools = await this.ensureTools();
    const decoded = tools.nip19.decode(npub);
    return nip19DataToHex(decoded.data);
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
        if (msg[0] === 'EVENT') {
          const subId = String(msg[1] || '');
          const event = msg[2];
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

  private async signEvent(content: string, recipientHex: string, type: NostrMessageType): Promise<any> {
    const tools = await this.ensureTools();
    const draft = {
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', recipientHex],
        ['x', KEY_TAG],
        ['t', type],
      ],
      content,
    };
    return tools.finalizeEvent(draft, hexToBytes(this.localPrivHex));
  }

  private async sendEnvelopeToSingleRecipient<T>(recipientNpub: string, envelope: NostrEnvelope<T>): Promise<void> {
    const recipientHex = await this.npubToHex(recipientNpub);
    const plaintext = JSON.stringify(envelope);
    const encrypted = await this.encryptForRecipient(plaintext, recipientHex);
    const event = await this.signEvent(encrypted, recipientHex, envelope.type);

    let delivered = 0;
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['EVENT', event]));
        delivered += 1;
      }
    }

    if (delivered === 0) {
      throw new Error('No active Nostr relay connection');
    }
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
    if (event.kind !== 4 || typeof event.content !== 'string' || typeof event.pubkey !== 'string') return;

    const tags = Array.isArray(event.tags) ? event.tags : [];
    const hasClientTag = tags.some((t: any) => Array.isArray(t) && t[0] === 'x' && t[1] === KEY_TAG);
    if (!hasClientTag) return;

    try {
      const plaintext = await this.decryptFromSender(event.content, event.pubkey);
      const envelope = JSON.parse(plaintext) as NostrEnvelope;
      if (!envelope?.type || !envelope?.id) return;

      const msg: NostrIncomingMessage = {
        envelope,
        senderNpub: await this.hexToNpub(event.pubkey),
        relayUrl,
        eventId: String(event.id || ''),
      };

      for (const listener of this.listeners) listener(msg);
    } catch (err) {
      dbg('NostrMessaging: failed to decode incoming event', err);
    }
  }
}

export const nostrMessaging = new NostrMessagingService();
