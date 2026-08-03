import React, { useCallback, useEffect, useRef } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { CommonActions, type NavigationContainerRef } from '@react-navigation/native';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { dbg } from '../utils';
import {
  nostrMessaging,
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

function emitCoSignFeedEvent(payload: Record<string, unknown>): void {
  DeviceEventEmitter.emit('nostr-cosign:request', {
    ts: Date.now(),
    ...payload,
  });
}

function emitUnreadChatEvent(payload: Record<string, unknown>): void {
  DeviceEventEmitter.emit('nostr-chat:incoming', {
    ts: Date.now(),
    ...payload,
  });
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
          CommonActions.navigate({
            name: 'MainTabs',
            params: {
              screen: 'PSBT',
              params: {
                sharedPsbtBase64: psbtBase64,
                nip46RequestId: opts?.nip46RequestId,
                nip46ReplyTo: opts?.nip46ReplyTo,
                autoSign: !!opts?.autoSign,
              },
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
      CommonActions.navigate({
        name: 'MainTabs',
        params: {
          screen: 'PSBT',
          params: {
            sharedPsbtBase64: pending.psbtBase64,
            nip46RequestId: pending.nip46RequestId,
            nip46ReplyTo: pending.nip46ReplyTo,
            autoSign: !!pending.autoSign,
          },
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

      const payload = msg.envelope.payload as CoSignRequestPayload;
      const psbtBase64 = payload.psbtBase64 || (payload.psbtHex ? nostrMessaging.psbtHexToBase64(payload.psbtHex) : '');
      if (!psbtBase64) {
        dbg('NostrCoSignBridge: request missing PSBT payload');
        return;
      }

      if (isPlaceholderPsbt(psbtBase64, payload.psbtHex || '')) {
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

      emitUnreadChatEvent({
        type: 'COSIGN_REQUEST',
        mode: 'legacy',
        txId: payload.txId,
        requestId: msg.envelope.id,
      });
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
      });
    });

    return () => {
      mounted = false;
      offLegacy();
      offNip46();
    };
  }, [isAuthenticated, navigationRef, navigateToSignerOrQueue]);

  return null;
};

export default NostrCoSignBridge;
