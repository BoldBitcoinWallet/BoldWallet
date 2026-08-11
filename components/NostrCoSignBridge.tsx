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
const MAX_PROCESSED_READY_PAYLOAD_KEYS = 1200;
const READY_PAYLOAD_DEDUPE_TTL_MS = 15_000;
const processedCoSignEventIds = new Set<string>();
const processedReadyPayloadEventKeys = new Map<string, number>();
const signerSubsetByTxId = new Map<string, Set<string>>();

function normalizeSignerList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map(v => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean),
    ),
  );
}

function cacheTargetSignerSubset(
  txId: string | undefined,
  values: unknown,
  signingNpubsCSV?: string,
): void {
  const id = String(txId || '').trim();
  if (!id) return;
  const signers = normalizeSignerList(values);
  const committeeSize = inferCommitteeSizeFromSigningCSV(signingNpubsCSV);
  if (signers.length === 0) {
    signerSubsetByTxId.delete(id);
    nostrMpcSession.clearSignerSubset(id);
    return;
  }
  signerSubsetByTxId.set(id, new Set(signers));
  nostrMpcSession.registerSignerSubset(id, signers, 1, committeeSize);
}

function inferCommitteeSizeFromSigningCSV(signingCsv?: string): number | undefined {
  const csv = typeof signingCsv === 'string' ? signingCsv : '';
  const count = csv
    .split(',')
    .map(v => v.trim())
    .filter(Boolean).length;
  if (count >= 2) return count;
  return undefined;
}

function isAllowedSignerForTx(txId: string, senderNpub: string): boolean {
  const id = String(txId || '').trim();
  const sender = String(senderNpub || '').trim();
  if (!id || !sender) return true;
  const allowed = signerSubsetByTxId.get(id);
  if (!allowed || allowed.size === 0) return true;
  return allowed.has(sender);
}

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

function markReadyOrPayloadProcessed(
  eventId: string | undefined,
  type: string,
  txId: string,
  traceId: string | undefined,
  senderNpub: string,
  senderFingerprint: string,
): boolean {
  const now = Date.now();
  const senderIdentity =
    String(senderNpub || '').trim() || String(senderFingerprint || '').trim() || 'unknown-sender';
  const semanticKey = [
    String(type || '').trim(),
    String(txId || '').trim(),
    String(traceId || '').trim(),
    senderIdentity,
  ].join('::');
  const strictEventKey = [
    String(eventId || '').trim() || 'no-event-id',
    String(type || '').trim(),
    String(txId || '').trim(),
    String(traceId || '').trim(),
    senderIdentity,
  ].join('::');
  const coarseReadyKey =
    String(type || '').trim() === 'COSIGN_READY'
      ? ['COSIGN_READY', String(txId || '').trim(), String(traceId || '').trim()].join('::')
      : '';

  const semanticPrev = processedReadyPayloadEventKeys.get(semanticKey);
  const strictPrev = processedReadyPayloadEventKeys.get(strictEventKey);
  const coarsePrev = coarseReadyKey
    ? processedReadyPayloadEventKeys.get(coarseReadyKey)
    : undefined;
  if (
    (semanticPrev && now - semanticPrev <= READY_PAYLOAD_DEDUPE_TTL_MS) ||
    (strictPrev && now - strictPrev <= READY_PAYLOAD_DEDUPE_TTL_MS) ||
    (coarsePrev && now - coarsePrev <= READY_PAYLOAD_DEDUPE_TTL_MS)
  ) {
    return false;
  }
  processedReadyPayloadEventKeys.set(semanticKey, now);
  processedReadyPayloadEventKeys.set(strictEventKey, now);
  if (coarseReadyKey) {
    processedReadyPayloadEventKeys.set(coarseReadyKey, now);
  }

  if (processedReadyPayloadEventKeys.size > MAX_PROCESSED_READY_PAYLOAD_KEYS) {
    const cutoff = now - READY_PAYLOAD_DEDUPE_TTL_MS;
    for (const [k, ts] of processedReadyPayloadEventKeys.entries()) {
      if (ts < cutoff) {
        processedReadyPayloadEventKeys.delete(k);
      }
    }
    if (processedReadyPayloadEventKeys.size > MAX_PROCESSED_READY_PAYLOAD_KEYS) {
      processedReadyPayloadEventKeys.clear();
      processedReadyPayloadEventKeys.set(semanticKey, now);
      processedReadyPayloadEventKeys.set(strictEventKey, now);
      if (coarseReadyKey) {
        processedReadyPayloadEventKeys.set(coarseReadyKey, now);
      }
    }
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

function compactFingerprintFromNpub(npub: string): string {
  const value = String(npub || '').trim();
  if (!value) return '';
  return `${value.slice(0, 4)}${value.slice(-4)}`;
}

function matchesSignerFingerprint(npub: string, fingerprint: string): boolean {
  const candidate = String(fingerprint || '').trim();
  if (!candidate) return false;
  const signer = String(npub || '').trim();
  if (!signer) return false;
  if (candidate === signer) return true;
  if (candidate === compactFingerprintFromNpub(signer)) return true;
  if (candidate === fingerprintFromNpub(signer)) return true;
  return false;
}

function resolveReadySenderWithDuoFallback(
  txId: string,
  senderNpub: string,
  senderFingerprint: string,
): string {
  const direct = String(senderNpub || '').trim();
  if (direct) return direct;
  if (!nostrMpcSession.isStrictDuoSession(txId)) {
    return '';
  }

  const guardSigners = nostrMpcSession.getRegisteredSigners(txId);
  const subsetSigners = Array.from(signerSubsetByTxId.get(txId) || []);
  const allowed = Array.from(new Set([...guardSigners, ...subsetSigners].map(v => String(v || '').trim()).filter(Boolean)));
  if (allowed.length !== 1) {
    return '';
  }

  const onlySigner = allowed[0];
  if (!matchesSignerFingerprint(onlySigner, senderFingerprint)) {
    return '';
  }

  dbg('[NostrCoSignBridge] duo fallback resolved missing sender npub from fingerprint', {
    txId,
    senderFingerprint,
    resolvedSigner: `${onlySigner.slice(0, 10)}...${onlySigner.slice(-6)}`,
  });
  return onlySigner;
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
      void nostrMessaging.ensureActiveSubscription('bridge-legacy-event').catch(err => {
        dbg('[NostrCoSignBridge] active subscription refresh failed (legacy)', err);
      });
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
      cacheTargetSignerSubset(payload.txId, payload.targetSigners, payload.signingNpubsCSV);
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

      const requestSenderNpub = resolveReadySenderWithDuoFallback(
        payload.txId,
        msg.senderNpub,
        String(msg.envelope.senderFingerprint || ''),
      ) || msg.senderNpub;

      emitCoSignFeedEvent({
        mode: 'legacy',
        eventId: msg.eventId,
        envelopeId: msg.envelope.id,
        senderNpub: requestSenderNpub,
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
          senderNpub: requestSenderNpub,
          request: payload,
          senderFingerprint: msg.envelope.senderFingerprint,
        },
      });

      notifyCoSignRequest(payload.txId);
    });

    const offReady = nostrMessaging.onMessage(msg => {
      if (!mounted) return;
      void nostrMessaging.ensureActiveSubscription('bridge-ready-event').catch(err => {
        dbg('[NostrCoSignBridge] active subscription refresh failed (ready)', err);
      });
      const type = String(msg.envelope.type || '');
      if (type !== 'COSIGN_READY' && type !== 'MPC_PAYLOAD') return;

      const payload =
        msg.envelope.payload && typeof msg.envelope.payload === 'object'
          ? (msg.envelope.payload as Record<string, unknown>)
          : {};
      const txId = typeof payload.txId === 'string' ? payload.txId : '';
      const traceId = typeof payload.traceId === 'string' ? payload.traceId : undefined;
      if (!txId) return;
      const resolvedSenderNpub = resolveReadySenderWithDuoFallback(
        txId,
        msg.senderNpub,
        String(msg.envelope.senderFingerprint || ''),
      ) || msg.senderNpub;
      if (
        !markReadyOrPayloadProcessed(
          msg.eventId,
          type,
          txId,
          traceId,
          resolvedSenderNpub,
          String(msg.envelope.senderFingerprint || ''),
        )
      ) {
        dbg('[NostrCoSignBridge] ignoring duplicate ready/payload event', {
          type,
          txId,
          traceId,
          eventId: msg.eventId,
          senderNpub: resolvedSenderNpub,
        });
        return;
      }

      if (type === 'COSIGN_READY') {
        if (!isAllowedSignerForTx(txId, resolvedSenderNpub)) {
          dbg('[NostrCoSignBridge] ignoring COSIGN_READY from non-target signer', {
            txId,
            senderNpub: resolvedSenderNpub,
            senderFingerprint: msg.envelope.senderFingerprint,
            targetSigners: Array.from(signerSubsetByTxId.get(txId) || []),
            strictDuo: nostrMpcSession.isStrictDuoSession(txId),
          });
          return;
        }
        dbg('[NostrCoSignBridge] received COSIGN_READY, waking waiting signer', {
          txId,
          traceId,
          senderNpub: resolvedSenderNpub,
          senderFingerprint: msg.envelope.senderFingerprint,
        });

        DeviceEventEmitter.emit('nostr-cosign:ready', {
          ts: Date.now(),
          txId,
          traceId,
          senderNpub: resolvedSenderNpub,
        });

        DeviceEventEmitter.emit('nostr-cosign:status', {
          mode: 'legacy',
          txId,
          status: 'signing',
        });

        nostrMpcSession.markPeerReady(txId, {
          traceId,
          senderNpub: resolvedSenderNpub,
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
        senderNpub: resolvedSenderNpub,
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
