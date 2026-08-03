import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { DeviceEventEmitter } from 'react-native';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import AppText from './AppText';
import AppPressable from './AppPressable';
import ChatBubble from './ChatBubble';
import CoSignRequestCard from './CoSignRequestCard';
import { getRecentCoSignFeedEvents, getRecentUnreadChatEvents } from './NostrCoSignBridge';
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
  isOnline: boolean;
  lastPingAt: number;
};

type ChatFeedItem = {
  id: string;
  type: NostrMessageType;
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

const KeyshareChat: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [state, setState] = useState(nostrMessaging.getConnectionState());
  const [messages, setMessages] = useState<ChatFeedItem[]>([]);
  const [peers, setPeers] = useState<PeerState[]>([]);
  const peersRef = useRef<PeerState[]>([]);
  const lastCoSignOpenAtRef = useRef(0);
  // One COSIGN_REQUEST can reach this screen via up to three independent paths
  // (direct onMessage listener, bridge's nostr-cosign:request, bridge's
  // nostr-chat:incoming) plus redelivery across multiple relays; this Set makes
  // "first one wins, the rest are no-ops" regardless of which path arrives first.
  const seenCoSignRequestIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      try {
        await nostrMessaging.connect();

        const meta = await getKeyshareMetadata();
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

        const uniqueRemotePeers = Array.from(
          new Set(committee.filter(npub => !localCandidates.has(npub))),
        );

        if (mounted) {
          setPeers(
            uniqueRemotePeers.map(npub => {
              const committeeIndex = committee.indexOf(npub);
              const labelSuffix = committeeIndex >= 0 ? committeeIndex + 1 : npub.slice(0, 6);
              return {
              npub,
              label: `Keyshare ${labelSuffix}`,
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
        const txId = typeof response.txId === 'string' ? response.txId : '';
        const approved = !!response.approved;
        const hasBroadcastTxId = typeof response.broadcastTxId === 'string' && response.broadcastTxId.trim().length > 0;
        if (txId) {
          DeviceEventEmitter.emit('nostr-cosign:status', {
            mode: 'legacy',
            txId,
            status: approved ? (hasBroadcastTxId ? 'broadcasted' : 'signed') : 'rejected',
          });
        }
        return;
      }

      const senderLabel = senderPeer?.label || `${senderNpub.slice(0, 8)}...`;

      if (msg.envelope.type === 'COSIGN_REQUEST') {
        const identity = coSignRequestIdentity({
          txId: typeof parsed.txId === 'string' ? parsed.txId : undefined,
          eventId: msg.eventId,
          envelopeId: msg.envelope.id,
          fallbackSeed: messageIdentity(msg),
        });
        if (seenCoSignRequestIdsRef.current.has(identity)) return;
        seenCoSignRequestIdsRef.current.add(identity);
      }

      const feedItem: ChatFeedItem = {
        id: messageRenderKey(msg),
        type: msg.envelope.type,
        status: msg.envelope.type === 'COSIGN_REQUEST' ? 'pending' : undefined,
        txId: typeof parsed.txId === 'string' ? parsed.txId : undefined,
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

      const feedItem: ChatFeedItem = {
        id: `bridge-cosign:${identity}`,
        type: 'COSIGN_REQUEST',
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

      const feedItem: ChatFeedItem = {
        id: `chat-incoming:${identity}`,
        type: 'COSIGN_REQUEST',
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
    if (recipientNpubs.length === 0) {
      setError('No remote keyshares found for this wallet.');
      return;
    }

    setError('');
    const outgoingText = text.trim();

    try {
      await nostrMessaging.sendEnvelope(recipientNpubs, {
        id: `chat-${Date.now()}`,
        type: 'CHAT_MESSAGE',
        senderFingerprint: localFingerprint,
        recipientFingerprint: 'peer-group',
        timestamp: Date.now(),
        payload: { text: outgoingText },
      });

      setMessages(prev => [
        {
          id: `optimistic:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
          type: 'CHAT_MESSAGE',
          senderFingerprint: localFingerprint,
          senderNpub: localNpub,
          senderLabel: 'You',
          timestamp: Date.now(),
          payload: { text: outgoingText },
        },
        ...prev,
      ].slice(0, 200));

      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openCoSignRequest = (item: ChatFeedItem) => {
    if (item.status === 'signed' || item.status === 'rejected') {
      return;
    }

    const now = Date.now();
    if (now - lastCoSignOpenAtRef.current < 1200) {
      return;
    }
    lastCoSignOpenAtRef.current = now;

    const msg = item.sourceMessage;

    const payload = item.payload as unknown as CoSignRequestPayload;
    if (!payload?.txId) return;

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
    // flow instead of silently failing.
    const amountSatsNum = Number(payload.amountSats);
    const isRegularSendRequest =
      !psbtBase64 &&
      typeof payload.recipientAddress === 'string' &&
      payload.recipientAddress.trim() !== '' &&
      payload.recipientAddress !== 'N/A' &&
      Number.isFinite(amountSatsNum) &&
      amountSatsNum > 0;

    if (!psbtBase64 && !isRegularSendRequest) {
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

    // Synchronized entry handshake: wake the waiting initiator the instant we commit to
    // co-signing, so it enters the native TSS window at (roughly) the same moment we do
    // instead of relying on human tap-timing alone. Fire-and-forget — must not block
    // navigation into the signing screen.
    const readyRecipientNpub =
      item.mode === 'nip46' ? item.nip46ReplyTo || item.senderNpub : msg?.senderNpub || item.senderNpub;
    const readyRecipientFingerprint =
      item.mode === 'nip46'
        ? item.senderFingerprint || 'nip46-client'
        : msg?.envelope.senderFingerprint || item.senderFingerprint;
    if (readyRecipientNpub) {
      nostrMessaging
        .sendCoSignReady(readyRecipientNpub, localFingerprint, readyRecipientFingerprint || 'peer-group', {
          txId: payload.txId,
          traceId: payload.traceId,
        })
        .then(() => {
          dbg('[NIP46-TLM][KeyshareChat] sent COSIGN_READY to initiator', {
            txId: payload.txId,
            recipient: readyRecipientNpub.substring(0, 20) + '...',
          });
        })
        .catch(readyErr => {
          console.error('[NIP46-TLM][KeyshareChat] failed to publish COSIGN_READY', readyErr);
          dbg('[NIP46-TLM][KeyshareChat] failed to send COSIGN_READY (continuing anyway)', readyErr);
        });
    } else {
      dbg('[NIP46-TLM][KeyshareChat] no recipient resolved for COSIGN_READY; initiator will time out', {
        txId: payload.txId,
        mode: item.mode || 'legacy',
      });
    }

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
      navigation.dispatch(
        CommonActions.navigate({
          name: 'MainTabs',
          params: {
            screen: 'Nostr Connect',
            params: {
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
              // We are responding to someone else's request, not originating one \u2014
              // MobileNostrPairing must resolve its own addressType/derivationPath
              // locally and must not wait on its own COSIGN_READY.
              isPeerResponse: true,
            },
          },
        }),
      );
      return;
    }

    navigation.dispatch(
      CommonActions.navigate({
        name: 'MainTabs',
        params: {
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
            // We are responding to someone else's request, not originating one \u2014
            // PSBTScreen must not treat this device as the waiting initiator.
            isPeerResponse: true,
          },
        },
      }),
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <AppText style={styles.title}>Keyshare Chat</AppText>
        <AppText style={styles.status}>Relay: {state}</AppText>
      </View>

      <View style={styles.peerHeaderRow}>
        <AppText style={styles.label}>Active Keyshares</AppText>
        <AppPressable onPress={pingAllPeers} style={styles.pingBtn}>
          <AppText style={styles.btnText}>Ping All</AppText>
        </AppPressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peerList}>
        {peers.length === 0 ? (
          <View style={styles.peerChip}>
            <AppText style={styles.peerChipText}>No peers</AppText>
          </View>
        ) : (
          peers.map(peer => (
            <View key={peer.npub} style={styles.peerChip}>
              <View style={[styles.onlineDot, peer.isOnline ? styles.dotOnline : styles.dotOffline]} />
              <AppText style={styles.peerChipText}>{peer.label}</AppText>
            </View>
          ))
        )}
      </ScrollView>

      <ScrollView style={styles.history} contentContainerStyle={styles.historyInner}>
        {messages.length === 0 ? (
          <AppText style={styles.empty}>No messages yet.</AppText>
        ) : (
          messages.map(item => {
            const isMine =
              item.senderFingerprint === localFingerprint ||
              (item.senderNpub && item.senderNpub === localNpub);

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
                    onReviewSign={() => openCoSignRequest(item)}
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
          numberOfLines={2}
          placeholder="Type an encrypted message..."
          placeholderTextColor={theme.colors.textSecondary}
        />
        <AppPressable onPress={sendChat} style={styles.sendBtn}>
          <AppText style={styles.btnText}>Send</AppText>
        </AppPressable>
      </View>

      {error ? <AppText style={styles.error}>{error}</AppText> : null}
    </View>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    wrap: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 10,
      padding: 12,
      backgroundColor: theme.colors.cardBackground,
      gap: 8,
      flex: 1,
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
      color: theme.colors.textSecondary,
    },
    label: {
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
    peerHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    peerList: {
      gap: 8,
      paddingVertical: 2,
      paddingRight: 4,
    },
    peerChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: 'rgba(255,255,255,0.04)',
    },
    peerChipText: {
      fontSize: 12,
      color: theme.colors.text,
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
      borderColor: theme.colors.border,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: theme.colors.text,
      backgroundColor: theme.colors.cardBackground,
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
      borderColor: theme.colors.border,
      borderRadius: 8,
      minHeight: 180,
    },
    historyInner: {
      padding: 8,
      gap: 2,
    },
    empty: {
      color: theme.colors.textSecondary,
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
