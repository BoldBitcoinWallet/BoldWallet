jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: {show: jest.fn()},
}));

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));
jest.mock('react-native-encrypted-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../services/LocalCache', () => ({
  __esModule: true,
  default: {clear: jest.fn()},
}));
jest.mock('../App', () => ({
  isDebugLoggingEnabled: () => false,
}));
jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {},
}));
jest.mock('../services/tssBackend', () => ({
  detectKeyshareTssBackend: jest.fn(),
}));

import {
  abortTrioECDHTransport,
  beginTrioECDHTransport,
  confirmTrioECDHTransport,
  confirmTrioSasWithUser,
  parseEciesKeypairJson,
  resolveLanKeygenTransportKeys,
} from '../services/lanMpcTransport';
import {currentAppPrompt, respondAppPrompt} from '../services/appPrompt';

describe('lanMpcTransport', () => {
  it('parseEciesKeypairJson accepts valid keypair', () => {
    const jkp = JSON.stringify({
      publicKey: '04abc',
      privateKey: 'deadbeef',
    });
    expect(parseEciesKeypairJson(jkp)).toEqual({
      publicKey: '04abc',
      privateKey: 'deadbeef',
    });
  });

  it('resolveLanKeygenTransportKeys duo requires peer pubkey', async () => {
    const jkp = JSON.stringify({publicKey: '04a', privateKey: '0b'});
    await expect(
      resolveLanKeygenTransportKeys({
        isTrio: false,
        keypairJson: jkp,
        peerPubkey: '',
        sessionID: 'sess',
        masterHost: '192.168.1.1',
        sha256: async () => 'hash',
      }),
    ).rejects.toThrow(/pairing keys missing/i);
  });

  it('resolveLanKeygenTransportKeys duo returns ECIES keys', async () => {
    const jkp = JSON.stringify({publicKey: '04a', privateKey: '0b'});
    const t = await resolveLanKeygenTransportKeys({
      isTrio: false,
      keypairJson: jkp,
      peerPubkey: '04peer',
      sessionID: 'sess',
      masterHost: '192.168.1.1',
      sha256: async () => 'hash',
    });
    expect(t).toEqual({sessionKey: '', encKey: '04peer', decKey: '0b'});
  });

  it('resolveLanKeygenTransportKeys trio refuses the retired derivation', async () => {
    const jkp = JSON.stringify({publicKey: '04a', privateKey: '0b'});
    await expect(
      resolveLanKeygenTransportKeys({
        isTrio: true,
        keypairJson: jkp,
        peerPubkey: '04peer',
        sessionID: 'sess',
        masterHost: '10.0.0.1',
        sha256: async () => 'derived',
      }),
    ).rejects.toThrow(/public derivation retired \(F32\)/);
  });
});

describe('lanMpcTransport trio ECDH (F32)', () => {
  const bridge = (over: Record<string, jest.Mock> = {}) => ({
    trioECDHPhase1: jest.fn(),
    trioECDHConfirm: jest.fn(),
    trioECDHAbort: jest.fn(),
    ...over,
  });

  it('begin returns handle+sas from phase-1 JSON', async () => {
    const b = bridge({
      trioECDHPhase1: jest.fn().mockResolvedValue(
        JSON.stringify({handle: 'h1', sas: '482910', parties: 'a,b'}),
      ),
    });
    await expect(
      beginTrioECDHTransport({
        server: 'http://x',
        sessionID: 'sess',
        partyID: 'a',
        partiesCSV: 'a,b',
        bridge: b,
      }),
    ).resolves.toEqual({handle: 'h1', sas: '482910'});
    expect(b.trioECDHPhase1).toHaveBeenCalledWith(
      'http://x',
      'sess',
      'a',
      'a,b',
    );
  });

  it('begin rejects malformed SAS', async () => {
    const b = bridge({
      trioECDHPhase1: jest
        .fn()
        .mockResolvedValue(JSON.stringify({handle: 'h1', sas: '12'})),
    });
    await expect(
      beginTrioECDHTransport({
        server: 'http://x',
        sessionID: 'sess',
        partyID: 'a',
        partiesCSV: 'a,b',
        bridge: b,
      }),
    ).rejects.toThrow(/invalid reply/);
  });

  it('begin maps TRIO_PEER_OUTDATED to the update-all-devices error', async () => {
    const b = bridge({
      trioECDHPhase1: jest
        .fn()
        .mockRejectedValue(new Error('TRIO_PEER_OUTDATED: nope')),
    });
    await expect(
      beginTrioECDHTransport({
        server: 'http://x',
        sessionID: 'sess',
        partyID: 'a',
        partiesCSV: 'a,b',
        bridge: b,
      }),
    ).rejects.toThrow(/outdated app version/);
  });

  it('confirm returns lowercased 64-hex session key', async () => {
    const b = bridge({
      trioECDHConfirm: jest.fn().mockResolvedValue('AB'.repeat(32)),
    });
    await expect(
      confirmTrioECDHTransport('h1', 'sess', b),
    ).resolves.toBe('ab'.repeat(32));
  });

  it('confirm rejects a malformed session key', async () => {
    const b = bridge({
      trioECDHConfirm: jest.fn().mockResolvedValue('short'),
    });
    await expect(confirmTrioECDHTransport('h1', 'sess', b)).rejects.toThrow(
      /invalid session key/,
    );
  });

  it('abort is best-effort (bridge reject still resolves)', async () => {
    const b = bridge({
      trioECDHAbort: jest.fn().mockRejectedValue(new Error('down')),
    });
    await expect(abortTrioECDHTransport('h1', b)).resolves.toBeUndefined();
    expect(b.trioECDHAbort).toHaveBeenCalledWith('h1');
  });

  it('SAS sheet resolves true when the codes match, false when they differ', async () => {
    const matched = confirmTrioSasWithUser('482910');
    expect(currentAppPrompt()?.code).toBe('482910');
    expect(currentAppPrompt()?.title).toBe('Match the codes');
    respondAppPrompt(true);
    await expect(matched).resolves.toBe(true);

    const differed = confirmTrioSasWithUser('482910');
    expect(currentAppPrompt()?.code).toBe('482910');
    respondAppPrompt(false);
    await expect(differed).resolves.toBe(false);
  });
});
