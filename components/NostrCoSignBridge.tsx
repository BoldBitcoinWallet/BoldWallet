import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { CommonActions, type NavigationContainerRef } from '@react-navigation/native';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { dbg } from '../utils';
import {
  nostrMessaging,
  type CoSignRequestPayload,
  type CoSignResponsePayload,
} from '../services/nostrMessaging';
import {
  clearPendingCoSignRequest,
  setPendingCoSignRequest,
} from '../services/nostrCoSignSession';

type Props = {
  isAuthenticated: boolean;
  navigationRef: React.RefObject<NavigationContainerRef<any> | null>;
};

function fingerprintFromNpub(npub: string): string {
  if (!npub) return 'unknown';
  try {
    return bytesToHex(sha256(utf8ToBytes(npub))).slice(0, 8);
  } catch {
    return 'unknown';
  }
}

const NostrCoSignBridge = ({ isAuthenticated, navigationRef }: Props) => {
  useEffect(() => {
    if (!isAuthenticated) {
      nostrMessaging.disconnect();
      clearPendingCoSignRequest();
      return;
    }

    let mounted = true;
    const setup = async () => {
      try {
        await nostrMessaging.connect();
      } catch (err) {
        dbg('NostrCoSignBridge: failed to connect', err);
      }
    };
    void setup();

    const off = nostrMessaging.onMessage(async msg => {
      if (!mounted) return;
      if (msg.envelope.type !== 'COSIGN_REQUEST') return;

      const payload = msg.envelope.payload as CoSignRequestPayload;
      const psbtBase64 = payload.psbtBase64 || (payload.psbtHex ? nostrMessaging.psbtHexToBase64(payload.psbtHex) : '');
      if (!psbtBase64) {
        dbg('NostrCoSignBridge: request missing PSBT payload');
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

      const details = [
        `Amount: ${payload.amountSats} sats`,
        `Fee: ${payload.feeSats} sats`,
        `To: ${payload.recipientAddress}`,
      ].join('\n');

      Alert.alert('Co-Signing Request Received', details, [
        {
          text: 'Reject',
          style: 'destructive',
          onPress: () => {
            const response: CoSignResponsePayload = {
              txId: payload.txId,
              approved: false,
              reason: 'User rejected co-sign request on mobile wallet',
            };
            void nostrMessaging.sendCoSignResponse(
              msg.senderNpub,
              fingerprintFromNpub(nostrMessaging.getLocalNpub()),
              msg.envelope.senderFingerprint,
              response,
            );
            clearPendingCoSignRequest();
          },
        },
        {
          text: 'Open Signer',
          onPress: () => {
            navigationRef.current?.dispatch(
              CommonActions.navigate({
                name: 'MainTabs',
                params: {
                  screen: 'PSBT',
                  params: { sharedPsbtBase64: psbtBase64 },
                },
              }),
            );
          },
        },
      ]);
    });

    return () => {
      mounted = false;
      off();
    };
  }, [isAuthenticated, navigationRef]);

  return null;
};

export default NostrCoSignBridge;
