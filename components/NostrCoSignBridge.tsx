import React, { useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { CommonActions, type NavigationContainerRef } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { dbg } from '../utils';
import {
  nostrMessaging,
  type CoSignRequestPayload,
  type CoSignResponsePayload,
} from '../services/nostrMessaging';
import nostrMpcSession from '../services/nostrMpcSession';
import { clearPendingCoSignRequest } from '../services/nostrCoSignSession';

type Props = {
  isAuthenticated: boolean;
  isNavigationReady?: boolean;
  navigationRef: React.RefObject<NavigationContainerRef<any> | null>;
};

function emitBridgeTelemetry(event: string, extra?: Record<string, unknown>): void {
  DeviceEventEmitter.emit('nostr-bridge:telemetry', {
    event,
    ts: Date.now(),
    ...(extra || {}),
  });
}

const RECENT_EVENT_BUFFER_MS = 5 * 60 * 1000;
const MAX_RECENT_EVENTS = 30;
let recentCoSignFeedEvents: Array<Record<string, unknown>> = [];
let recentUnreadChatEvents: Array<Record<string, unknown>> = [];
let recentCoSignFocusEvents: Array<Record<string, unknown>> = [];

const MAX_PROCESSED_EVENT_IDS = 500;
const processedCoSignEventIds = new Set<string>();

function markCoSignEventProcessed(eventId: string | undefined): boolean {
  if (!eventId) return true;
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

export function getRecentCoSignFeedEvents(): Array<Record<string, unknown>> {
  const cutoff = Date.now() - RECENT_EVENT_BUFFER_MS;
  return recentCoSignFeedEvents.filter(e => Number(e.ts) >= cutoff);
}

export function getRecentUnreadChatEvents(): Array<Record<string, unknown>> {
  const cutoff = Date.now() - RECENT_EVENT_BUFFER_MS;
  return recentUnreadChatEvents.filter(e => Number(e.ts) >= cutoff);
}

export function getRecentCoSignFocusEvents(): Array<Record<string, unknown>> {
  const cutoff = Date.now() - RECENT_EVENT_BUFFER_MS;
  return recentCoSignFocusEvents.filter(e => Number(e.ts) >= cutoff);
}

function emitCoSignFocusEvent(txId: string, openRequest = true): void {
  const evt = { ts: Date.now(), txId, openRequest };
  recentCoSignFocusEvents = pruneAndPush(recentCoSignFocusEvents, evt);
  DeviceEventEmitter.emit('nostr-cosign:focus', evt);
}

function notifyCoSignRequest(txId: string | undefined): void {
  Toast.show({
    type: 'info',
    text1: 'New co-sign request',
    text2: txId ? `Tap to review transaction ${txId.slice(0, 12)}...` : 'Tap to review the pending request',
    visibilityTime: 15000,
    onPress: () => {
      Toast.hide();
      if (txId) emitCoSignFocusEvent(txId, true);
      const navRef = latestNavigationRef.current;
      if (navRef?.current) {
        navRef.current.dispatch(
          CommonActions.navigate('MainTabs', { screen: 'Chat' }),
        );
      }
    },
  });
}

const latestNavigationRef: {
  current: React.RefObject<NavigationContainerRef<any> | null> | null;
} = {
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
  latestNavigationRef.current = navigationRef;

  useEffect(() => {
    if (!isAuthenticated) {
      dbg('[NostrCoSignBridge] unauthenticated -> disconnecting Nostr bridge');
      emitBridgeTelemetry('auth-false');
      nostrMessaging.disconnect();
      clearPendingCoSignRequest();
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
    });

    const offLegacy = nostrMessaging.onMessage(async msg => {
      if (!mounted) return;
      if (
        msg.envelope.type !== 'COSIGN_REQUEST' &&
        msg.envelope.type !== 'COSIGN_RESPONSE'
      ) {
        return;
      }
      if (!markCoSignEventProcessed(msg.eventId)) {
        dbg('[NostrCoSignBridge] ignoring redelivered co-sign event', {
          eventId: msg.eventId,
          type: msg.envelope.type,
        });
        return;
      }

      if (msg.envelope.type === 'COSIGN_RESPONSE') {
        const payload = msg.envelope.payload as CoSignResponsePayload;
        const nextStatus = payload.approved ? 'signed' : 'rejected';

        DeviceEventEmitter.emit('nostr-cosign:status', {
          mode: 'legacy',
          txId: payload.txId,
          status: nextStatus,
        });

        emitUnreadChatEvent({
          type: 'COSIGN_RESPONSE',
          mode: 'legacy',
          txId: payload.txId,
          envelopeId: msg.envelope.id,
          parsedMessage: {
            eventId: msg.eventId,
            senderNpub: msg.senderNpub,
            request: payload,
            senderFingerprint: msg.envelope.senderFingerprint,
          },
        });
        return;
      }

      const payload = msg.envelope.payload as CoSignRequestPayload;
      const psbtBase64 = payload.psbtBase64 || (payload.psbtHex ? nostrMessaging.psbtHexToBase64(payload.psbtHex) : '');

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
        dbg('[NostrCoSignBridge] rejecting placeholder PSBT payload', {
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

      emitUnreadChatEvent({
        type: 'COSIGN_REQUEST',
        mode: 'legacy',
        txId: payload.txId,
        envelopeId: msg.envelope.id,
        parsedMessage: {
          eventId: msg.eventId,
          senderNpub: msg.senderNpub,
          request: payload,
          senderFingerprint: msg.envelope.senderFingerprint,
        },
      });

      notifyCoSignRequest(payload.txId);
    });

    const offReady = nostrMessaging.onMessage(msg => {
      if (!mounted) return;
      const type = String(msg.envelope.type || '');
      if (type !== 'COSIGN_READY' && type !== 'MPC_PAYLOAD') return;

      const payload =
        msg.envelope.payload && typeof msg.envelope.payload === 'object'
          ? (msg.envelope.payload as Record<string, unknown>)
          : {};
      const txId = typeof payload.txId === 'string' ? payload.txId : '';
      const traceId = typeof payload.traceId === 'string' ? payload.traceId : undefined;
      if (!txId) return;

      if (type === 'COSIGN_READY') {
        dbg('[NostrCoSignBridge] received COSIGN_READY, waking waiting signer', {
          txId,
          traceId,
          senderNpub: msg.senderNpub,
        });

        DeviceEventEmitter.emit('nostr-cosign:ready', {
          ts: Date.now(),
          txId,
          traceId,
          senderNpub: msg.senderNpub,
        });

        DeviceEventEmitter.emit('nostr-cosign:status', {
          mode: 'legacy',
          txId,
          status: 'signing',
        });

        nostrMpcSession.markPeerReady(txId, {
          traceId,
          senderNpub: msg.senderNpub,
        });
        return;
      }

      DeviceEventEmitter.emit('nostr-cosign:status', {
        mode: 'legacy',
        txId,
        status: 'signing',
      });

      nostrMpcSession.markPayloadReceived(txId, type, {
        traceId,
        senderNpub: msg.senderNpub,
      });
    });

    return () => {
      mounted = false;
      offLegacy();
      offReady();
    };
  }, [isAuthenticated, isNavigationReady, navigationRef]);

  return null;
};

export default NostrCoSignBridge;
