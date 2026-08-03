import React from 'react';
import { DeviceEventEmitter } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import NostrCoSignBridge from '../components/NostrCoSignBridge';

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn();
const mockOnMessage = jest.fn();
const mockOnNip46Request = jest.fn();
const mockSendCoSignResponse = jest.fn().mockResolvedValue(undefined);
const mockSendNip46Response = jest.fn().mockResolvedValue(undefined);
const mockGetLocalNpub = jest.fn().mockReturnValue('npub1localexample');
const mockPsbtHexToBase64 = jest
  .fn()
  .mockReturnValue('cHNidP8BAFICAAAAAQAAAAAA');

const mockSetPending = jest.fn();
const mockClearPending = jest.fn();

jest.mock('../services/nostrMessaging', () => ({
  nostrMessaging: {
    connect: (...args: unknown[]) => mockConnect(...args),
    disconnect: (...args: unknown[]) => mockDisconnect(...args),
    onMessage: (...args: unknown[]) => mockOnMessage(...args),
    onNip46Request: (...args: unknown[]) => mockOnNip46Request(...args),
    sendCoSignResponse: (...args: unknown[]) => mockSendCoSignResponse(...args),
    sendNip46Response: (...args: unknown[]) => mockSendNip46Response(...args),
    getLocalNpub: (...args: unknown[]) => mockGetLocalNpub(...args),
    psbtHexToBase64: (...args: unknown[]) => mockPsbtHexToBase64(...args),
  },
}));

jest.mock('../services/nostrCoSignSession', () => ({
  setPendingCoSignRequest: (...args: unknown[]) => mockSetPending(...args),
  clearPendingCoSignRequest: (...args: unknown[]) => mockClearPending(...args),
}));

jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  CommonActions: {
    navigate: jest.fn((payload: unknown) => payload),
  },
}));

describe('NostrCoSignBridge', () => {
  const navigationDispatch = jest.fn();
  const navigationRef = {
    current: {
      dispatch: navigationDispatch,
    },
  } as any;

  const cosignMessage = {
    envelope: {
      id: 'env-1',
      type: 'COSIGN_REQUEST',
      senderFingerprint: 'peer-fp',
      recipientFingerprint: 'self-fp',
      timestamp: Date.now(),
      payload: {
        txId: 'tx-123',
        psbtHex: '70736274ff01005202000000',
        amountSats: 1200,
        feeSats: 24,
        recipientAddress: 'tb1qrecipientxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        network: 'testnet',
      },
    },
    senderNpub: 'npub1peerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    relayUrl: 'wss://relay.damus.io',
    eventId: 'evt-1',
  } as any;

  let messageListener: ((msg: any) => void | Promise<void>) | null = null;
  let nip46Listener: ((msg: any) => void | Promise<void>) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    messageListener = null;
    nip46Listener = null;

    mockOnMessage.mockImplementation((listener: (msg: any) => void | Promise<void>) => {
      messageListener = listener;
      return jest.fn();
    });

    mockOnNip46Request.mockImplementation((listener: (msg: any) => void | Promise<void>) => {
      nip46Listener = listener;
      return jest.fn();
    });

    jest.spyOn(DeviceEventEmitter, 'emit').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits chat feed + unread events for legacy COSIGN_REQUEST without opening modal', async () => {
    await act(async () => {
      TestRenderer.create(
        <NostrCoSignBridge isAuthenticated={true} navigationRef={navigationRef} />,
      );
    });

    await act(async () => {
      await messageListener?.(cosignMessage);
    });

    expect(mockSendCoSignResponse).not.toHaveBeenCalled();
    expect(navigationDispatch).not.toHaveBeenCalled();
    expect(DeviceEventEmitter.emit).toHaveBeenCalledWith(
      'nostr-cosign:request',
      expect.objectContaining({
        mode: 'legacy',
      }),
    );
    expect(DeviceEventEmitter.emit).toHaveBeenCalledWith(
      'nostr-chat:incoming',
      expect.objectContaining({
        type: 'COSIGN_REQUEST',
        mode: 'legacy',
      }),
    );
  });

  it('ignores malformed COSIGN_REQUEST with no psbtHex and no psbtBase64', async () => {
    await act(async () => {
      TestRenderer.create(
        <NostrCoSignBridge isAuthenticated={true} navigationRef={navigationRef} />,
      );
    });

    const malformed = {
      ...cosignMessage,
      envelope: {
        ...cosignMessage.envelope,
        payload: {
          ...cosignMessage.envelope.payload,
          psbtHex: '',
          psbtBase64: '',
        },
      },
    } as any;

    await act(async () => {
      await messageListener?.(malformed);
    });

    expect(mockSetPending).not.toHaveBeenCalled();
    expect(mockSendCoSignResponse).not.toHaveBeenCalled();
    expect(navigationDispatch).not.toHaveBeenCalled();
  });

  it('ignores non-COSIGN_REQUEST envelopes', async () => {
    await act(async () => {
      TestRenderer.create(
        <NostrCoSignBridge isAuthenticated={true} navigationRef={navigationRef} />,
      );
    });

    const chatMessage = {
      ...cosignMessage,
      envelope: {
        ...cosignMessage.envelope,
        type: 'CHAT_MESSAGE',
      },
    } as any;

    await act(async () => {
      await messageListener?.(chatMessage);
    });

    expect(mockSetPending).not.toHaveBeenCalled();
    expect(mockSendCoSignResponse).not.toHaveBeenCalled();
    expect(navigationDispatch).not.toHaveBeenCalled();
  });

  it('disconnects and clears pending session when unauthenticated', async () => {
    await act(async () => {
      TestRenderer.create(
        <NostrCoSignBridge isAuthenticated={false} navigationRef={navigationRef} />,
      );
    });

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockClearPending).toHaveBeenCalledTimes(1);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('auto-rejects placeholder NIP-46 PSBT payload before chat handoff', async () => {
    await act(async () => {
      TestRenderer.create(
        <NostrCoSignBridge isAuthenticated={true} navigationRef={navigationRef} />,
      );
    });

    await act(async () => {
      await nip46Listener?.({
        request: {
          id: 'req-nip46-1',
          method: 'sign_event',
          params: [
            {
              kind: 24133,
              content: JSON.stringify({
                txId: 'tx-nip46-1',
                psbtBase64: 'cHNidP8BAA==',
                amountSats: 500,
                feeSats: 10,
                recipientAddress: 'tb1qnip46recipient',
                network: 'testnet',
              }),
            },
          ],
        },
        senderNpub: 'npub1peerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        senderPubHex: 'c'.repeat(64),
        relayUrl: 'wss://relay.damus.io',
        eventId: 'evt-nip46-1',
      });
    });

    expect(mockSendNip46Response).toHaveBeenCalledWith(
      'npub1peerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      expect.objectContaining({
        id: 'req-nip46-1',
        error: expect.stringContaining('placeholder'),
      }),
    );
    expect(navigationDispatch).not.toHaveBeenCalled();
  });
});
