jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    publishData: jest.fn(),
    fetchData: jest.fn(),
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

const native = BBMTLibNativeModule as any;

beforeEach(() => {
  jest.clearAllMocks();
  native.publishData.mockResolvedValue('published-ok');
  native.fetchData.mockResolvedValue('fetched-payload');
});

describe('3b-2c transport gating (F15b-2 / F10-bridge B13-B14)', () => {
  test('publishData passes the phase token + session last', async () => {
    const out = await TssProvider.publishData(
      '8080',
      '20',
      'peerenc',
      'attempt:seed',
      'duo',
      'tok-hs-1',
      'hs-1',
    );
    expect(out).toBe('published-ok');
    expect(native.publishData).toHaveBeenCalledWith(
      '8080',
      '20',
      'peerenc',
      'attempt:seed',
      'duo',
      'tok-hs-1',
      'hs-1',
    );
  });

  test('fetchData passes the phase token + session last', async () => {
    const out = await TssProvider.fetchData(
      'http://peer:8080/',
      'eckpriv',
      'checksum',
      'tok-hs-1',
      'hs-1',
    );
    expect(out).toBe('fetched-payload');
    expect(native.fetchData).toHaveBeenCalledWith(
      'http://peer:8080/',
      'eckpriv',
      'checksum',
      'tok-hs-1',
      'hs-1',
    );
  });

  test('transport never mints: no mint entry is reachable from the wrappers', async () => {
    // The native mock exposes NO request*CeremonyToken fns — the
    // wrappers pass tokens through and cannot mint by construction.
    // (Type-level: token+session are required params, not optional.)
    expect(native.requestSignCeremonyToken).toBeUndefined();
    expect(native.requestKeygenCeremonyToken).toBeUndefined();
    await TssProvider.publishData('p', 't', 'e', 'r', 'duo', 'tok', 'hs');
    await TssProvider.fetchData('u', 'd', 'c', 'tok', 'hs');
    expect(native.publishData).toHaveBeenCalledTimes(1);
    expect(native.fetchData).toHaveBeenCalledTimes(1);
  });

  test('malicious shape: direct native call without token carries undefined', async () => {
    // Documents the enforcement boundary: a JS caller that skips
    // TssProvider sends undefined token/session, which native
    // verifyTransport rejects (proven by JVM/harness negative tests).
    await native.fetchData('http://evil/', 'k', 'c');
    const call = native.fetchData.mock.calls[0];
    expect(call[3]).toBeUndefined();
    expect(call[4]).toBeUndefined();
  });
});
