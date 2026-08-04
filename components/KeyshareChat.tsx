import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
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
  if (byTx) return `tx:${byTx}`;

  const payloadTx =
    item.payload && typeof item.payload.txId === 'string' ? item.payload.txId.trim() : '';
  if (payloadTx) return `tx:${payloadTx}`;

  return `evt:${item.id}`;
}

function invoiceThreadKeyFromPayload(payload: Record<string, unknown>): string {
  const reqId = typeof payload.nip46RequestId === 'string' ? payload.nip46RequestId.trim() : '';
  if (reqId) return `req:${reqId}`;
  const txId = typeof payload.txId === 'string' ? payload.txId.trim() : '';
  if (txId) return `tx:${txId}`;
  return '';
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
  const peersRef = useRef<PeerState[]>([]);
  const invoiceThreadKeyByRequestIdRef = useRef<Map<string, string>>(new Map());
  const invoiceThreadKeyByTxIdRef = useRef<Map<string, string>>(new Map());
  const lastCoSignOpenAtRef = useRef(0);
  // One COSIGN_REQUEST can reach this screen via up to three independent paths
  // (direct onMessage listener, bridge's nostr-cosign:request, bridge's
  // nostr-chat:incoming) plus redelivery across multiple relays; this Set makes
  // "first one wins, the rest are no-ops" regardless of which path arrives first.
  const seenCoSignRequestIdsRef = useRef<Set<string>>(new Set());
  // Set by a tapped global co-sign notification (see NostrCoSignBridge.notifyCoSignRequest);
  // consumed by the effect below once the matching card exists in `messages`.
  const pendingFocusTxIdRef = useRef<string | null>(null);

  const resolveExistingInvoiceThreadKey = (
    requestId?: string,
    txId?: string,
  ): string | undefined => {
    const req = typeof requestId === 'string' ? requestId.trim() : '';
    if (req) {
      const byReq = invoiceThreadKeyByRequestIdRef.current.get(req);
      if (byReq) return byReq;
    }

    const tx = typeof txId === 'string' ? txId.trim() : '';
    if (tx) {
      const byTx = invoiceThreadKeyByTxIdRef.current.get(tx);
      if (byTx) return byTx;
    }

    return undefined;
  };

  const registerInvoiceThreadKey = (opts: {
    requestId?: string;
    txId?: string;
    fallbackIdentity: string;
  }): string => {
    const req = typeof opts.requestId === 'string' ? opts.requestId.trim() : '';
    const tx = typeof opts.txId === 'string' ? opts.txId.trim() : '';

    const existing = resolveExistingInvoiceThreadKey(req, tx);
    if (existing) return existing;

    if (req) {
      const key = `req:${req}`;
      invoiceThreadKeyByRequestIdRef.current.set(req, key);
      if (tx) invoiceThreadKeyByTxIdRef.current.set(tx, key);
      return key;
    }

    if (tx) {
      const key = `tx:${tx}`;
      invoiceThreadKeyByTxIdRef.current.set(tx, key);
      return key;
    }

    return `evt:${opts.fallbackIdentity}`;
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
        await nostrMessaging.connect();

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
        const invoiceThreadKey =
          resolveExistingInvoiceThreadKey(responseRequestId, txId) ||
          registerInvoiceThreadKey({
            requestId: responseRequestId,
            txId,
            fallbackIdentity: messageIdentity(msg),
          });
        const approved = !!response.approved;
        const hasBroadcastTxId = typeof response.broadcastTxId === 'string' && response.broadcastTxId.trim().length > 0;
        if (txId) {
          DeviceEventEmitter.emit('nostr-cosign:status', {
            mode: 'legacy',
            txId,
            status: approved ? (hasBroadcastTxId ? 'broadcasted' : 'signed') : 'rejected',
          });
        }

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
      const invoiceThreadKey =
        msg.envelope.type === 'COSIGN_REQUEST'
          ? registerInvoiceThreadKey({
              requestId,
              txId,
              fallbackIdentity: messageIdentity(msg),
            })
          : msg.envelope.type === 'CHAT_MESSAGE'
          ? resolveExistingInvoiceThreadKey(
              typeof parsed.nip46RequestId === 'string' ? parsed.nip46RequestId : undefined,
              txId,
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
      (evt: { txId?: string }) => {
        if (!mounted || !evt?.txId) return;
        pendingFocusTxIdRef.current = evt.txId;
      },
    );
    // A notification tap may have fired before this screen (re)mounted; replay it too.
    getRecentCoSignFocusEvents().forEach(evt => {
      const txId = (evt as { txId?: string }).txId;
      if (txId) pendingFocusTxIdRef.current = txId;
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

        setMessages(prev =>
          prev.map(item => {
            if (item.type !== 'COSIGN_REQUEST') return item;
            const reqMatch =
              evt.requestId && item.nip46RequestId && evt.requestId === item.nip46RequestId;
            const txMatch = evt.txId && item.txId && evt.txId === item.txId;
            if (!reqMatch && !txMatch) return item;
            return {
              ...item,
              status: nextStatus,
            };
          }),
        );
      },
    );

    return () => {
      mounted = false;
      clearInterval(ticker);
      offState();
      offMsg();
      offBridgeCoSign.remove();
      offIncomingChat.remove();
      offFocus.remove();
      offCoSignStatus.remove();
    };
  }, []);

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
        .filter(item => item.type === 'COSIGN_REQUEST' && item.status !== 'signed' && item.status !== 'rejected')
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

      return {
        id: `peer-thread:${peer.npub}`,
        chatId: `peer:${peer.npub}`,
        kind: 'peer',
        npub: peer.npub,
        title: peer.label,
        preview: latestChat ? payloadText(latestChat.payload) : 'Tap to start encrypted chat.',
        timestamp: latestChat?.timestamp || peer.lastPingAt || 0,
        unreadCount: chatItems.length,
        pinned: false,
        online: peer.isOnline,
        lastItem: latestChat,
      };
    });

    return rows.sort((a, b) => b.timestamp - a.timestamp);
  }, [activePeers, messages]);

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
        ? `Invoice ${requestItem.txId.slice(0, 8)}`
        : `Co-Sign ${invoiceKey.slice(0, 12)}`;
      const pendingCount = sorted.filter(
        item => item.type === 'COSIGN_REQUEST' && item.status !== 'signed' && item.status !== 'rejected',
      ).length;
      const amount = Number(requestItem?.payload?.amountSats || 0);
      const latestPreview = latest.type === 'CHAT_MESSAGE'
        ? payloadText(latest.payload)
        : amount > 0
        ? `Co-sign ${amount} sats`
        : 'Co-sign thread';
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
        unreadCount: sorted.length,
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
  }, [messages, peerMap, signingThreshold]);

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

    if (selectedThread?.kind === 'invoice') {
      const invoiceKey = selectedThread.invoiceKey || '';
      const requestId = invoiceKey.startsWith('req:') ? invoiceKey.slice(4) : '';
      const txFromKey = invoiceKey.startsWith('tx:') ? invoiceKey.slice(3) : '';
      const txId = selectedThread.openItem?.txId || txFromKey;
      if (requestId) outgoingPayload.nip46RequestId = requestId;
      if (txId) outgoingPayload.txId = txId;
      outgoingPayload.threadType = 'invoice';
    }

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
        id: `optimistic:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
        type: 'CHAT_MESSAGE',
        invoiceThreadKey: selectedThread.kind === 'invoice' ? selectedThread.invoiceKey : undefined,
        senderFingerprint: localFingerprint,
        senderNpub: localNpub,
        senderLabel: 'You',
        timestamp: Date.now(),
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
    if (item.status === 'signed' || item.status === 'rejected') {
      console.log('[NIP46-TLM][UI] openCoSignRequest ignored due to terminal status', {
        itemId: item.id,
        status: item.status,
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
    setActiveChatId(`invoice:${match.invoiceThreadKey || invoiceThreadKeyForItem(match)}`);
    openCoSignRequest(match);
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
