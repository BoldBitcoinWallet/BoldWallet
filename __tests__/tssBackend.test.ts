jest.mock('../services/repositories/AppConfigRepository', () => {
  let optedOut = false;
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getBool: jest.fn((_key: string, _def: boolean) => optedOut),
      setBool: jest.fn((_key: string, value: boolean) => {
        optedOut = value;
      }),
      set: jest.fn((key: string, value: string) => {
        store[key] = value;
      }),
      get: jest.fn((key: string) => store[key] ?? null),
      remove: jest.fn((key: string) => {
        delete store[key];
      }),
    },
    CONFIG_KEYS: {
      DKLS23_OPTED_OUT: 'dkls23_opted_out',
      KEYSHARE_META_JSON: 'keyshare_meta_json',
    },
  };
});

import {
  detectKeyshareTssBackend,
  resolveHookProgressBackend,
  resolveTssBackendFromCachedMeta,
} from '../services/tssBackend';
import {
  getKeygenTssBackendPreference,
  setKeygenTssBackendPreference,
} from '../services/tssConfig';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';

describe('detectKeyshareTssBackend', () => {
  it('returns gg18 for null', () => {
    expect(detectKeyshareTssBackend(null)).toBe('gg18');
  });

  it('respects explicit tss_backend', () => {
    expect(detectKeyshareTssBackend({tss_backend: 'dkls23'})).toBe('dkls23');
    expect(detectKeyshareTssBackend({tss_backend: 'gg18'})).toBe('gg18');
  });

  it('prefers ecdsa_local_data over share_b64 when backend absent', () => {
    expect(
      detectKeyshareTssBackend({
        ecdsa_local_data: {x: 1},
        share_b64: 'abc',
      }),
    ).toBe('gg18');
  });

  it('infers dkls23 from share_b64 alone', () => {
    expect(detectKeyshareTssBackend({share_b64: 'abc'})).toBe('dkls23');
  });
});

describe('resolveHookProgressBackend', () => {
  it('uses cached meta when spend backend not loaded yet', () => {
    const repo = appConfigRepository as {
      set: (k: string, v: string) => void;
    };
    repo.set(
      CONFIG_KEYS.KEYSHARE_META_JSON,
      JSON.stringify({tss_backend: 'dkls23', share_b64: 'x'}),
    );
    expect(resolveTssBackendFromCachedMeta()).toBe('dkls23');
    expect(
      resolveHookProgressBackend({
        isSpendFlow: true,
        spendBackend: null,
        keygenBackend: null,
      }),
    ).toBe('dkls23');
    repo.set(CONFIG_KEYS.KEYSHARE_META_JSON, '');
  });

  it('prefers explicit spend backend over cache', () => {
    expect(
      resolveHookProgressBackend({
        isSpendFlow: true,
        spendBackend: 'gg18',
        keygenBackend: 'dkls23',
      }),
    ).toBe('gg18');
  });

  it('uses keygen preference when keygen backend not loaded', () => {
    appConfigRepository.setBool(CONFIG_KEYS.DKLS23_OPTED_OUT, false);
    expect(
      resolveHookProgressBackend({
        isSpendFlow: false,
        spendBackend: null,
        keygenBackend: null,
      }),
    ).toBe('dkls23');
    setKeygenTssBackendPreference('gg18');
    expect(
      resolveHookProgressBackend({
        isSpendFlow: false,
        spendBackend: null,
        keygenBackend: null,
      }),
    ).toBe('gg18');
    setKeygenTssBackendPreference('dkls23');
  });
});

describe('keygen preference', () => {
  it('defaults to dkls23', () => {
    setKeygenTssBackendPreference('dkls23');
    expect(getKeygenTssBackendPreference()).toBe('dkls23');
  });

  it('persists gg18 opt-out', () => {
    setKeygenTssBackendPreference('gg18');
    expect(getKeygenTssBackendPreference()).toBe('gg18');
    expect(appConfigRepository.getBool(CONFIG_KEYS.DKLS23_OPTED_OUT, false)).toBe(
      true,
    );
    setKeygenTssBackendPreference('dkls23');
  });
});
