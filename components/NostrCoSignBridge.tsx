import React, { useCallback, useEffect, useRef } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { CommonActions, type NavigationContainerRef } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { dbg } from '../utils';
import {
  nostrMessaging,
  type CoSignReadyPayload,
  type CoSignRequestPayload,
  type CoSignResponsePayload,
  type Nip46Request,
  type Nip46Response,
} from '../services/nostrMessaging';
import { clearPendingCoSignRequest } from '../services/nostrCoSignSession';

type Props = {
  isAuthenticated: boolean;
  isNavigationReady?: boolean;
  navigationRef: React.RefObject<NavigationContainerRef<any> | null>;
};

type QueuedSignerNavigation = {
  psbtBase64: string;
  nip46RequestId?: string;
  nip46ReplyTo?: string;
  autoSign?: boolean;
  queuedAt: number;
};

const MAX_QUEUED_SIGNER_ACTIONS = 20;

function emitBridgeTelemetry(event: string, extra?: Record<string, unknown>): void {
  DeviceEventEmitter.emit('nostr-bridge:telemetry', {
    event,
    ts: Date.now(),
    ...(extra || {}),
  });
}

// KeyshareChat only exists while its tab is mounted; if a COSIGN_REQUEST arrives
// while it's not (not yet visited, or torn down/rebuilt by the navigator), a plain
// DeviceEventEmitter emission is lost forever and the card silently never appears
// until some unrelated action happens to remount the screen. Buffer recent emissions
// so a late/re-mounting subscriber can replay what it missed.
const RECENT_EVENT_BUFFER_MS = 5 * 60 * 1000;
const MAX_RECENT_EVENTS = 30;
let recentCoSignFeedEvents: Array<Record<string, unknown>> = [];
let recentUnreadChatEvents: Array<Record<string, unknown>> = [];
let recentCoSignFocusEvents: Array<Record<string, unknown>> = [];

// Relays commonly redeliver the same event on resubscribe/reconnect (observed ~every
// 60s in the wild). Without this, every redelivery re-runs decode + emits a fresh
// feed/toast/chat event for a request the app already surfaced. Module-level (not a
// ref) so it survives across NostrCoSignBridge and screen remounts for the life of
// the process.
const MAX_PROCESSED_EVENT_IDS = 500;
const processedCoSignEventIds = new Set<string>();

/** True (and marks it processed) on first sighting of an eventId; false on redelivery. */
function markCoSignEventProcessed(eventId: string | undefined): boolean {
  if (!eventId) return true; // no id to dedupe on -> treat as always-new, never block delivery
  if (processedCoSignEventIds.has(eventId)) return false;
  processedCoSignEventIds.add(eventId);
  if (processedCoSignEventIds.size > MAX_PROCESSED_EVENT_IDS) {
    const oldest = processedCoSignEventIds.values().next().value;
    if (oldest !== undefined) processedCoSignEventIds.delete(oldest);
  }
  return true;
}

function pruneAndPush(
  buffer: Array<Record<string, unknown>>,
  evt: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const cutoff = Date.now() - RECENT_EVENT_BUFFER_MS;
  return [...buffer, evt]
    .filter(e => Number(e.ts) >= cutoff)
    .slice(-MAX_RECENT_EVENTS);
}

/** Replays any `nostr-cosign:request` events emitted while the caller wasn't listening. */
export function getRecentCoSignFeedEvents(): Array<Record<string, unknown>> {
  const cutoff = Date.now() - RECENT_EVENT_BUFFER_MS;
  return recentCoSignFeedEvents.filter(e => Number(e.ts) >= cutoff);
}

/** Replays any `nostr-chat:incoming` events emitted while the caller wasn't listening. */
export function getRecentUnreadChatEvents(): Array<Record<string, unknown>> {
  const cutoff = Date.now() - RECENT_EVENT_BUFFER_MS;
  return recentUnreadChatEvents.filter(e => Number(e.ts) >= cutoff);
}

/** Replays any `nostr-cosign:focus` events (notification taps) emitted before a caller subscribed. */
export function getRecentCoSignFocusEvents(): Array<Record<string, unknown>> {
  const cutoff = Date.now() - RECENT_EVENT_BUFFER_MS;
  return recentCoSignFocusEvents.filter(e => Number(e.ts) >= cutoff);
}

function emitCoSignFocusEvent(txId: string): void {
  const evt = { ts: Date.now(), txId };
  recentCoSignFocusEvents = pruneAndPush(recentCoSignFocusEvents, evt);
  DeviceEventEmitter.emit('nostr-cosign:focus', evt);
}

/**
 * Global in-app banner for a freshly-decoded, non-duplicate COSIGN_REQUEST so the user
 * is alerted regardless of which tab/screen is currently active. Tapping it navigates to
 * the Chat tab and asks it to auto-open the matching request (see emitCoSignFocusEvent).
 */
function notifyCoSignRequest(txId: string | undefined): void {
  Toast.show({
    type: 'info',
    text1: 'New co-sign request',
    text2: txId ? `Tap to review transaction ${txId.slice(0, 12)}…` : 'Tap to review the pending request',
    visibilityTime: 15000,
    onPress: () => {
      Toast.hide();
      if (txId) emitCoSignFocusEvent(txId);
      const navRef = latestNavigationRef.current;
      if (navRef?.current) {
        navRef.current.dispatch(
          CommonActions.navigate('MainTabs', { screen: 'Chat' }),
        );
      }
    },
  });
}

// Set by NostrCoSignBridge on each render so the module-level notifyCoSignRequest
// (called from handlers that close over a stale navigationRef across re-renders) can
// always reach the current navigation container.
const latestNavigationRef: { current: React.RefObject<NavigationContainerRef<any> | null> | null } = {
  current: null,
};

function emitCoSignFeedEvent(payload: Record<string, unknown>): void {
  const evt = { ts: Date.now(), ...payload };
  recentCoSignFeedEvents = pruneAndPush(recentCoSignFeedEvents, evt);
  DeviceEventEmitter.emit('nostr-cosign:request', evt);
}

function emitUnreadChatEvent(payload: Record<string, unknown>): void {
  const evt = { ts: Date.now(), ...payload };
  recentUnreadChatEvents = pruneAndPush(recentUnreadChatEvents, evt);
  DeviceEventEmitter.emit('nostr-chat:incoming', evt);
}

function isPlaceholderPsbt(psbtBase64: string, psbtHex: string): boolean {
  const b64 = (psbtBase64 || '').trim();
  const hex = (psbtHex || '').trim().toLowerCase();
  return b64 === 'cHNidP8BAA==' || hex === '70736274';
}

function fingerprintFromNpub(npub: string): string {
  if (!npub) return 'unknown';
  try {
    return bytesToHex(sha256(utf8ToBytes(npub))).slice(0, 8);
  } catch {
    return 'unknown';
  }
}

const NostrCoSignBridge = ({ isAuthenticated, isNavigationReady = true, navigationRef }: Props) => {
  const queuedSignerNavigationsRef = useRef<QueuedSignerNavigation[]>([]);
  latestNavigationRef.current = navigationRef;

  const navigateToSignerOrQueue = useCallback(
    (
      psbtBase64: string,
      opts?: {
        nip46RequestId?: string;
        nip46ReplyTo?: string;
        autoSign?: boolean;
      },
    ) => {
      if (isNavigationReady && navigationRef.current) {
        dbg('[NIP46-TLM][NostrCoSignBridge] dispatching signer navigation immediately', {
          isNavigationReady,
          hasNavigationRef: true,
          psbtPrefix: psbtBase64.slice(0, 16),
          queueDepth: queuedSignerNavigationsRef.current.length,
          nip46RequestId: opts?.nip46RequestId,
        });
        navigationRef.current.dispatch(
          CommonActions.navigate('MainTabs', {
            screen: 'PSBT',
            params: {
              sharedPsbtBase64: psbtBase64,
              nip46RequestId: opts?.nip46RequestId,
              nip46ReplyTo: opts?.nip46ReplyTo,
              autoSign: !!opts?.autoSign,
            },
          }),
        );
        return;
      }

      const queue = queuedSignerNavigationsRef.current;
      queue.push({
        psbtBase64,
        nip46RequestId: opts?.nip46RequestId,
        nip46ReplyTo: opts?.nip46ReplyTo,
        autoSign: !!opts?.autoSign,
        queuedAt: Date.now(),
      });
      if (queue.length > MAX_QUEUED_SIGNER_ACTIONS) {
        queue.shift();
      }
      dbg('[NIP46-TLM][NostrCoSignBridge] navigation unavailable, queued signer action', {
        isNavigationReady,
        hasNavigationRef: !!navigationRef.current,
        queueDepth: queue.length,
        psbtPrefix: psbtBase64.slice(0, 16),
      });
    },
    [isNavigationReady, navigationRef],
  );

  useEffect(() => {
    if (!isAuthenticated || !isNavigationReady || !navigationRef.current) {
      return;
    }

    const queue = queuedSignerNavigationsRef.current;
    if (queue.length === 0) {
      return;
    }

    const pending = queue.shift();
    if (!pending) return;

    dbg('[NIP46-TLM][NostrCoSignBridge] flushing queued signer navigation', {
      queueDepthAfterShift: queue.length,
      waitedMs: Date.now() - pending.queuedAt,
      psbtPrefix: pending.psbtBase64.slice(0, 16),
    });

    navigationRef.current.dispatch(
      CommonActions.navigate('MainTabs', {
        screen: 'PSBT',
        params: {
          sharedPsbtBase64: pending.psbtBase64,
          nip46RequestId: pending.nip46RequestId,
          nip46ReplyTo: pending.nip46ReplyTo,
          autoSign: !!pending.autoSign,
        },
      }),
    );
  }, [isAuthenticated, isNavigationReady, navigationRef]);

  useEffect(() => {
    if (!isAuthenticated) {
      dbg('[NostrCoSignBridge] unauthenticated -> disconnecting Nostr bridge');
      emitBridgeTelemetry('auth-false');
      nostrMessaging.disconnect();
      clearPendingCoSignRequest();
      queuedSignerNavigationsRef.current = [];
      return;
    }

    dbg('[NostrCoSignBridge] authenticated -> connecting Nostr bridge');
    emitBridgeTelemetry('auth-true', { isNavigationReady });

    let mounted = true;
    const setup = async () => {
      try {
        await nostrMessaging.connect();
        dbg('[NostrCoSignBridge] nostr connect() completed');
        emitBridgeTelemetry('connect-result', { ok: true });
      } catch (err) {
        dbg('NostrCoSignBridge: failed to connect', err);
        dbg('[NostrCoSignBridge] nostr connect() failed', String(err));
        emitBridgeTelemetry('connect-result', {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    void setup();

    emitBridgeTelemetry('listener-attached', {
      legacy: true,
      nip46: true,
    });

    const offLegacy = nostrMessaging.onMessage(async msg => {
      if (!mounted) return;
      if (msg.envelope.type !== 'COSIGN_REQUEST') return;
      if (!markCoSignEventProcessed(msg.eventId)) {
        dbg('[NIP46-TLM][NostrCoSignBridge] ignoring redelivered COSIGN_REQUEST (legacy)', {
          eventId: msg.eventId,
        });
        return;
      }

      const payload = msg.envelope.payload as CoSignRequestPayload;
      const psbtBase64 = payload.psbtBase64 || (payload.psbtHex ? nostrMessaging.psbtHexToBase64(payload.psbtHex) : '');

      // A native BTC send fan-out (e.g. from a watch-only peer like the BoldChrome
      // extension) carries no PSBT at all — just recipient/amount/fee. Don't drop it
      // here; KeyshareChat's own isRegularSendRequest check routes it to the native
      // DKLS send_btc flow instead of the PSBT screen. `requestMode` is an explicit
      // sender-chosen signal that takes priority over the implicit inference.
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
        dbg('NostrCoSignBridge: request missing usable PSBT or send payload');
        return;
      }

      if (psbtBase64 && isPlaceholderPsbt(psbtBase64, payload.psbtHex || '')) {
        dbg('[NIP46-TLM][NostrCoSignBridge] rejecting placeholder PSBT payload (legacy)', {
          txId: payload.txId,
          psbtPrefix: psbtBase64.slice(0, 24),
        });
        return;
      }

      emitCoSignFeedEvent({
        mode: 'legacy',
        eventId: msg.eventId,
        envelopeId: msg.envelope.id,
        senderNpub: msg.senderNpub,
        senderFingerprint: msg.envelope.senderFingerprint,
        recipientFingerprint: msg.envelope.recipientFingerprint,
        request: payload,
      });

      dbg('[NIP46-TLM][Receiver] emitting nostr-cosign:request to chat feed', {
        traceId: typeof payload.traceId === 'string' ? payload.traceId : null,
        eventId: msg.eventId,
        envelopeId: msg.envelope.id,
        txId: payload.txId,
        senderNpub: msg.senderNpub,
      });

      emitUnreadChatEvent({
        type: 'COSIGN_REQUEST',
        mode: 'legacy',
        txId: payload.txId,
        requestId: msg.envelope.id,
        parsedMessage: {
          eventId: msg.eventId,
          senderNpub: msg.senderNpub,
          request: payload,
          senderFingerprint: msg.envelope.senderFingerprint,
        },
      });

      notifyCoSignRequest(payload.txId);
    });

    const offNip46 = nostrMessaging.onNip46Request(async msg => {
      if (!mounted) return;

      dbg('[NostrCoSignBridge] inbound NIP-46 request', {
        id: msg?.request?.id,
        method: msg?.request?.method,
        senderNpub: msg?.senderNpub,
      });

      const request: Nip46Request = msg.request;
      if (request.method !== 'sign_event') return;
      if (!markCoSignEventProcessed(msg.eventId)) {
        dbg('[NIP46-TLM][NostrCoSignBridge] ignoring redelivered sign_event request (nip46)', {
          eventId: msg.eventId,
          requestId: request.id,
        });
        return;
      }

      const eventToSign = request.params?.[0] as
        | {
            content?: string;
            tags?: unknown[];
          }
        | undefined;
      if (!eventToSign || typeof eventToSign !== 'object') {
        const malformed: Nip46Response = {
          id: request.id,
          error: 'Invalid sign_event payload',
        };
        await nostrMessaging.sendNip46Response(msg.senderNpub, malformed);
        return;
      }

      let payload: CoSignRequestPayload | null = null;
      try {
        if (typeof eventToSign.content === 'string' && eventToSign.content.trim().startsWith('{')) {
          const parsed = JSON.parse(eventToSign.content);
          if (parsed && typeof parsed === 'object' && parsed.txId && (parsed.psbtBase64 || parsed.psbtHex)) {
            payload = parsed as CoSignRequestPayload;
          }
        }
      } catch {
        payload = null;
      }

      if (!payload) {
        const psbtHexTag = Array.isArray(eventToSign.tags)
          ? eventToSign.tags.find(
              t => Array.isArray(t) && t.length >= 2 && (t[0] === 'psbt' || t[0] === 'psbt_hex'),
            )
          : null;
        const psbtBase64Tag = Array.isArray(eventToSign.tags)
          ? eventToSign.tags.find(
              t => Array.isArray(t) && t.length >= 2 && (t[0] === 'psbt_base64' || t[0] === 'psbtb64'),
            )
          : null;

        const psbtHex = Array.isArray(psbtHexTag) ? String(psbtHexTag[1] || '') : '';
        const psbtBase64 = Array.isArray(psbtBase64Tag) ? String(psbtBase64Tag[1] || '') : '';
        if (!psbtHex && !psbtBase64) {
          const missing: Nip46Response = {
            id: request.id,
            error: 'sign_event request missing PSBT payload',
          };
          await nostrMessaging.sendNip46Response(msg.senderNpub, missing);
          return;
        }

        payload = {
          txId: `nip46-${request.id}`,
          psbtHex,
          psbtBase64,
          amountSats: 0,
          feeSats: 0,
          recipientAddress: 'N/A',
          network: 'testnet',
        };
      }

      const psbtBase64 = payload.psbtBase64 || (payload.psbtHex ? nostrMessaging.psbtHexToBase64(payload.psbtHex) : '');
      dbg('[NIP46-TLM][NostrCoSignBridge] parsed sign_event payload', {
        requestId: request.id,
        txId: payload.txId,
        payloadPsbtBase64Len: typeof payload.psbtBase64 === 'string' ? payload.psbtBase64.length : 0,
        payloadPsbtHexLen: typeof payload.psbtHex === 'string' ? payload.psbtHex.length : 0,
        derivedPsbtBase64Len: psbtBase64.length,
        derivedPsbtBase64Prefix: psbtBase64.slice(0, 24),
      });
      if (!psbtBase64) {
        const missing: Nip46Response = {
          id: request.id,
          error: 'Unable to decode PSBT payload',
        };
        await nostrMessaging.sendNip46Response(msg.senderNpub, missing);
        return;
      }

      if (isPlaceholderPsbt(psbtBase64, payload.psbtHex || '')) {
        const placeholder: Nip46Response = {
          id: request.id,
          error: 'Rejected placeholder PSBT payload. Send a full BIP-174 PSBT.',
        };
        dbg('[NIP46-TLM][NostrCoSignBridge] rejecting placeholder PSBT payload (nip46)', {
          requestId: request.id,
          txId: payload.txId,
          psbtPrefix: psbtBase64.slice(0, 24),
        });
        await nostrMessaging.sendNip46Response(msg.senderNpub, placeholder);
        return;
      }

      emitCoSignFeedEvent({
        mode: 'nip46',
        eventId: msg.eventId,
        nip46RequestId: request.id,
        nip46ReplyTo: msg.senderNpub,
        senderNpub: msg.senderNpub,
        senderFingerprint: 'nip46-client',
        recipientFingerprint: 'nip46-signer',
        request: payload,
      });

      emitUnreadChatEvent({
        type: 'COSIGN_REQUEST',
        mode: 'nip46',
        txId: payload.txId,
        requestId: request.id,
        parsedMessage: {
          eventId: msg.eventId,
          senderNpub: msg.senderNpub,
          request: payload,
          senderFingerprint: 'nip46-client',
          nip46RequestId: request.id,
          nip46ReplyTo: msg.senderNpub,
        },
      });

      notifyCoSignRequest(payload.txId);
    });

    // Wakes a device waiting in `startSignPSBT`/`startSendBTC` for its co-signer to
    // commit, so both sides enter the native TSS window together.
    const offReady = nostrMessaging.onMessage(msg => {
      if (!mounted) return;
      if (msg.envelope.type !== 'COSIGN_READY') return;

      const payload = msg.envelope.payload as CoSignReadyPayload;
      if (!payload?.txId) return;

      dbg('[NIP46-TLM][NostrCoSignBridge] received COSIGN_READY, waking waiting signer', {
        txId: payload.txId,
        traceId: payload.traceId,
        senderNpub: msg.senderNpub,
      });

      DeviceEventEmitter.emit('nostr-cosign:ready', {
        ts: Date.now(),
        txId: payload.txId,
        traceId: payload.traceId,
        senderNpub: msg.senderNpub,
      });
    });

    return () => {
      mounted = false;
      offLegacy();
      offNip46();
      offReady();
    };
  }, [isAuthenticated, navigationRef, navigateToSignerOrQueue]);

  return null;
};

export default NostrCoSignBridge;
