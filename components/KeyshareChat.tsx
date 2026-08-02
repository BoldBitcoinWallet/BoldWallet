import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import AppText from './AppText';
import AppPressable from './AppPressable';
import ChatBubble from './ChatBubble';
import CoSignRequestCard from './CoSignRequestCard';
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

type PeerState = {
  npub: string;
  label: string;
  isOnline: boolean;
  lastPingAt: number;
};

type ChatFeedItem = {
  id: string;
  type: NostrMessageType;
  senderFingerprint: string;
  senderNpub: string;
  senderLabel: string;
  timestamp: number;
  payload: Record<string, unknown>;
  sourceMessage?: NostrIncomingMessage;
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

      if (msg.envelope.type !== 'CHAT_MESSAGE' && msg.envelope.type !== 'COSIGN_REQUEST') {
        return;
      }

      const parsed = parsePayload(msg.envelope.payload);
      const senderLabel = senderPeer?.label || `${senderNpub.slice(0, 8)}...`;

      const feedItem: ChatFeedItem = {
        id: messageRenderKey(msg),
        type: msg.envelope.type,
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
    });

    return () => {
      mounted = false;
      clearInterval(ticker);
      offState();
      offMsg();
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
    const msg = item.sourceMessage;
    if (!msg) return;

    const payload = item.payload as unknown as CoSignRequestPayload;
    if (!payload?.txId) return;

    const psbtBase64 =
      typeof payload.psbtBase64 === 'string' && payload.psbtBase64
        ? payload.psbtBase64
        : typeof payload.psbtHex === 'string' && payload.psbtHex
        ? nostrMessaging.psbtHexToBase64(payload.psbtHex)
        : '';

    if (!psbtBase64) {
      setError('This co-sign request did not contain a usable PSBT payload.');
      return;
    }

    setPendingCoSignRequest({
      senderNpub: msg.senderNpub,
      senderFingerprint: msg.envelope.senderFingerprint,
      recipientFingerprint: msg.envelope.recipientFingerprint,
      request: payload,
      envelopeId: msg.envelope.id,
      receivedAt: Date.now(),
    });

    navigation.dispatch(
      CommonActions.navigate({
        name: 'PSBT',
        params: { sharedPsbtBase64: psbtBase64 },
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
