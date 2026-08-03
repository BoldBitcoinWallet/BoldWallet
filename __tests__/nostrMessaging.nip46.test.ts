import type {
  Nip46IncomingRequest,
  Nip46IncomingResponse,
} from '../services/nostrMessaging';

jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  },
}));

jest.mock('../utils', () => ({
  dbg: jest.fn(),
  getKeyshareMetadata: jest.fn().mockResolvedValue(null),
  getNostrRelays: jest.fn().mockResolvedValue(['wss://relay.damus.io']),
}));

const { nostrMessaging } = require('../services/nostrMessaging') as {
  nostrMessaging: any;
};

describe('nostrMessaging NIP-46 (mobile)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('parses incoming NIP-46 sign_event request and notifies listeners', async () => {
    const callbacks: Nip46IncomingRequest[] = [];
    const off = nostrMessaging.onNip46Request(msg => {
      callbacks.push(msg);
    });

    jest
      .spyOn(nostrMessaging as any, 'decryptFromSender')
      .mockResolvedValueOnce(
        JSON.stringify({
          id: 'req-abc',
          method: 'sign_event',
          params: [{ kind: 24133, content: '{"txId":"tx-1"}' }],
          secret: 'sec-1',
        }),
      );
    jest
      .spyOn(nostrMessaging as any, 'hexToNpub')
      .mockResolvedValueOnce('npub1peer');

    await (nostrMessaging as any).handleIncomingNip46Event(
      {
        id: 'evt-a',
        pubkey: 'a'.repeat(64),
        tags: [['x', 'bold-nip46-v1']],
        content: 'ciphertext',
      },
      'wss://relay.damus.io',
    );

    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].request.id).toBe('req-abc');
    expect(callbacks[0].request.method).toBe('sign_event');
    expect(callbacks[0].senderNpub).toBe('npub1peer');

    off();
  });

  it('resolves waitForNip46Response when matching response id is received', async () => {
    jest
      .spyOn(nostrMessaging as any, 'decryptFromSender')
      .mockResolvedValue(
        JSON.stringify({
          id: 'req-match',
          result: { signedPsbtHex: '70736274' },
        }),
      );
    jest
      .spyOn(nostrMessaging as any, 'hexToNpub')
      .mockResolvedValue('npub1peer');

    const waitPromise = nostrMessaging.waitForNip46Response('req-match', 2000);

    await (nostrMessaging as any).handleIncomingNip46Event(
      {
        id: 'evt-b',
        pubkey: 'b'.repeat(64),
        tags: [['x', 'bold-nip46-v1']],
        content: 'ciphertext',
      },
      'wss://nos.lol',
    );

    const resolved: Nip46IncomingResponse = await waitPromise;
    expect(resolved.response.id).toBe('req-match');
    expect((resolved.response.result as any).signedPsbtHex).toBe('70736274');
  });
});
