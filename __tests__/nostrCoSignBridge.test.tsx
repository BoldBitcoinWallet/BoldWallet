import React from 'react';
import { Alert } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import NostrCoSignBridge from '../components/NostrCoSignBridge';

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn();
const mockOnMessage = jest.fn();
const mockSendCoSignResponse = jest.fn().mockResolvedValue(undefined);
const mockGetLocalNpub = jest.fn().mockReturnValue('npub1localexample');
const mockPsbtHexToBase64 = jest.fn().mockReturnValue('cHNidP8BAA==');

const mockSetPending = jest.fn();
const mockClearPending = jest.fn();

jest.mock('../services/nostrMessaging', () => ({
  nostrMessaging: {
    connect: (...args: unknown[]) => mockConnect(...args),
    disconnect: (...args: unknown[]) => mockDisconnect(...args),
    onMessage: (...args: unknown[]) => mockOnMessage(...args),
    sendCoSignResponse: (...args: unknown[]) => mockSendCoSignResponse(...args),
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
        psbtHex: '70736274',
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

  beforeEach(() => {
    jest.clearAllMocks();
    messageListener = null;

    mockOnMessage.mockImplementation((listener: (msg: any) => void | Promise<void>) => {
      messageListener = listener;
      return jest.fn();
    });

    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reject action emits COSIGN_RESPONSE approved=false and clears pending session', async () => {
    await act(async () => {
      TestRenderer.create(
        <NostrCoSignBridge isAuthenticated={true} navigationRef={navigationRef} />,
      );
    });

    await act(async () => {
      await messageListener?.(cosignMessage);
    });

    expect(Alert.alert).toHaveBeenCalled();
    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const actions = alertCall[2] as Array<{ text: string; onPress?: () => void }>;
    const rejectAction = actions.find(a => a.text === 'Reject');

    expect(rejectAction).toBeTruthy();

    await act(async () => {
      rejectAction?.onPress?.();
    });

    expect(mockSendCoSignResponse).toHaveBeenCalledWith(
      cosignMessage.senderNpub,
      expect.any(String),
      cosignMessage.envelope.senderFingerprint,
      expect.objectContaining({
        txId: 'tx-123',
        approved: false,
      }),
    );
    expect(mockClearPending).toHaveBeenCalled();
  });

  it('open signer action navigates to PSBT screen with shared PSBT payload', async () => {
    await act(async () => {
      TestRenderer.create(
        <NostrCoSignBridge isAuthenticated={true} navigationRef={navigationRef} />,
      );
    });

    await act(async () => {
      await messageListener?.(cosignMessage);
    });

    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const actions = alertCall[2] as Array<{ text: string; onPress?: () => void }>;
    const openSignerAction = actions.find(a => a.text === 'Open Signer');

    expect(openSignerAction).toBeTruthy();

    await act(async () => {
      openSignerAction?.onPress?.();
    });

    expect(navigationDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'MainTabs',
        params: {
          screen: 'PSBT',
          params: { sharedPsbtBase64: 'cHNidP8BAA==' },
        },
      }),
    );
  });

  it('does not show alert when COSIGN_REQUEST has no psbtHex and no psbtBase64', async () => {
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

    expect(Alert.alert).not.toHaveBeenCalled();
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

    expect(Alert.alert).not.toHaveBeenCalled();
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
});
