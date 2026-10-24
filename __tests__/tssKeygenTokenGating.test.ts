jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    dklsMpcTssSetup: jest.fn(),
    mpcTssSetup: jest.fn(),
    dklsNostrMpcTssSetup: jest.fn(),
    nostrMpcTssSetup: jest.fn(),
    nostrKeypair: jest.fn(),
    eciesKeypair: jest.fn(),
    requestKeygenCeremonyToken: jest.fn(),
    completeCeremonyToken: jest.fn(),
    releaseCeremonyToken: jest.fn(),
    sha256: jest.fn(async (s: string) => `sha256(${s})`),
  },
}));

jest.mock('../services/tssBackend', () => ({
  resolveTssBackend: jest.fn(),
  resolveTssBackendForKeygen: jest.fn(),
  detectKeyshareTssBackend: jest.fn(),
}));

jest.mock('../services/mpcCancel', () => ({
  markMpcInProgress: jest.fn(),
  resetMpcCancelState: jest.fn(),
  safeCancelMpc: jest.fn(),
}));

// TssProvider -> ceremonyAuth -> utils (op-sqlite); stub the logger.
jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

import {BBMTLibNativeModule} from '../native_modules';
import {TssProvider} from '../services/TssProvider';
import {resolveTssBackendForKeygen} from '../services/tssBackend';

const native = BBMTLibNativeModule as any;
const resolveBackend = resolveTssBackendForKeygen as jest.Mock;

const STAGED_RAW = JSON.stringify({
  handle: 'staged-keygen-1',
  metadata: {pub_key: 'aa', tss_backend: 'dkls23', suite: 'dkls23'},
});

beforeEach(() => {
  jest.clearAllMocks();
  resolveBackend.mockResolvedValue('dkls23');
  native.requestKeygenCeremonyToken.mockResolvedValue('tok-keygen-1');
  native.completeCeremonyToken.mockResolvedValue(true);
  native.releaseCeremonyToken.mockResolvedValue(true);
  native.dklsMpcTssSetup.mockResolvedValue(STAGED_RAW);
  native.dklsNostrMpcTssSetup.mockResolvedValue(STAGED_RAW);
  native.nostrKeypair.mockResolvedValue('{"nsec":"nsec1x","npub":"npub1x"}');
  native.eciesKeypair.mockResolvedValue('{"pub":"aa","priv":"bb"}');
});

describe('3b-2b keygen token gating (F15b-2 / F10-bridge B9-B12, B20-B21)', () => {
  test('mpcTssSetup mints a keygen token for its session, passes it last', async () => {
    const res = await TssProvider.mpcTssSetup(
      'srv',
      'p1',
      'ppm',
      'p1,p2',
      'sess-kg-1',
      'sk',
      'ek',
      'dk',
      'cc',
    );
    expect(res.kind).toBe('staged');
    expect(native.requestKeygenCeremonyToken).toHaveBeenCalledWith(
      'sess-kg-1',
    );
    const call = native.dklsMpcTssSetup.mock.calls[0];
    expect(call[call.length - 1]).toBe('tok-keygen-1');
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-keygen-1');
  });

  test('nostrMpcTssSetup mints a keygen token for its session', async () => {
    const res = await TssProvider.nostrMpcTssSetup(
      'relays',
      'nsec-input',
      'npubs',
      'sess-kg-2',
      'sk',
      'cc',
      'ppm',
    );
    expect(res.kind).toBe('staged');
    expect(native.requestKeygenCeremonyToken).toHaveBeenCalledWith(
      'sess-kg-2',
    );
    const call = native.dklsNostrMpcTssSetup.mock.calls[0];
    expect(call[call.length - 1]).toBe('tok-keygen-1');
  });

  test('setup failure releases the minted token', async () => {
    native.dklsMpcTssSetup.mockRejectedValueOnce(new Error('dkg boom'));
    await expect(
      TssProvider.mpcTssSetup(
        'srv',
        'p1',
        'ppm',
        'p1,p2',
        'sess-kg-3',
        'sk',
        'ek',
        'dk',
        'cc',
      ),
    ).rejects.toThrow('dkg boom');
    expect(native.releaseCeremonyToken).toHaveBeenCalledWith('tok-keygen-1');
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
  });

  test('owner-provided keygen token passes through with no lifecycle', async () => {
    const res = await TssProvider.mpcTssSetup(
      'srv',
      'p1',
      'ppm',
      'p1,p2',
      'sess-kg-4',
      'sk',
      'ek',
      'dk',
      'cc',
      undefined,
      undefined,
      'tok-owner-kg',
    );
    expect(res.kind).toBe('staged');
    expect(native.requestKeygenCeremonyToken).not.toHaveBeenCalled();
    const call = native.dklsMpcTssSetup.mock.calls[0];
    expect(call[call.length - 1]).toBe('tok-owner-kg');
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
    expect(native.releaseCeremonyToken).not.toHaveBeenCalled();
  });

  test('GG18 mpcTssSetup mints a keygen token for its session (3b-6)', async () => {
    resolveBackend.mockResolvedValueOnce('gg18');
    native.mpcTssSetup.mockResolvedValueOnce('{"pub_key":"bb"}');
    const res = await TssProvider.mpcTssSetup(
      'srv',
      'p1',
      'ppm',
      'p1,p2',
      'sess-kg-5',
      'sk',
      'ek',
      'dk',
      'cc',
    );
    expect(res.kind).toBe('legacy-gg18');
    expect(native.requestKeygenCeremonyToken).toHaveBeenCalledWith(
      'sess-kg-5',
    );
    const call = native.mpcTssSetup.mock.calls[0];
    expect(call[call.length - 1]).toBe('tok-keygen-1');
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-keygen-1');
  });

  test('GG18 nostrMpcTssSetup mints a keygen token for its session (3b-6)', async () => {
    resolveBackend.mockResolvedValueOnce('gg18');
    native.nostrMpcTssSetup.mockResolvedValueOnce('{"pub_key":"cc"}');
    const res = await TssProvider.nostrMpcTssSetup(
      'relays',
      'nsec-input',
      'npubs',
      'sess-kg-6',
      'sk',
      'cc',
      'ppm',
    );
    expect(res.kind).toBe('legacy-gg18');
    expect(native.requestKeygenCeremonyToken).toHaveBeenCalledWith(
      'sess-kg-6',
    );
    const call = native.nostrMpcTssSetup.mock.calls[0];
    expect(call[call.length - 1]).toBe('tok-keygen-1');
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-keygen-1');
  });

  test('GG18 setup mint failure never reaches the native call (3b-6)', async () => {
    resolveBackend.mockResolvedValueOnce('gg18');
    native.requestKeygenCeremonyToken.mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), {
        code: 'CEREMONY_AUTH_REQUIRED',
      }),
    );
    await expect(
      TssProvider.mpcTssSetup(
        'srv',
        'p1',
        'ppm',
        'p1,p2',
        'sess-kg-7',
        'sk',
        'ek',
        'dk',
        'cc',
      ),
    ).rejects.toThrow();
    expect(native.mpcTssSetup).not.toHaveBeenCalled();
  });

  test('nostrKeypair mints a fresh single-call keygen ceremony (B20)', async () => {
    const out = await TssProvider.nostrKeypair();
    expect(out).toContain('npub1x');
    expect(native.requestKeygenCeremonyToken).toHaveBeenCalledTimes(1);
    const mintedSession = native.requestKeygenCeremonyToken.mock.calls[0][0];
    expect(typeof mintedSession).toBe('string');
    expect(mintedSession.length).toBeGreaterThan(0);
    expect(native.nostrKeypair).toHaveBeenCalledWith('tok-keygen-1');
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-keygen-1');
  });

  test('eciesKeypair mints a fresh single-call keygen ceremony (B21)', async () => {
    const out = await TssProvider.eciesKeypair();
    expect(out).toContain('"pub"');
    expect(native.requestKeygenCeremonyToken).toHaveBeenCalledTimes(1);
    expect(native.eciesKeypair).toHaveBeenCalledWith('tok-keygen-1');
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-keygen-1');
  });

  test('keypair mint failure never reaches the generator', async () => {
    native.requestKeygenCeremonyToken.mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), {
        code: 'CEREMONY_AUTH_REQUIRED',
      }),
    );
    await expect(TssProvider.nostrKeypair()).rejects.toThrow();
    expect(native.nostrKeypair).not.toHaveBeenCalled();
  });
});
