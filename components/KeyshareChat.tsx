import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { DeviceEventEmitter } from 'react-native';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import AppText from './AppText';
import AppPressable from './AppPressable';
import ChatBubble from './ChatBubble';
import CoSignRequestCard from './CoSignRequestCard';
import {
  getRecentCoSignFeedEvents,
  getRecentCoSignFocusEvents,
  getRecentUnreadChatEvents,
} from './NostrCoSignBridge';
import { useTheme } from '../theme';
import { dbg, getKeyshareMetadata } from '../utils';
import {
  nostrMessaging,
  type CoSignRequestPayload,
  type NostrIncomingMessage,
  type NostrMessageType,
} from '../services/nostrMessaging';
import { setPendingCoSignRequest } from '../services/nostrCoSignSession';
import chatRepository, {
  type ChatHydrationRow,
  type ChatThreadStatus,
} from '../services/repositories/ChatRepository';

const CHAT_THREAD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function fingerprintFromNpub(npub: string): string {
  if (!npub) return 'unknown';
  try {
    return bytesToHex(sha256(utf8ToBytes(npub))).slice(0, 8);
  } catch {
    return 'unknown';
  }
}

function normalizeNpub(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePayload(rawPayload: unknown): Record<string, unknown> {
  if (rawPayload && typeof rawPayload === 'object') {
    return rawPayload as Record<string, unknown>;
  }
  if (typeof rawPayload === 'string') {
    try {
      const parsed = JSON.parse(rawPayload);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { text: rawPayload };
    }
    return { text: rawPayload };
  }
  return {};
}

function payloadText(payload: Record<string, unknown>): string {
  if (typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text;
  }
  return JSON.stringify(payload);
}

function formatThreadClock(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function messageIdentity(msg: NostrIncomingMessage): string {
  if (msg.eventId) {
    return `event:${msg.eventId}`;
  }
  return [
    'fallback',
    msg.senderNpub,
    msg.envelope.id,
    msg.envelope.type,
    String(msg.envelope.timestamp),
  ].join(':');
}

function messageRenderKey(msg: NostrIncomingMessage): string {
  return `${messageIdentity(msg)}:${msg.relayUrl}`;
}

/** Canonical cross-pathway identity for a COSIGN_REQUEST, independent of transport/relay. */
function coSignRequestIdentity(opts: {
  nip46RequestId?: string;
  txId?: string;
  eventId?: string;
  envelopeId?: string;
  fallbackSeed: string;
}): string {
  return (
    (typeof opts.nip46RequestId === 'string' && opts.nip46RequestId.trim()) ||
    (typeof opts.txId === 'string' && opts.txId.trim()) ||
    (typeof opts.eventId === 'string' && opts.eventId.trim()) ||
    (typeof opts.envelopeId === 'string' && opts.envelopeId.trim()) ||
    opts.fallbackSeed
  );
}

type PeerState = {
  npub: string;
  label: string;
  slotLabel: string;
  slotIndex: number;
  isOnline: boolean;
  lastPingAt: number;
};

type ThreadKind = 'peer' | 'invoice';

type ThreadSummary = {
  id: string;
  chatId: string;
  kind: ThreadKind;
  npub: string;
  title: string;
  preview: string;
  timestamp: number;
  unreadCount: number;
  pinned: boolean;
  online: boolean;
  thresholdProgress?: string;
  thresholdProgressState?: 'none' | 'partial' | 'met';
  invoiceKey?: string;
  lastItem?: ChatFeedItem;
  openItem?: ChatFeedItem;
};

type ChatFeedItem = {
  id: string;
  type: NostrMessageType;
  invoiceThreadKey?: string;
  status?: 'pending' | 'signing' | 'signed' | 'broadcasted' | 'rejected';
  txId?: string;
  mode?: 'legacy' | 'nip46';
  nip46RequestId?: string;
  nip46ReplyTo?: string;
  senderFingerprint: string;
  senderNpub: string;
  senderLabel: string;
  timestamp: number;
  payload: Record<string, unknown>;
  sourceMessage?: NostrIncomingMessage;
};

type CoSignStatusEvent = {
  mode?: 'legacy' | 'nip46';
  requestId?: string;
  txId?: string;
  status?: 'pending' | 'signing' | 'signed' | 'broadcasted' | 'rejected';
};

type NostrMpcStateEvent = {
  txId?: string;
  state?:
    | 'idle'
    | 'awaiting_peer'
    | 'computing_nonces'
    | 'signing'
    | 'broadcasting'
    | 'completed'
    | 'failed';
};

type CoSignFeedBridgeEvent = {
  ts?: number;
  mode?: 'legacy' | 'nip46';
  eventId?: string;
  envelopeId?: string;
  nip46RequestId?: string;
  nip46ReplyTo?: string;
  senderNpub?: string;
  senderFingerprint?: string;
  recipientFingerprint?: string;
  request?: Record<string, unknown>;
};

type IncomingChatEvent = {
  type?: string;
  mode?: 'legacy' | 'nip46' | 'chat';
  ts?: number;
  requestId?: string;
  txId?: string;
  parsedMessage?: {
    eventId?: string;
    senderNpub?: string;
    senderFingerprint?: string;
    nip46RequestId?: string;
    nip46ReplyTo?: string;
    request?: Record<string, unknown>;
  };
};

const PEER_ONLINE_WINDOW_MS = 90 * 1000;

function invoiceThreadKeyForItem(item: ChatFeedItem): string {
  const byRequest = typeof item.nip46RequestId === 'string' ? item.nip46RequestId.trim() : '';
  if (byRequest) return `req:${byRequest}`;

  const byTx = typeof item.txId === 'string' ? item.txId.trim() : '';
  const byTrace =
    item.payload && typeof item.payload.traceId === 'string'
      ? item.payload.traceId.trim()
      : '';
  if (byTx && byTrace) return `tx:${byTx}:trace:${byTrace}`;
  if (byTx) return `tx:${byTx}`;

  const payloadTx =
    item.payload && typeof item.payload.txId === 'string' ? item.payload.txId.trim() : '';
  const payloadTrace =
    item.payload && typeof item.payload.traceId === 'string'
      ? item.payload.traceId.trim()
      : '';
  if (payloadTx && payloadTrace) return `tx:${payloadTx}:trace:${payloadTrace}`;
  if (payloadTx) return `tx:${payloadTx}`;

  return `evt:${item.id}`;
}

function invoiceThreadKeyFromPayload(payload: Record<string, unknown>): string {
  const reqId = typeof payload.nip46RequestId === 'string' ? payload.nip46RequestId.trim() : '';
  if (reqId) return `req:${reqId}`;
  const txId = typeof payload.txId === 'string' ? payload.txId.trim() : '';
  const traceId = typeof payload.traceId === 'string' ? payload.traceId.trim() : '';
  if (txId && traceId) return `tx:${txId}:trace:${traceId}`;
  if (txId) return `tx:${txId}`;
  return '';
}

function compactAddress(address: string): string {
  const a = typeof address === 'string' ? address.trim() : '';
  if (!a) return '';
  if (a.length <= 14) return a;
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}

function formatSats(amountSats: unknown): string {
  const n = Number(amountSats);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return Math.trunc(n).toLocaleString('en-US');
}

function keyHashSeed(seed: string): string {
  return bytesToHex(sha256(utf8ToBytes(seed))).slice(0, 12);
}

function coSignThreadTitle(requestItem?: ChatFeedItem, fallbackKey?: string): string {
  const payload = requestItem?.payload || {};
  const amount = Number(payload.amountSats);
  const recipient =
    typeof payload.recipientAddress === 'string' ? payload.recipientAddress.trim() : '';
  const txId =
    (typeof requestItem?.txId === 'string' && requestItem.txId.trim()) ||
    (typeof payload.txId === 'string' ? payload.txId.trim() : '');

  if (Number.isFinite(amount) && amount > 0 && recipient && recipient !== 'N/A') {
    return `Send ${formatSats(amount)} sats to ${compactAddress(recipient)}`;
  }

  if (
    typeof payload.psbtBase64 === 'string' ||
    typeof payload.psbtHex === 'string'
  ) {
    const psbtRef = txId || (fallbackKey || '').replace(/^.*:/, '');
    const shortRef = psbtRef ? psbtRef.slice(0, 10) : 'request';
    return `PSBT Co-Sign #${shortRef}`;
  }

  if (txId) {
    return `Co-Sign #${txId.slice(0, 10)}`;
  }

  if (fallbackKey) {
    const ref = fallbackKey.replace(/^.*:/, '').slice(0, 10);
    return ref ? `Co-Sign #${ref}` : 'Co-Sign Request';
  }

  return 'Co-Sign Request';
}

function coSignThreadPreview(item?: ChatFeedItem): string {
  if (!item) return 'Co-sign request';
  if (item.type === 'CHAT_MESSAGE') return payloadText(item.payload);
  const amount = Number(item.payload.amountSats);
  const recipient =
    typeof item.payload.recipientAddress === 'string'
      ? item.payload.recipientAddress.trim()
      : '';
  if (Number.isFinite(amount) && amount > 0) {
    if (recipient && recipient !== 'N/A') {
      return `Request: ${formatSats(amount)} sats to ${compactAddress(recipient)}`;
    }
    return `Request: ${formatSats(amount)} sats`;
  }
  return 'Co-sign thread';
}

function resolvePeerFromSigningCsv(
  payload: Record<string, unknown>,
  localNpub: string,
): string {
  const csv =
    typeof payload.signingNpubsCSV === 'string'
      ? payload.signingNpubsCSV.trim()
      : '';
  if (!csv) return '';
  const peers = csv
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .filter(n => n !== localNpub);
  return peers[0] || '';
}

function deriveMessageTypeFromHydration(row: ChatHydrationRow, payload: Record<string, unknown>): NostrMessageType {
  if (row.threadType === 'cosign') {
    if (typeof payload.approved === 'boolean') return 'COSIGN_RESPONSE';
    return 'COSIGN_REQUEST';
  }
  return 'CHAT_MESSAGE';
}

function deriveMessageStatus(type: NostrMessageType, threadStatus: ChatThreadStatus): ChatFeedItem['status'] {
  if (type !== 'COSIGN_REQUEST' && type !== 'COSIGN_RESPONSE') return undefined;
  if (threadStatus === 'closed') return 'rejected';
  if (threadStatus === 'approved') return 'signed';
  return 'pending';
}

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n)) return null;
  const out = Math.trunc(n);
  return out > 0 ? out : null;
}

function deriveThreshold(meta: Record<string, unknown>, committeeSize: number): number {
  const directCandidates = [
    meta.threshold,
    meta.keygen_threshold,
    meta.signing_threshold,
    meta.min_signers,
    meta.quorum,
    meta.required_signers,
    meta.n,
  ];

  for (const candidate of directCandidates) {
    const n = asPositiveInt(candidate);
    if (n) return Math.min(Math.max(n, 1), Math.max(committeeSize, 1));
  }

  const policyCandidates = [meta.threshold_policy, meta.policy, meta.scheme, meta.signing_policy];
  for (const candidate of policyCandidates) {
    if (typeof candidate !== 'string') continue;
    const match = candidate.match(/(\d+)\s*[-/]\s*of\s*[-/]\s*(\d+)/i);
    if (!match) continue;
    const n = asPositiveInt(match[1]);
    const m = asPositiveInt(match[2]) || committeeSize;
    if (n) return Math.min(Math.max(n, 1), Math.max(m, 1));
  }

  // Safe fallback when metadata omits threshold details: current duos default to all parties.
  return Math.max(1, committeeSize);
}

const KeyshareChat: React.FC = () => {
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [state, setState] = useState(nostrMessaging.getConnectionState());
  const [messages, setMessages] = useState<ChatFeedItem[]>([]);
  const [peers, setPeers] = useState<PeerState[]>([]);
  const [committeeSize, setCommitteeSize] = useState(0);
  const [signingThreshold, setSigningThreshold] = useState(0);
  const [provisionedKeyshareCount, setProvisionedKeyshareCount] = useState(0);
  const [activeKeyshareCount, setActiveKeyshareCount] = useState(0);
  const [activeChatId, setActiveChatId] = useState('');
  const [unreadByThread, setUnreadByThread] = useState<Record<string, number>>({});
  const peersRef = useRef<PeerState[]>([]);
  const invoiceThreadKeyByRequestIdRef = useRef<Map<string, string>>(new Map());
  const invoiceThreadKeyByTxIdRef = useRef<Map<string, string>>(new Map());
  const invoiceThreadKeyByTxTraceRef = useRef<Map<string, string>>(new Map());
  const lastCoSignOpenAtRef = useRef(0);
  // One COSIGN_REQUEST can reach this screen via up to three independent paths
  // (direct onMessage listener, bridge's nostr-cosign:request, bridge's
  // nostr-chat:incoming) plus redelivery across multiple relays; this Set makes
  // "first one wins, the rest are no-ops" regardless of which path arrives first.
  const seenCoSignRequestIdsRef = useRef<Set<string>>(new Set());
  // Set by a tapped global co-sign notification (see NostrCoSignBridge.notifyCoSignRequest);
  // consumed by the effect below once the matching card exists in `messages`.
  const pendingFocusTxIdRef = useRef<string | null>(null);
  const pendingFocusOpenRequestRef = useRef<boolean>(true);

  const resolveExistingInvoiceThreadKey = (
    requestId?: string,
    txId?: string,
    traceId?: string,
  ): string | undefined => {
    const req = typeof requestId === 'string' ? requestId.trim() : '';
    if (req) {
      const byReq = invoiceThreadKeyByRequestIdRef.current.get(req);
      if (byReq) return byReq;
    }

    const tx = typeof txId === 'string' ? txId.trim() : '';
    const trace = typeof traceId === 'string' ? traceId.trim() : '';
    if (tx && trace) {
      const byComposite = invoiceThreadKeyByTxTraceRef.current.get(`${tx}::${trace}`);
      if (byComposite) return byComposite;
    }
    if (tx) {
      const byTx = invoiceThreadKeyByTxIdRef.current.get(tx);
      if (byTx) return byTx;
    }

    return undefined;
  };

  const registerInvoiceThreadKey = (opts: {
    requestId?: string;
    txId?: string;
    traceId?: string;
    senderNpub?: string;
    timestamp?: number;
    fallbackIdentity: string;
  }): string => {
    const req = typeof opts.requestId === 'string' ? opts.requestId.trim() : '';
    const tx = typeof opts.txId === 'string' ? opts.txId.trim() : '';
    const trace = typeof opts.traceId === 'string' ? opts.traceId.trim() : '';

    const existing = resolveExistingInvoiceThreadKey(req, tx, trace);
    if (existing) return existing;

    if (req) {
      const key = `req:${req}`;
      invoiceThreadKeyByRequestIdRef.current.set(req, key);
      if (tx) invoiceThreadKeyByTxIdRef.current.set(tx, key);
      if (tx && trace) {
        invoiceThreadKeyByTxTraceRef.current.set(`${tx}::${trace}`, key);
      }
      return key;
    }

    if (tx && trace) {
      const key = `tx:${tx}:trace:${trace}`;
      invoiceThreadKeyByTxTraceRef.current.set(`${tx}::${trace}`, key);
      invoiceThreadKeyByTxIdRef.current.set(tx, key);
      return key;
    }

    if (tx) {
      const ts = Number(opts.timestamp || Date.now());
      const sender = typeof opts.senderNpub === 'string' ? opts.senderNpub.trim() : '';
      const txSeed = keyHashSeed(`${tx}|${sender}|${ts}|${opts.fallbackIdentity}`);
      const key = `tx:${tx}:h:${txSeed}`;
      invoiceThreadKeyByTxIdRef.current.set(tx, key);
      return key;
    }

    const evtSeed = keyHashSeed(`${opts.fallbackIdentity}|${opts.timestamp || Date.now()}`);
    return `evt:${evtSeed}`;
  };

  const refreshUnreadCounts = () => {
    const rows = chatRepository.getUnreadCountByThread();
    const next: Record<string, number> = {};
    rows.forEach(row => {
      if (!row.threadId) return;
      next[row.threadId] = row.unreadCount;
    });
    setUnreadByThread(next);
  };

  const threadIdFromChatId = (chatId: string): string => {
    if (!chatId) return '';
    if (chatId.startsWith('peer:')) return chatId;
    if (chatId.startsWith('invoice:')) return chatId.slice('invoice:'.length);
    return '';
  };

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    setActiveKeyshareCount(peers.filter(peer => peer.isOnline).length);
  }, [peers]);

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      try {
        const minUpdatedAt = Date.now() - CHAT_THREAD_TTL_MS;
        const hydratedRows = chatRepository.getHydrationRows(minUpdatedAt);
        if (mounted && hydratedRows.length > 0) {
          const seen = new Set<string>();
          const byRequest = new Map<string, string>();
          const byTx = new Map<string, string>();
          const byTxTrace = new Map<string, string>();

          const hydrated = hydratedRows.flatMap(row => {
            const payload = row.isPayload ? parsePayload(row.content) : { text: row.content };
            const payloadKeys = Object.keys(payload);
            const isLegacyPingArtifact =
              row.threadType === 'direct' &&
              row.isPayload &&
              payload.online === true &&
              payloadKeys.length === 1;
            if (isLegacyPingArtifact) {
              return [];
            }
            const type = deriveMessageTypeFromHydration(row, payload);
            const requestId = row.threadId.startsWith('req:') ? row.threadId.slice(4) : '';
            const txIdFromThread = row.threadId.startsWith('tx:') ? row.threadId.slice(3) : '';
            const txIdFromPayload = typeof payload.txId === 'string' ? payload.txId : '';
            const txId = txIdFromThread || txIdFromPayload;
            const traceId = typeof payload.traceId === 'string' ? payload.traceId.trim() : '';
            const invoiceThreadKey = row.threadType === 'cosign' ? row.threadId : undefined;
            const status = deriveMessageStatus(type, row.status);

            if (requestId) byRequest.set(requestId, row.threadId);
            if (txId) byTx.set(txId, row.threadId);
            if (txId && traceId) byTxTrace.set(`${txId}::${traceId}`, row.threadId);

            return [{
              id: `db:${row.messageId}`,
              type,
              invoiceThreadKey,
              status,
              txId: txId || undefined,
              mode: type === 'CHAT_MESSAGE' ? undefined : 'legacy',
              nip46RequestId: requestId || undefined,
              senderFingerprint: fingerprintFromNpub(row.senderNpub),
              senderNpub: row.senderNpub,
              senderLabel: row.senderNpub ? `${row.senderNpub.slice(0, 8)}...` : 'Unknown',
              timestamp: row.timestamp,
              payload,
            } as ChatFeedItem];
          });

          hydrated.forEach(item => {
            if (item.type !== 'COSIGN_REQUEST') return;
            const identity = coSignRequestIdentity({
              nip46RequestId: item.nip46RequestId,
              txId: item.txId,
              eventId: item.id,
              envelopeId: item.id,
              fallbackSeed: item.id,
            });
            seen.add(identity);
          });

          seenCoSignRequestIdsRef.current = seen;
          invoiceThreadKeyByRequestIdRef.current = byRequest;
          invoiceThreadKeyByTxIdRef.current = byTx;
          invoiceThreadKeyByTxTraceRef.current = byTxTrace;
          setMessages(hydrated.slice(0, 200));
        }

        await nostrMessaging.connect();
        refreshUnreadCounts();

        const meta = await getKeyshareMetadata();
        const metaRecord = (meta || {}) as Record<string, unknown>;
        const localNpub = normalizeNpub(nostrMessaging.getLocalNpub());
        const localPartyKey = normalizeNpub(meta?.local_party_key);
        const localMetaNpub = normalizeNpub(meta?.nostr_npub);
        const localCandidates = new Set(
          [localNpub, localPartyKey, localMetaNpub].filter(Boolean),
        );

        const committee = Array.isArray(meta?.keygen_committee_keys)
          ? meta.keygen_committee_keys
              .map((k: unknown) => normalizeNpub(k))
              .filter(Boolean)
          : [];

        const uniqueCommittee = Array.from(new Set(committee));
        const effectiveCommitteeSize = uniqueCommittee.length || 1;
        const threshold = deriveThreshold(metaRecord, effectiveCommitteeSize);

        const uniqueRemotePeers = Array.from(
          new Set(uniqueCommittee.filter(npub => !localCandidates.has(npub))),
        );

        if (mounted) {
          setCommitteeSize(effectiveCommitteeSize);
          setSigningThreshold(threshold);
          setProvisionedKeyshareCount(uniqueRemotePeers.length);
          setPeers(
            uniqueRemotePeers.map(npub => {
              const committeeIndex = uniqueCommittee.indexOf(npub);
              const slotIndex = committeeIndex >= 0 ? committeeIndex + 1 : 0;
              const slotLabel = slotIndex > 0 ? `S${slotIndex}` : 'S?';
              const labelSuffix = slotIndex > 0 ? slotIndex : npub.slice(0, 6);
              return {
                npub,
                label: `Keyshare ${labelSuffix}`,
                slotLabel,
                slotIndex,
                isOnline: false,
                lastPingAt: 0,
              };
            }),
          );
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void boot();

    const offState = nostrMessaging.onConnectionStateChange(next => {
      if (mounted) setState(next);
    });

    const ticker = setInterval(() => {
      if (!mounted) return;
      const ts = Date.now();
      setPeers(prev =>
        prev.map(peer => ({
          ...peer,
          isOnline: peer.lastPingAt > 0 && ts - peer.lastPingAt <= PEER_ONLINE_WINDOW_MS,
        })),
      );
    }, 10000);

    const offMsg = nostrMessaging.onMessage(msg => {
      if (!mounted) return;

      const senderNpub = normalizeNpub(msg.senderNpub);
      const senderPeer = peersRef.current.find(peer => peer.npub === senderNpub);

      if (msg.envelope.type === 'DEVICE_PING') {
        if (senderPeer) {
          const ts = Date.now();
          setPeers(prev =>
            prev.map(peer =>
              peer.npub === senderNpub
                ? { ...peer, lastPingAt: ts, isOnline: true }
                : peer,
            ),
          );
        }
        return;
      }

      if (
        msg.envelope.type !== 'CHAT_MESSAGE' &&
        msg.envelope.type !== 'COSIGN_REQUEST' &&
        msg.envelope.type !== 'COSIGN_RESPONSE'
      ) {
        return;
      }

      const parsed = parsePayload(msg.envelope.payload);

      if (msg.envelope.type === 'COSIGN_RESPONSE') {
        const response = parsed as Record<string, unknown>;
        const responseRequestId =
          typeof response.nip46RequestId === 'string' ? response.nip46RequestId : undefined;
        const txId = typeof response.txId === 'string' ? response.txId : '';
        const traceId = typeof response.traceId === 'string' ? response.traceId : undefined;
        const invoiceThreadKey =
          resolveExistingInvoiceThreadKey(responseRequestId, txId, traceId) ||
          registerInvoiceThreadKey({
            requestId: responseRequestId,
            txId,
            traceId,
            senderNpub,
            timestamp: Number(msg.envelope.timestamp || Date.now()),
            fallbackIdentity: messageIdentity(msg),
          });
        const approved = !!response.approved;
        const hasBroadcastTxId = typeof response.broadcastTxId === 'string' && response.broadcastTxId.trim().length > 0;
        const responseStatus: ChatFeedItem['status'] = approved
          ? (hasBroadcastTxId ? 'broadcasted' : 'signed')
          : 'rejected';
        if (txId) {
          DeviceEventEmitter.emit('nostr-cosign:status', {
            mode: 'legacy',
            txId,
            status: responseStatus,
          });
        }

        setMessages(prev =>
          prev.map(item => {
            if (item.type !== 'COSIGN_REQUEST') return item;
            if (item.invoiceThreadKey !== invoiceThreadKey) return item;
            return {
              ...item,
              status: responseStatus,
            };
          }),
        );

        const responseThreadStatus: ChatThreadStatus = approved ? 'approved' : 'closed';
        chatRepository.setThreadStatus(
          invoiceThreadKey,
          responseThreadStatus,
          Date.now(),
        );

        const senderLabel = senderPeer?.label || `${senderNpub.slice(0, 8)}...`;
        const responseItem: ChatFeedItem = {
          id: messageRenderKey(msg),
          type: 'COSIGN_RESPONSE',
          invoiceThreadKey,
          nip46RequestId: responseRequestId,
          txId,
          senderFingerprint: msg.envelope.senderFingerprint,
          senderNpub,
          senderLabel,
          timestamp: Number(msg.envelope.timestamp || Date.now()),
          payload: parsed,
          sourceMessage: msg,
        };

        setMessages(prev => {
          const incomingIdentity = messageIdentity(msg);
          const hasSame = prev.some(item => {
            if (!item.sourceMessage) return false;
            return messageIdentity(item.sourceMessage) === incomingIdentity;
          });
          if (hasSame) {
            return prev;
          }
          return [responseItem, ...prev].slice(0, 200);
        });
        return;
      }

      const senderLabel = senderPeer?.label || `${senderNpub.slice(0, 8)}...`;

      if (msg.envelope.type === 'COSIGN_REQUEST') {
        const requestId =
          typeof parsed.nip46RequestId === 'string' ? parsed.nip46RequestId : undefined;
        const txId = typeof parsed.txId === 'string' ? parsed.txId : undefined;
        const identity = coSignRequestIdentity({
          nip46RequestId: requestId,
          txId,
          eventId: msg.eventId,
          envelopeId: msg.envelope.id,
          fallbackSeed: messageIdentity(msg),
        });
        if (seenCoSignRequestIdsRef.current.has(identity)) return;
        seenCoSignRequestIdsRef.current.add(identity);
      }

      const requestId =
        msg.envelope.type === 'COSIGN_REQUEST' && typeof parsed.nip46RequestId === 'string'
          ? parsed.nip46RequestId
          : undefined;
      const txId = typeof parsed.txId === 'string' ? parsed.txId : undefined;
      const traceId =
        msg.envelope.type === 'COSIGN_REQUEST' && typeof parsed.traceId === 'string'
          ? parsed.traceId
          : undefined;
      const invoiceThreadKey =
        msg.envelope.type === 'COSIGN_REQUEST'
          ? registerInvoiceThreadKey({
              requestId,
              txId,
              traceId,
              senderNpub,
              timestamp: Number(msg.envelope.timestamp || Date.now()),
              fallbackIdentity: messageIdentity(msg),
            })
          : msg.envelope.type === 'CHAT_MESSAGE'
          ? resolveExistingInvoiceThreadKey(
              typeof parsed.nip46RequestId === 'string' ? parsed.nip46RequestId : undefined,
              txId,
              typeof parsed.traceId === 'string' ? parsed.traceId : undefined,
            )
          : undefined;

      const feedItem: ChatFeedItem = {
        id: messageRenderKey(msg),
        type: msg.envelope.type,
        invoiceThreadKey,
        status: msg.envelope.type === 'COSIGN_REQUEST' ? 'pending' : undefined,
        txId,
        nip46RequestId: requestId,
        senderFingerprint: msg.envelope.senderFingerprint,
        senderNpub,
        senderLabel,
        timestamp: Number(msg.envelope.timestamp || Date.now()),
        payload: parsed,
        sourceMessage: msg,
      };

      setMessages(prev => {
        const incomingIdentity = messageIdentity(msg);
        const hasSame = prev.some(item => {
          if (!item.sourceMessage) return false;
          return messageIdentity(item.sourceMessage) === incomingIdentity;
        });
        if (hasSame) {
          return prev;
        }
        return [feedItem, ...prev].slice(0, 200);
      });

      if (msg.envelope.type === 'CHAT_MESSAGE' || msg.envelope.type === 'COSIGN_REQUEST') {
        DeviceEventEmitter.emit('nostr-chat:incoming', {
          type: msg.envelope.type,
          mode: msg.envelope.type === 'COSIGN_REQUEST' ? 'legacy' : 'chat',
          ts: Date.now(),
        });
      }
    });

    const handleCoSignFeedEvent = (raw: CoSignFeedBridgeEvent) => {
      if (!mounted || !raw || typeof raw !== 'object') return;

      const senderNpub = normalizeNpub(raw.senderNpub);
      if (!senderNpub) return;

      const senderPeer = peersRef.current.find(peer => peer.npub === senderNpub);
      const senderLabel = senderPeer?.label || `${senderNpub.slice(0, 8)}...`;
      const payload = parsePayload(raw.request || {});

      const identity = coSignRequestIdentity({
        nip46RequestId: typeof raw.nip46RequestId === 'string' ? raw.nip46RequestId : undefined,
        txId: typeof payload.txId === 'string' ? payload.txId : undefined,
        eventId: typeof raw.eventId === 'string' ? raw.eventId : undefined,
        envelopeId: typeof raw.envelopeId === 'string' ? raw.envelopeId : undefined,
        fallbackSeed: `${senderNpub}:${raw.ts || Date.now()}`,
      });
      if (seenCoSignRequestIdsRef.current.has(identity)) return;
      seenCoSignRequestIdsRef.current.add(identity);

      const invoiceThreadKey = registerInvoiceThreadKey({
        requestId: typeof raw.nip46RequestId === 'string' ? raw.nip46RequestId : undefined,
        txId: typeof payload.txId === 'string' ? payload.txId : undefined,
        traceId: typeof payload.traceId === 'string' ? payload.traceId : undefined,
        senderNpub,
        timestamp: Number(raw.ts || Date.now()),
        fallbackIdentity: identity,
      });

      const feedItem: ChatFeedItem = {
        id: `bridge-cosign:${identity}`,
        type: 'COSIGN_REQUEST',
        invoiceThreadKey,
        status: 'pending',
        txId: typeof payload.txId === 'string' ? payload.txId : undefined,
        mode: raw.mode === 'nip46' ? 'nip46' : 'legacy',
        nip46RequestId:
          typeof raw.nip46RequestId === 'string' ? raw.nip46RequestId : undefined,
        nip46ReplyTo: typeof raw.nip46ReplyTo === 'string' ? raw.nip46ReplyTo : undefined,
        senderFingerprint:
          typeof raw.senderFingerprint === 'string'
            ? raw.senderFingerprint
            : fingerprintFromNpub(senderNpub),
        senderNpub,
        senderLabel,
        timestamp: Number(raw.ts || Date.now()),
        payload,
      };

      setMessages(prev => {
        if (prev.some(item => item.id === feedItem.id)) return prev;
        return [feedItem, ...prev].slice(0, 200);
      });
    };

    const offBridgeCoSign = DeviceEventEmitter.addListener(
      'nostr-cosign:request',
      handleCoSignFeedEvent,
    );

    const handleUnreadChatEvent = (evt: IncomingChatEvent) => {
      if (!mounted || !evt || typeof evt !== 'object') return;
      console.log('[NIP46-TLM][UI] Chat component received incoming event:', evt?.parsedMessage || evt);

      if (evt.type !== 'COSIGN_REQUEST') return;
      const parsedMessage = evt.parsedMessage;
      if (!parsedMessage || typeof parsedMessage !== 'object') return;

      const senderNpub = normalizeNpub(parsedMessage.senderNpub);
      if (!senderNpub) return;

      const payload = parsePayload(parsedMessage.request || {});
      const senderPeer = peersRef.current.find(peer => peer.npub === senderNpub);
      const senderLabel = senderPeer?.label || `${senderNpub.slice(0, 8)}...`;

      const identity = coSignRequestIdentity({
        nip46RequestId:
          typeof parsedMessage.nip46RequestId === 'string' ? parsedMessage.nip46RequestId : undefined,
        txId: typeof payload.txId === 'string' ? payload.txId : undefined,
        eventId: typeof parsedMessage.eventId === 'string' ? parsedMessage.eventId : undefined,
        envelopeId: typeof evt.requestId === 'string' ? evt.requestId : undefined,
        fallbackSeed: `${senderNpub}:${evt.ts || Date.now()}`,
      });
      if (seenCoSignRequestIdsRef.current.has(identity)) return;
      seenCoSignRequestIdsRef.current.add(identity);

      const invoiceThreadKey = registerInvoiceThreadKey({
        requestId:
          typeof parsedMessage.nip46RequestId === 'string' ? parsedMessage.nip46RequestId : undefined,
        txId: typeof payload.txId === 'string' ? payload.txId : undefined,
        traceId: typeof payload.traceId === 'string' ? payload.traceId : undefined,
        senderNpub,
        timestamp: Number(evt.ts || Date.now()),
        fallbackIdentity: identity,
      });

      const feedItem: ChatFeedItem = {
        id: `chat-incoming:${identity}`,
        type: 'COSIGN_REQUEST',
        invoiceThreadKey,
        status: 'pending',
        txId: typeof payload.txId === 'string' ? payload.txId : undefined,
        mode: evt.mode === 'nip46' ? 'nip46' : 'legacy',
        nip46RequestId:
          typeof parsedMessage.nip46RequestId === 'string'
            ? parsedMessage.nip46RequestId
            : undefined,
        nip46ReplyTo:
          typeof parsedMessage.nip46ReplyTo === 'string'
            ? parsedMessage.nip46ReplyTo
            : undefined,
        senderFingerprint:
          typeof parsedMessage.senderFingerprint === 'string'
            ? parsedMessage.senderFingerprint
            : fingerprintFromNpub(senderNpub),
        senderNpub,
        senderLabel,
        timestamp: Number(evt.ts || Date.now()),
        payload,
      };

      setMessages(prev => {
        if (prev.some(item => item.id === feedItem.id)) return prev;
        return [feedItem, ...prev].slice(0, 200);
      });
    };

    const offIncomingChat = DeviceEventEmitter.addListener(
      'nostr-chat:incoming',
      handleUnreadChatEvent,
    );

    const offUnreadChanged = DeviceEventEmitter.addListener(
      'chat:unread-changed',
      () => {
        if (!mounted) return;
        refreshUnreadCounts();
      },
    );

    // Replay anything NostrCoSignBridge emitted while this screen wasn't mounted to
    // catch it (e.g. the Chat tab hadn't been visited yet), so cards appear on first
    // mount instead of requiring a manual refresh to notice a missed local event.
    getRecentCoSignFeedEvents().forEach(evt =>
      handleCoSignFeedEvent(evt as CoSignFeedBridgeEvent),
    );
    getRecentUnreadChatEvents().forEach(evt =>
      handleUnreadChatEvent(evt as IncomingChatEvent),
    );

    const offFocus = DeviceEventEmitter.addListener(
      'nostr-cosign:focus',
      (evt: { txId?: string; openRequest?: boolean }) => {
        if (!mounted || !evt?.txId) return;
        pendingFocusTxIdRef.current = evt.txId;
        pendingFocusOpenRequestRef.current = evt.openRequest !== false;
      },
    );
    // A notification tap may have fired before this screen (re)mounted; replay it too.
    getRecentCoSignFocusEvents().forEach(evt => {
      const txId = (evt as { txId?: string; openRequest?: boolean }).txId;
      const openRequest = (evt as { openRequest?: boolean }).openRequest !== false;
      if (txId) {
        pendingFocusTxIdRef.current = txId;
        pendingFocusOpenRequestRef.current = openRequest;
      }
    });

    const offCoSignStatus = DeviceEventEmitter.addListener(
      'nostr-cosign:status',
      (evt: CoSignStatusEvent) => {
        if (!mounted || !evt || typeof evt !== 'object') return;
        const nextStatus =
          evt.status === 'signed' ||
          evt.status === 'broadcasted' ||
          evt.status === 'rejected' ||
          evt.status === 'signing'
            ? evt.status
            : 'pending';

        const invoiceKey = resolveExistingInvoiceThreadKey(evt.requestId, evt.txId);

        setMessages(prev =>
          prev.map(item => {
            if (item.type !== 'COSIGN_REQUEST') return item;
            const reqMatch =
              evt.requestId && item.nip46RequestId && evt.requestId === item.nip46RequestId;
            const txMatch = evt.txId && item.txId && evt.txId === item.txId;
            const invoiceMatch = !!invoiceKey && item.invoiceThreadKey === invoiceKey;
            if (!reqMatch && !txMatch && !invoiceMatch) return item;
            return {
              ...item,
              status: nextStatus,
            };
          }),
        );

        if (invoiceKey) {
          const threadStatus: ChatThreadStatus =
            nextStatus === 'rejected'
              ? 'closed'
              : nextStatus === 'pending' || nextStatus === 'signing'
              ? 'pending'
              : 'approved';
          chatRepository.setThreadStatus(invoiceKey, threadStatus, Date.now());
        }
      },
    );

    const offMpcState = DeviceEventEmitter.addListener(
      'nostr-mpc:state',
      (evt: NostrMpcStateEvent) => {
        if (!mounted || !evt || typeof evt !== 'object') return;
        const txId = typeof evt.txId === 'string' ? evt.txId : '';
        if (!txId) return;

        const nextStatus: ChatFeedItem['status'] =
          evt.state === 'computing_nonces' || evt.state === 'signing'
            ? 'signing'
            : evt.state === 'broadcasting'
            ? 'signed'
            : evt.state === 'completed'
            ? 'broadcasted'
            : evt.state === 'failed'
            ? 'rejected'
            : 'pending';

        setMessages(prev =>
          prev.map(item => {
            if (item.type !== 'COSIGN_REQUEST') return item;
            if (item.txId !== txId) return item;
            return {
              ...item,
              status: nextStatus,
            };
          }),
        );

        const invoiceKey = resolveExistingInvoiceThreadKey(undefined, txId);
        if (invoiceKey) {
          const threadStatus: ChatThreadStatus =
            nextStatus === 'rejected'
              ? 'closed'
              : nextStatus === 'pending' || nextStatus === 'signing'
              ? 'pending'
              : 'approved';
          chatRepository.setThreadStatus(invoiceKey, threadStatus, Date.now());
        }
      },
    );

    return () => {
      mounted = false;
      clearInterval(ticker);
      offState();
      offMsg();
      offBridgeCoSign.remove();
      offIncomingChat.remove();
      offUnreadChanged.remove();
      offFocus.remove();
      offCoSignStatus.remove();
      offMpcState.remove();
    };
  }, []);

  useEffect(() => {
    if (!isFocused || !activeChatId) return;
    const threadId = threadIdFromChatId(activeChatId);
    if (!threadId) return;
    chatRepository.markThreadAsRead(threadId);
    refreshUnreadCounts();
  }, [activeChatId, isFocused]);

  const localNpub = normalizeNpub(nostrMessaging.getLocalNpub());
  const localFingerprint = useMemo(
    () => fingerprintFromNpub(localNpub),
    [localNpub, state],
  );

  const recipientNpubs = useMemo(
    () => peers.map(peer => peer.npub).filter(Boolean),
    [peers],
  );

  const peerMap = useMemo(() => {
    const map = new Map<string, PeerState>();
    peers.forEach(peer => {
      map.set(peer.npub, peer);
    });
    return map;
  }, [peers]);

  const activePeerNpubs = useMemo(() => {
    const activeFromPings = peers.filter(peer => peer.isOnline).map(peer => peer.npub);
    const activeFromInvoices = new Set(
      messages
        .filter(
          item =>
            item.type === 'COSIGN_REQUEST' &&
            item.status !== 'signed' &&
            item.status !== 'broadcasted' &&
            item.status !== 'rejected',
        )
        .map(item => item.senderNpub)
        .filter(Boolean),
    );

    const merged = Array.from(new Set([...activeFromPings, ...activeFromInvoices]));
    const strictLimit = provisionedKeyshareCount > 0 ? provisionedKeyshareCount : peers.length;
    return merged.slice(0, strictLimit);
  }, [messages, peers, provisionedKeyshareCount]);

  const activePeers = useMemo(() => {
    const byNpub = new Map(peers.map(peer => [peer.npub, peer]));
    return activePeerNpubs.map(npub => {
      const known = byNpub.get(npub);
      if (known) return known;

      const latest = messages.find(item => item.senderNpub === npub);
      const fallbackLabel = latest?.senderLabel || `${npub.slice(0, 8)}...`;
      return {
        npub,
        label: fallbackLabel,
        slotLabel: 'S?',
        slotIndex: 0,
        isOnline: false,
        lastPingAt: latest?.timestamp || 0,
      };
    });
  }, [activePeerNpubs, messages, peers]);

  const peerThreads = useMemo<ThreadSummary[]>(() => {
    const rows: ThreadSummary[] = activePeers.map(peer => {
      const chatItems = messages
        .filter(item => item.senderNpub === peer.npub && item.type === 'CHAT_MESSAGE')
        .sort((a, b) => b.timestamp - a.timestamp);
      const latestChat = chatItems[0];
      const threadId = `peer:${peer.npub}`;

      return {
        id: `peer-thread:${peer.npub}`,
        chatId: `peer:${peer.npub}`,
        kind: 'peer',
        npub: peer.npub,
        title: peer.label,
        preview: latestChat ? payloadText(latestChat.payload) : 'Tap to start encrypted chat.',
        timestamp: latestChat?.timestamp || peer.lastPingAt || 0,
        unreadCount: unreadByThread[threadId] || 0,
        pinned: false,
        online: peer.isOnline,
        lastItem: latestChat,
      };
    });

    return rows.sort((a, b) => b.timestamp - a.timestamp);
  }, [activePeers, messages, unreadByThread]);

  const invoiceThreads = useMemo<ThreadSummary[]>(() => {
    const grouped = new Map<string, ChatFeedItem[]>();
    messages
      .filter(item => {
        if (item.type === 'COSIGN_REQUEST' || item.type === 'COSIGN_RESPONSE') return true;
        if (item.type !== 'CHAT_MESSAGE') return false;
        return !!item.invoiceThreadKey || !!invoiceThreadKeyFromPayload(item.payload);
      })
      .forEach(item => {
        const key =
          item.invoiceThreadKey ||
          (item.type === 'CHAT_MESSAGE'
            ? invoiceThreadKeyFromPayload(item.payload)
            : invoiceThreadKeyForItem(item));
        if (!key) return;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)?.push(item);
      });

    const rows: ThreadSummary[] = Array.from(grouped.entries()).map(([invoiceKey, items]) => {
      const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp);
      const latest = sorted[0];
      const requestItem = sorted.find(item => item.type === 'COSIGN_REQUEST');
      const responseItems = sorted.filter(item => item.type === 'COSIGN_RESPONSE');
      const peer = peerMap.get(latest.senderNpub);
      const title = requestItem?.txId
        ? coSignThreadTitle(requestItem, invoiceKey)
        : coSignThreadTitle(requestItem, invoiceKey);
      const pendingCount = sorted.filter(
        item =>
          item.type === 'COSIGN_REQUEST' &&
          item.status !== 'signed' &&
          item.status !== 'broadcasted' &&
          item.status !== 'rejected',
      ).length;
      const latestPreview = coSignThreadPreview(latest);
      const respondedSigners = new Set(responseItems.map(item => item.senderNpub).filter(Boolean));
      const approvedSigners = new Set(
        responseItems
          .filter(item => !!item.payload?.approved)
          .map(item => item.senderNpub)
          .filter(Boolean),
      );
      const requiredApprovals = Math.max(signingThreshold || 1, 1);
      const approvedCount = approvedSigners.size;
      const thresholdProgress = `${approvedCount}/${requiredApprovals} approvals`;
      const thresholdProgressState: ThreadSummary['thresholdProgressState'] =
        approvedCount <= 0
          ? 'none'
          : approvedCount >= requiredApprovals
          ? 'met'
          : 'partial';

      return {
        id: `invoice-thread:${invoiceKey}`,
        chatId: `invoice:${invoiceKey}`,
        kind: 'invoice',
        npub: latest.senderNpub,
        title,
        preview: latestPreview,
        timestamp: latest.timestamp,
        unreadCount: unreadByThread[invoiceKey] || 0,
        pinned: pendingCount > 0,
        online: peer?.isOnline ?? false,
        thresholdProgress,
        thresholdProgressState,
        invoiceKey,
        lastItem: latest,
        openItem: requestItem,
      };
    });

    return rows.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.timestamp - a.timestamp;
    });
  }, [messages, peerMap, signingThreshold, unreadByThread]);

  const threads = useMemo<ThreadSummary[]>(() => {
    const all = [...invoiceThreads, ...peerThreads];
    return all.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.timestamp - a.timestamp;
    });
  }, [invoiceThreads, peerThreads]);

  const selectedThread = useMemo(
    () => threads.find(thread => thread.chatId === activeChatId),
    [activeChatId, threads],
  );

  const selectedPeerNpub = useMemo(() => {
    return selectedThread?.npub || '';
  }, [selectedThread]);

  useEffect(() => {
    if (!activeChatId) return;
    if (threads.some(thread => thread.chatId === activeChatId)) return;
    setActiveChatId('');
  }, [activeChatId, threads]);

  const visibleMessages = useMemo(() => {
    if (!activeChatId) return [];

    if (activeChatId.startsWith('peer:')) {
      const peerNpub = activeChatId.slice('peer:'.length);
      return messages.filter(item => {
        const mine =
          item.senderFingerprint === localFingerprint ||
          (!!item.senderNpub && item.senderNpub === localNpub);
        if (item.type !== 'CHAT_MESSAGE') return false;
        return item.senderNpub === peerNpub || mine;
      });
    }

    if (activeChatId.startsWith('invoice:')) {
      const invoiceKey = activeChatId.slice('invoice:'.length);
      return messages.filter(item => {
        const key = item.invoiceThreadKey || invoiceThreadKeyForItem(item);
        if (key === invoiceKey && (item.type === 'COSIGN_REQUEST' || item.type === 'COSIGN_RESPONSE')) {
          return true;
        }
        if (item.type !== 'CHAT_MESSAGE') return false;
        return (item.invoiceThreadKey || invoiceThreadKeyFromPayload(item.payload)) === invoiceKey;
      });
    }

    return messages;
  }, [activeChatId, localFingerprint, localNpub, messages]);

  const openThreadRow = (thread: ThreadSummary) => {
    setError('');
    setActiveChatId(thread.chatId);
    const threadId = thread.kind === 'invoice' ? thread.invoiceKey || '' : `peer:${thread.npub}`;
    if (threadId) {
      chatRepository.markThreadAsRead(threadId);
      refreshUnreadCounts();
    }
    dbg('[KeyshareChat] activeChatId set from thread tap', {
      chatId: thread.chatId,
      kind: thread.kind,
      npub: thread.npub,
    });
  };

  const pingAllPeers = async () => {
    if (recipientNpubs.length === 0) {
      setError('No remote keyshares found for this wallet.');
      return;
    }

    setError('');
    try {
      await nostrMessaging.sendEnvelope(recipientNpubs, {
        id: `ping-${Date.now()}`,
        type: 'DEVICE_PING',
        senderFingerprint: localFingerprint,
        recipientFingerprint: 'peer-group',
        timestamp: Date.now(),
        payload: { online: true },
      });
    } catch (err) {
      dbg('KeyshareChat: ping all failed', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const sendChat = async () => {
    if (!text.trim()) return;
    if (!selectedThread || !selectedPeerNpub) {
      setError('Open a conversation first.');
      return;
    }
    const activeRecipientNpubs = [selectedPeerNpub];
    if (activeRecipientNpubs.length === 0) {
      setError('No remote keyshares found for this wallet.');
      return;
    }

    setError('');
    const outgoingText = text.trim();
    const outgoingPayload: Record<string, unknown> = { text: outgoingText };
    const now = Date.now();

    if (selectedThread?.kind === 'invoice') {
      const invoiceKey = selectedThread.invoiceKey || '';
      const requestId = invoiceKey.startsWith('req:') ? invoiceKey.slice(4) : '';
      const txFromKey = invoiceKey.startsWith('tx:') ? invoiceKey.slice(3) : '';
      const txId = selectedThread.openItem?.txId || txFromKey;
      if (requestId) outgoingPayload.nip46RequestId = requestId;
      if (txId) outgoingPayload.txId = txId;
      outgoingPayload.threadType = 'invoice';
    }

    const threadId =
      selectedThread.kind === 'invoice'
        ? selectedThread.invoiceKey || `tx:${String(outgoingPayload.txId || now)}`
        : `peer:${selectedPeerNpub}`;
    const threadStatus: ChatThreadStatus =
      selectedThread.kind === 'invoice' ? 'pending' : 'approved';
    const localMessageId = `local-chat:${now}:${Math.random().toString(36).slice(2, 10)}`;

    chatRepository.upsertThreadAndMessage(
      {
        threadId,
        peerNpub: selectedPeerNpub,
        threadType: selectedThread.kind === 'invoice' ? 'cosign' : 'direct',
        status: threadStatus,
        createdAt: now,
        updatedAt: now,
      },
      {
        messageId: localMessageId,
        threadId,
        senderNpub: localNpub || 'local',
        content:
          selectedThread.kind === 'invoice'
            ? JSON.stringify(outgoingPayload)
            : outgoingText,
        timestamp: now,
        isPayload: selectedThread.kind === 'invoice',
        isRead: true,
      },
    );

    try {
      await nostrMessaging.sendEnvelope(activeRecipientNpubs, {
        id: `chat-${Date.now()}`,
        type: 'CHAT_MESSAGE',
        senderFingerprint: localFingerprint,
        recipientFingerprint: 'peer-group',
        timestamp: Date.now(),
        payload: outgoingPayload,
      });

      const optimisticMessage: ChatFeedItem = {
        id: `optimistic:${localMessageId}`,
        type: 'CHAT_MESSAGE',
        invoiceThreadKey: selectedThread.kind === 'invoice' ? selectedThread.invoiceKey : undefined,
        senderFingerprint: localFingerprint,
        senderNpub: localNpub,
        senderLabel: 'You',
        timestamp: now,
        payload: outgoingPayload,
      };

      setMessages(prev => [optimisticMessage, ...prev].slice(0, 200));

      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openCoSignRequest = (item: ChatFeedItem) => {
    console.log('[NIP46-TLM][UI] openCoSignRequest invoked', {
      itemId: item.id,
      status: item.status,
      mode: item.mode,
      hasPayloadTxId: Boolean((item.payload as any)?.txId),
      senderNpub: item.senderNpub,
      timestamp: item.timestamp,
    });
    if (
      item.status === 'signed' ||
      item.status === 'broadcasted' ||
      item.status === 'rejected'
    ) {
      console.log('[NIP46-TLM][UI] openCoSignRequest ignored due to terminal status', {
        itemId: item.id,
        status: item.status,
      });
      return;
    }

    const isSender = !!localNpub && item.senderNpub === localNpub;
    if (isSender) {
      const payload = item.payload as unknown as CoSignRequestPayload;
      const amountSatsNum = Number(payload.amountSats);
      const hasRegularSendShape =
        typeof payload.recipientAddress === 'string' &&
        payload.recipientAddress.trim() !== '' &&
        payload.recipientAddress !== 'N/A' &&
        Number.isFinite(amountSatsNum) &&
        amountSatsNum > 0;
      const isRegularSendRequest =
        payload.requestMode === 'dkls'
          ? hasRegularSendShape
          : !payload.psbtBase64 && !payload.psbtHex && hasRegularSendShape;

      if (!isRegularSendRequest) {
        dbg('[NIP46-TLM][UI] blocked self-review action for non-send request', {
          itemId: item.id,
          txId: item.txId,
        });
        return;
      }

      if (item.status !== 'signing') {
        setError('Waiting for peer approval. Keep chatting until peer taps Review & Sign.');
        dbg('[NIP46-TLM][UI] sender tapped outgoing request before peer approval', {
          itemId: item.id,
          txId: payload.txId,
          status: item.status,
        });
        return;
      }

      const peerNpub = resolvePeerFromSigningCsv(
        payload as unknown as Record<string, unknown>,
        localNpub,
      );

      navigation.navigate('Nostr Connect', {
        mode: 'send_btc',
        toAddress: payload.recipientAddress,
        satoshiAmount: String(Math.trunc(amountSatsNum)),
        satoshiFees: String(
          Math.max(0, Math.trunc(Number(payload.feeSats) || 0)),
        ),
        network: payload.network || 'mainnet',
        initiatorTxId: payload.txId,
        cosignTraceId: payload.traceId,
        utxosJson:
          typeof payload.utxosJson === 'string' ? payload.utxosJson : undefined,
        changeAddress:
          typeof payload.changeAddress === 'string'
            ? payload.changeAddress
            : undefined,
        addressType:
          typeof payload.senderAddressType === 'string'
            ? payload.senderAddressType
            : undefined,
        derivationPath:
          typeof payload.senderDerivationPath === 'string'
            ? payload.senderDerivationPath
            : undefined,
        peerNpub: peerNpub || undefined,
        isPeerResponse: false,
        isInitiator: true,
        resumePendingRequest: true,
      });
      return;
    }

    const now = Date.now();
    if (now - lastCoSignOpenAtRef.current < 1200) {
      console.log('[NIP46-TLM][UI] openCoSignRequest throttled', {
        itemId: item.id,
        lastOpenAt: lastCoSignOpenAtRef.current,
        now,
      });
      return;
    }
    lastCoSignOpenAtRef.current = now;

    const msg = item.sourceMessage;

    const payload = item.payload as unknown as CoSignRequestPayload;
    if (!payload?.txId) {
      console.warn('[NIP46-TLM][UI] openCoSignRequest aborted: missing payload.txId', {
        itemId: item.id,
        payload,
      });
      return;
    }

    const psbtBase64 =
      typeof payload.psbtBase64 === 'string' && payload.psbtBase64
        ? payload.psbtBase64
        : typeof payload.psbtHex === 'string' && payload.psbtHex
        ? nostrMessaging.psbtHexToBase64(payload.psbtHex)
        : '';

    // "Regular" co-signing: a native BTC send fan-out (e.g. from MobileNostrPairing's
    // startSendBTC, or from a watch-only peer like the BoldChrome extension) carries no
    // PSBT at all — just recipient/amount/fee. Previously this always hit the PSBT-only
    // error below, so the peer never sent COSIGN_READY and the initiator always hung
    // until its 45s timeout. Recognize this shape and route it to the send_btc responder
    // flow instead of silently failing. `requestMode` is an explicit sender-chosen signal
    // (e.g. BoldChrome's DKLS/PSBT toggle) that takes priority over the implicit inference.
    const amountSatsNum = Number(payload.amountSats);
    const hasRegularSendShape =
      typeof payload.recipientAddress === 'string' &&
      payload.recipientAddress.trim() !== '' &&
      payload.recipientAddress !== 'N/A' &&
      Number.isFinite(amountSatsNum) &&
      amountSatsNum > 0;
    const isRegularSendRequest =
      payload.requestMode === 'dkls'
        ? hasRegularSendShape
        : !psbtBase64 && hasRegularSendShape;

    if (!psbtBase64 && !isRegularSendRequest) {
      console.warn('[NIP46-TLM][UI] openCoSignRequest aborted: no PSBT and not regular send shape', {
        itemId: item.id,
        txId: payload.txId,
        requestMode: payload.requestMode,
        recipientAddress: payload.recipientAddress,
        amountSats: payload.amountSats,
        feeSats: payload.feeSats,
      });
      setError('This co-sign request did not contain a usable PSBT payload.');
      return;
    }

    setMessages(prev =>
      prev.map(message =>
        message.id === item.id
          ? {
              ...message,
              status: 'signing',
            }
          : message,
      ),
    );

    const approvalThreadId =
      item.invoiceThreadKey ||
      (item.nip46RequestId ? `req:${item.nip46RequestId}` : item.txId ? `tx:${item.txId}` : `evt:${item.id}`);
    chatRepository.upsertThread({
      threadId: approvalThreadId,
      peerNpub: item.senderNpub || 'unknown',
      threadType: 'cosign',
      status: 'pending',
      createdAt: item.timestamp || Date.now(),
      updatedAt: Date.now(),
    });

    if (item.mode === 'nip46' && item.nip46RequestId) {
      setPendingCoSignRequest({
        mode: 'nip46',
        senderNpub: item.nip46ReplyTo || item.senderNpub,
        senderFingerprint: item.senderFingerprint || 'nip46-client',
        recipientFingerprint: 'nip46-signer',
        request: payload,
        envelopeId: item.id,
        receivedAt: Date.now(),
        nip46RequestId: item.nip46RequestId,
      });
    } else {
      // `item.sourceMessage` is only ever set by the direct onMessage listener path —
      // cards that won the dedup race via the bridge (`nostr-cosign:request` /
      // `nostr-chat:incoming`) never have it. Fall back to the fields already carried
      // on `item` itself so this doesn't silently no-op for that (common) case.
      setPendingCoSignRequest({
        mode: 'legacy',
        senderNpub: msg?.senderNpub || item.senderNpub,
        senderFingerprint: msg?.envelope.senderFingerprint || item.senderFingerprint,
        recipientFingerprint: msg?.envelope.recipientFingerprint || 'peer-group',
        request: payload,
        envelopeId: msg?.envelope.id || item.id,
        receivedAt: Date.now(),
      });
    }

    // Do not publish COSIGN_READY on card-open. Responder must review details first and
    // explicitly tap Start/Join in MobileNostrPairing; that tap now sends COSIGN_READY.
    const readyRecipientNpub =
      item.mode === 'nip46' ? item.nip46ReplyTo || item.senderNpub : msg?.senderNpub || item.senderNpub;

    dbg('[NIP46-TLM][KeyshareChat] opening co-sign request from feed', {
      mode: item.mode || 'legacy',
      requestId: item.nip46RequestId,
      senderNpub: item.senderNpub,
      isRegularSendRequest,
      psbtPrefix: psbtBase64.slice(0, 16),
      initiatorTxId: payload.txId,
      cosignTraceId: payload.traceId,
    });

    if (isRegularSendRequest) {
      dbg('[NIP46-TLM][UI] navigating responder to MobileNostrPairing (Nostr Connect stack route)', {
        txId: payload.txId,
        traceId: payload.traceId,
        peerNpub: (readyRecipientNpub || item.senderNpub || '').slice(0, 20),
        mode: 'send_btc',
      });
      navigation.navigate('Nostr Connect', {
        mode: 'send_btc',
        toAddress: payload.recipientAddress,
        satoshiAmount: String(Math.trunc(amountSatsNum)),
        satoshiFees: String(
          Math.max(0, Math.trunc(Number(payload.feeSats) || 0)),
        ),
        network: payload.network || 'mainnet',
        // Carry the initiator's txId/traceId so both devices' native signing
        // sessions and chat status updates correlate to the same request.
        initiatorTxId: payload.txId,
        cosignTraceId: payload.traceId,
        // Carry initiator-native transaction construction context so the
        // responder signs identical inputs/outputs for DKLS rounds.
        utxosJson:
          typeof payload.utxosJson === 'string' ? payload.utxosJson : undefined,
        changeAddress:
          typeof payload.changeAddress === 'string'
            ? payload.changeAddress
            : undefined,
        addressType:
          typeof payload.senderAddressType === 'string'
            ? payload.senderAddressType
            : undefined,
        derivationPath:
          typeof payload.senderDerivationPath === 'string'
            ? payload.senderDerivationPath
            : undefined,
        // We are responding to someone else's request, not originating one —
        // MobileNostrPairing must resolve its own addressType/derivationPath
        // locally and must not wait on its own COSIGN_READY.
        isPeerResponse: true,
        // Sender of the incoming COSIGN_REQUEST: for trio/committee wallets this
        // IS the co-signing peer for this round, so MobileNostrPairing can skip
        // manual peer selection. See [NIP46-TLM][Committee] logging there.
        peerNpub: readyRecipientNpub || item.senderNpub || undefined,
      });
      return;
    }

    navigation.navigate('MainTabs', {
      screen: 'PSBT',
      params: {
        sharedPsbtBase64: psbtBase64,
        nip46RequestId: item.nip46RequestId,
        nip46ReplyTo: item.nip46ReplyTo || item.senderNpub,
        autoSign: item.mode === 'nip46',
        // Carry the initiator's txId/traceId so both devices' native signing
        // sessions and chat status updates correlate to the same request.
        initiatorTxId: payload.txId,
        cosignTraceId: payload.traceId,
        // We are responding to someone else's request, not originating one —
        // PSBTScreen must not treat this device as the waiting initiator.
        isPeerResponse: true,
      },
    });
  };

  // Auto-open the co-sign view once the request a notification tap targeted actually
  // shows up in the feed (it may arrive slightly after the tap/navigation).
  useEffect(() => {
    const targetTxId = pendingFocusTxIdRef.current;
    if (!targetTxId) return;
    const match = messages.find(
      item => item.type === 'COSIGN_REQUEST' && item.txId === targetTxId && item.status === 'pending',
    );
    if (!match) return;
    pendingFocusTxIdRef.current = null;
    const openRequest = pendingFocusOpenRequestRef.current;
    pendingFocusOpenRequestRef.current = true;
    setActiveChatId(`invoice:${match.invoiceThreadKey || invoiceThreadKeyForItem(match)}`);
    if (openRequest) {
      openCoSignRequest(match);
    }
  }, [messages]);

  return (
    <KeyboardAvoidingView
      style={styles.keyboardWrap}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
    >
    <View style={styles.wrap}>
      <View style={styles.head}>
        <AppText style={styles.title}>Keyshare Chat</AppText>
        <AppText style={styles.status}>Relay {state}</AppText>
      </View>

      <View style={styles.peerHeaderRow}>
        <AppText style={styles.label}>
          Committee {signingThreshold || 1}-of-{committeeSize || Math.max(provisionedKeyshareCount + 1, 1)} | Active peers {activeKeyshareCount}/{provisionedKeyshareCount || peers.length}
        </AppText>
        <AppPressable onPress={pingAllPeers} style={styles.pingBtn}>
          <AppText style={styles.btnText}>Ping All</AppText>
        </AppPressable>
      </View>

      {selectedThread ? (
        <>
          <View style={styles.detailHeader}>
            <AppPressable style={styles.backBtn} onPress={() => setActiveChatId('')}>
              <AppText style={styles.backBtnText}>Back</AppText>
            </AppPressable>
            <View style={styles.detailTitleBlock}>
              <AppText style={styles.detailTitle} numberOfLines={1}>
                {selectedThread.title}
              </AppText>
              <AppText style={styles.activeThreadLabel}>
                {selectedThread.kind === 'invoice' ? 'Invoice thread' : 'Peer conversation'}
              </AppText>
            </View>
          </View>

          <ScrollView
            style={styles.history}
            contentContainerStyle={styles.historyInner}
            keyboardShouldPersistTaps="always"
          >
            {visibleMessages.length === 0 ? (
              <AppText style={styles.empty}>No messages yet.</AppText>
            ) : (
              visibleMessages.map(item => {
                const isMine =
                  item.senderFingerprint === localFingerprint ||
                  (!!item.senderNpub && item.senderNpub === localNpub);

                if (item.type === 'COSIGN_REQUEST') {
                  return (
                    <View key={item.id} style={styles.coSignBlock}>
                      {!isMine && <AppText style={styles.senderLabel}>{item.senderLabel}</AppText>}
                      <CoSignRequestCard
                        amountSats={Number(item.payload.amountSats || 0)}
                        feeSats={Number(item.payload.feeSats || 0)}
                        recipientAddress={String(item.payload.recipientAddress || '')}
                        timestamp={item.timestamp}
                        status={item.status || 'pending'}
                        isSender={isMine}
                        onReviewSign={() => {
                          console.log('[NIP46-TLM][UI] Review & Sign tapped from chat list', {
                            itemId: item.id,
                            mode: item.mode,
                            status: item.status,
                            senderNpub: item.senderNpub,
                            txId: (item.payload as any)?.txId,
                          });
                          openCoSignRequest(item);
                        }}
                      />
                    </View>
                  );
                }

                return (
                  <ChatBubble
                    key={item.id}
                    text={payloadText(item.payload)}
                    timestamp={item.timestamp}
                    isMine={isMine}
                    senderLabel={isMine ? undefined : item.senderLabel}
                  />
                );
              })
            )}
          </ScrollView>

          <View style={styles.composerRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              style={[styles.input, styles.composerInput]}
              multiline
              editable={true}
              numberOfLines={2}
              blurOnSubmit={false}
              placeholder="Type an encrypted message..."
              placeholderTextColor={theme.colors.textSecondary}
            />
            <AppPressable onPress={sendChat} style={styles.sendBtn}>
              <AppText style={styles.btnText}>Send</AppText>
            </AppPressable>
          </View>
        </>
      ) : (
        <View
          style={[
            styles.chatListWrap,
            threads.length <= 1 ? styles.chatListWrapCompact : null,
          ]}
        >
          {threads.length === 0 ? (
            <AppText style={styles.emptyList}>No conversations yet.</AppText>
          ) : (
            <FlatList
              data={threads}
              keyExtractor={(item: ThreadSummary) => item.id}
              keyboardShouldPersistTaps="always"
              scrollEnabled={threads.length > 1}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              renderItem={({ item }: { item: ThreadSummary }) => {
                const active = activeChatId === item.chatId;
                return (
                  <AppPressable
                    style={[styles.threadRow, active ? styles.threadRowActive : null]}
                    onPress={() => openThreadRow(item)}
                    hitSlop={6}
                    pressRetentionOffset={14}
                  >
                    <View style={styles.threadAvatarWrap}>
                      <View style={styles.threadAvatar}>
                        <AppText style={styles.threadAvatarText}>{item.title.slice(0, 2).toUpperCase()}</AppText>
                      </View>
                      <View style={[styles.threadOnlineDot, item.online ? styles.dotOnline : styles.dotOffline]} />
                    </View>

                    <View style={styles.threadMain}>
                      <View style={styles.threadTopLine}>
                        <AppText style={styles.threadTitle} numberOfLines={1}>
                          {item.title}
                        </AppText>
                        <AppText style={styles.threadTime}>{formatThreadClock(item.timestamp)}</AppText>
                      </View>

                      <View style={styles.threadBottomLine}>
                        <AppText style={styles.threadPreview} numberOfLines={1}>
                          {item.preview}
                        </AppText>
                        <View style={styles.threadBadges}>
                          {item.kind === 'invoice' ? (
                            <AppText
                              style={[
                                styles.progressBadge,
                                item.thresholdProgressState === 'met'
                                  ? styles.progressBadgeMet
                                  : item.thresholdProgressState === 'partial'
                                  ? styles.progressBadgePartial
                                  : styles.progressBadgeNone,
                              ]}
                            >
                              {item.thresholdProgress}
                            </AppText>
                          ) : null}
                          <AppText style={styles.slotBadge}>
                            {peerMap.get(item.npub)?.slotLabel || 'S?'}
                          </AppText>
                          {item.pinned ? <AppText style={styles.pinBadge}>PIN</AppText> : null}
                          {item.unreadCount > 0 ? (
                            <View style={styles.unreadBadge}>
                              <AppText style={styles.unreadBadgeText}>{item.unreadCount}</AppText>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  </AppPressable>
                );
              }}
            />
          )}
        </View>
      )}

      {error ? <AppText style={styles.error}>{error}</AppText> : null}
    </View>
    </KeyboardAvoidingView>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    keyboardWrap: {
      flex: 1,
    },
    wrap: {
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      borderRadius: 16,
      padding: 12,
      backgroundColor: '#10141d',
      gap: 8,
      flex: 1,
      minHeight: 0,
    },
    head: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: {
      fontSize: 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    status: {
      fontSize: 12,
      color: '#99a6b7',
    },
    label: {
      fontSize: 12,
      color: '#9aabc0',
    },
    peerHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    chatListWrap: {
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      borderRadius: 12,
      flex: 1,
      minHeight: 92,
      flexShrink: 0,
      paddingVertical: 4,
      backgroundColor: 'rgba(255,255,255,0.02)',
    },
    chatListWrapCompact: {
      maxHeight: 92,
    },
    emptyList: {
      color: '#97a6bb',
      fontSize: 12,
      textAlign: 'center',
      paddingVertical: 18,
    },
    threadRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 6,
      marginVertical: 3,
      padding: 10,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.02)',
    },
    threadRowActive: {
      backgroundColor: 'rgba(45,126,247,0.24)',
    },
    detailHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 2,
    },
    backBtn: {
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.16)',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: 'rgba(255,255,255,0.03)',
    },
    backBtnText: {
      color: '#dbe7f8',
      fontSize: 12,
      fontFamily: theme.fontFamilies?.bold,
    },
    detailTitleBlock: {
      flex: 1,
      minWidth: 0,
    },
    detailTitle: {
      color: '#f4f8ff',
      fontSize: 14,
      fontFamily: theme.fontFamilies?.bold,
    },
    threadAvatarWrap: {
      position: 'relative',
    },
    threadAvatar: {
      width: 44,
      height: 44,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#1b2535',
    },
    threadAvatarText: {
      color: '#ecf3ff',
      fontSize: 12,
      fontFamily: theme.fontFamilies?.bold,
    },
    threadOnlineDot: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 10,
      height: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: '#10141d',
    },
    threadMain: {
      flex: 1,
      gap: 3,
    },
    threadTopLine: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    threadBottomLine: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    threadTitle: {
      flex: 1,
      color: '#f4f8ff',
      fontSize: 14,
      fontFamily: theme.fontFamilies?.bold,
    },
    threadTime: {
      color: '#9ca9ba',
      fontSize: 11,
    },
    threadPreview: {
      flex: 1,
      color: '#bcc8d7',
      fontSize: 12,
    },
    threadBadges: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    progressBadge: {
      fontSize: 10,
      fontFamily: theme.fontFamilies?.bold,
    },
    progressBadgeNone: {
      color: '#95a0b1',
    },
    progressBadgePartial: {
      color: '#e0b25e',
    },
    progressBadgeMet: {
      color: '#63d29f',
    },
    slotBadge: {
      color: '#9ab5d8',
      fontSize: 10,
      fontFamily: theme.fontFamilies?.bold,
    },
    pinBadge: {
      color: '#9fc7ff',
      fontSize: 10,
      fontFamily: theme.fontFamilies?.bold,
    },
    unreadBadge: {
      minWidth: 20,
      paddingHorizontal: 6,
      height: 20,
      borderRadius: 999,
      backgroundColor: '#2d7ef7',
      alignItems: 'center',
      justifyContent: 'center',
    },
    unreadBadgeText: {
      color: '#f4f8ff',
      fontSize: 11,
      fontFamily: theme.fontFamilies?.bold,
    },
    activeThreadLabel: {
      color: '#a4b4c9',
      fontSize: 11,
      marginTop: 2,
    },
    onlineDot: {
      width: 8,
      height: 8,
      borderRadius: 999,
    },
    dotOnline: {
      backgroundColor: '#37c56a',
    },
    dotOffline: {
      backgroundColor: '#e35d5b',
    },
    input: {
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: '#f3f7ff',
      backgroundColor: 'rgba(255,255,255,0.03)',
    },
    pingBtn: {
      backgroundColor: theme.colors.primary,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    btnText: {
      color: theme.colors.textOnPrimary,
      fontFamily: theme.fontFamilies?.bold,
      fontSize: 13,
    },
    history: {
      flex: 1,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      borderRadius: 12,
      minHeight: 0,
      backgroundColor: 'rgba(255,255,255,0.02)',
    },
    historyInner: {
      padding: 8,
      gap: 2,
    },
    empty: {
      color: '#99a8ba',
      fontSize: 12,
      paddingVertical: 12,
      textAlign: 'center',
    },
    coSignBlock: {
      marginBottom: 8,
    },
    senderLabel: {
      fontSize: 11,
      color: theme.colors.textSecondary,
      marginBottom: 4,
      marginLeft: 2,
    },
    composerRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 8,
      paddingTop: 2,
    },
    composerInput: {
      flex: 1,
      minHeight: 44,
      maxHeight: 96,
      textAlignVertical: 'top',
    },
    sendBtn: {
      width: 78,
      borderRadius: 10,
      paddingVertical: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary,
      marginBottom: 1,
    },
    error: {
      color: '#d9534f',
      fontSize: 12,
    },
  });

export default KeyshareChat;
