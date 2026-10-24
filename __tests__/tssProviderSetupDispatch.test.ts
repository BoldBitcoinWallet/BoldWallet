jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    dklsMpcTssSetup: jest.fn(),
    mpcTssSetup: jest.fn(),
    dklsNostrMpcTssSetup: jest.fn(),
    nostrMpcTssSetup: jest.fn(),
  },
}));

jest.mock('../services/tssBackend', () => ({
  resolveTssBackend: jest.fn(),
  resolveTssBackendForKeygen: jest.fn(async () => 'dkls23'),
  detectKeyshareTssBackend: jest.fn(),
}));

jest.mock('../services/mpcCancel', () => ({
  markMpcInProgress: jest.fn(),
  resetMpcCancelState: jest.fn(),
  safeCancelMpc: jest.fn(),
}));

// 3b-2a: TssProvider -> ceremonyAuth -> utils (op-sqlite); stub the logger.
jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

import {BBMTLibNativeModule} from '../native_modules';
import {resolveTssBackendForKeygen} from '../services/tssBackend';
import {parseStagedSetupResult, TssProvider} from '../services/TssProvider';

const native = BBMTLibNativeModule as any;
const resolveBackend = resolveTssBackendForKeygen as jest.Mock;

const STAGED_RAW = JSON.stringify({
  handle: 'staged-test-handle-1',
  metadata: {pub_key: 'aa', tss_backend: 'dkls23', suite: 'dkls23'},
});

const LEGACY_JSON = JSON.stringify({
  pub_key: 'bb',
  share_b64: 'UExBSU5URVhUX1NIQVJF',
  tss_backend: 'gg18',
});

beforeEach(() => {
  jest.clearAllMocks();
  resolveBackend.mockResolvedValue('dkls23');
});

describe('F15b-1 setup dispatch (TssProvider)', () => {
  test('LAN dkls23 returns staged handle+metadata, never full JSON', async () => {
    native.dklsMpcTssSetup.mockResolvedValue(STAGED_RAW);
    const res = await TssProvider.mpcTssSetup(
      'srv',
      'p1',
      'ppm',
      'p1,p2',
      'sid',
      'sk',
      'ek',
      'dk',
      'cc',
    );
    expect(native.dklsMpcTssSetup).toHaveBeenCalledTimes(1);
    expect(native.mpcTssSetup).not.toHaveBeenCalled();
    expect(res.kind).toBe('staged');
    if (res.kind === 'staged') {
      expect(res.handle).toBe('staged-test-handle-1');
      expect(res.metadata.pub_key).toBe('aa');
      expect(JSON.stringify(res)).not.toContain('share_b64');
    }
  });

  test('LAN gg18 returns explicit legacy-gg18 branch', async () => {
    resolveBackend.mockResolvedValue('gg18');
    native.mpcTssSetup.mockResolvedValue(LEGACY_JSON);
    const res = await TssProvider.mpcTssSetup(
      'srv',
      'p1',
      'ppm',
      'p1,p2',
      'sid',
      'sk',
      'ek',
      'dk',
      'cc',
    );
    expect(native.mpcTssSetup).toHaveBeenCalledTimes(1);
    expect(native.dklsMpcTssSetup).not.toHaveBeenCalled();
    expect(res).toEqual({kind: 'legacy-gg18', json: LEGACY_JSON});
  });

  test('Nostr dkls23 returns staged handle+metadata', async () => {
    native.dklsNostrMpcTssSetup.mockResolvedValue(STAGED_RAW);
    const res = await TssProvider.nostrMpcTssSetup(
      'relays',
      'nsec',
      'npubs',
      'sid',
      'sk',
      'cc',
      'ppm',
    );
    expect(native.dklsNostrMpcTssSetup).toHaveBeenCalledTimes(1);
    expect(native.nostrMpcTssSetup).not.toHaveBeenCalled();
    expect(res.kind).toBe('staged');
    if (res.kind === 'staged') {
      expect(res.handle).toBe('staged-test-handle-1');
      expect(JSON.stringify(res)).not.toContain('share_b64');
    }
  });

  test('Nostr gg18 returns explicit legacy-gg18 branch', async () => {
    resolveBackend.mockResolvedValue('gg18');
    native.nostrMpcTssSetup.mockResolvedValue(LEGACY_JSON);
    const res = await TssProvider.nostrMpcTssSetup(
      'relays',
      'nsec',
      'npubs',
      'sid',
      'sk',
      'cc',
      'ppm',
    );
    expect(native.nostrMpcTssSetup).toHaveBeenCalledTimes(1);
    expect(native.dklsNostrMpcTssSetup).not.toHaveBeenCalled();
    expect(res).toEqual({kind: 'legacy-gg18', json: LEGACY_JSON});
  });

  test('malformed staged envelope throws (non-JSON)', async () => {
    native.dklsMpcTssSetup.mockResolvedValue('not-json{{{');
    await expect(
      TssProvider.mpcTssSetup(
        'srv',
        'p1',
        'ppm',
        'p1,p2',
        'sid',
        'sk',
        'ek',
        'dk',
        'cc',
      ),
    ).rejects.toThrow('Invalid staged setup result');
  });

  test('malformed staged envelope throws (missing handle/metadata)', () => {
    expect(() => parseStagedSetupResult('{}')).toThrow(
      'Invalid staged setup result',
    );
    expect(() =>
      parseStagedSetupResult(JSON.stringify({handle: 'h'})),
    ).toThrow('Invalid staged setup result');
    expect(() =>
      parseStagedSetupResult(JSON.stringify({metadata: {}})),
    ).toThrow('Invalid staged setup result');
    expect(() =>
      parseStagedSetupResult(JSON.stringify({handle: '  ', metadata: {}})),
    ).toThrow('Invalid staged setup result');
  });

  test('full keyshare JSON is never accepted as a staged result', () => {
    // A DKLs native method returning legacy-shaped output must fail
    // closed, not flow into JS as an unmarked blob.
    expect(() => parseStagedSetupResult(LEGACY_JSON)).toThrow(
      'Invalid staged setup result',
    );
  });
});
