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

import {
  normalizeCreatedAtMs,
  isLegacyWallet,
  resolveUseLegacyDerivationPaths,
  formatKeyshareCreatedAt,
  formatKeyshareCreatedAtLong,
  detectKeyshareTssBackend,
} from '../utils';

const PRE_CUTOFF_MS = 1765000000000;
const POST_CUTOFF_MS = 1766000000000;
/** ~2026 in Unix seconds (legacy DKLs export bug) */
const DKLS_SECONDS = 1779213151;

describe('normalizeCreatedAtMs', () => {
  it('returns null for empty input', () => {
    expect(normalizeCreatedAtMs(null)).toBeNull();
    expect(normalizeCreatedAtMs(undefined)).toBeNull();
  });

  it('converts seconds to milliseconds', () => {
    expect(normalizeCreatedAtMs(DKLS_SECONDS)).toBe(DKLS_SECONDS * 1000);
  });

  it('leaves millisecond values unchanged', () => {
    expect(normalizeCreatedAtMs(POST_CUTOFF_MS)).toBe(POST_CUTOFF_MS);
  });
});

describe('resolveUseLegacyDerivationPaths', () => {
  it('returns false for DKLs23 regardless of created_at', () => {
    expect(
      resolveUseLegacyDerivationPaths({
        tss_backend: 'dkls23',
        created_at: PRE_CUTOFF_MS,
        local_party_key: 'KeyShare1',
        keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
        pub_key: 'ab',
        chain_code_hex: 'cd',
        nostr_npub: null,
      }),
    ).toBe(false);
    expect(
      resolveUseLegacyDerivationPaths({
        tss_backend: 'dkls23',
        created_at: DKLS_SECONDS,
        local_party_key: 'KeyShare1',
        keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
        pub_key: 'ab',
        chain_code_hex: 'cd',
        nostr_npub: null,
      }),
    ).toBe(false);
  });

  it('returns true for GG18 pre-cutoff', () => {
    expect(
      resolveUseLegacyDerivationPaths({
        tss_backend: 'gg18',
        created_at: PRE_CUTOFF_MS,
        local_party_key: 'KeyShare1',
        keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
        pub_key: 'ab',
        chain_code_hex: 'cd',
        nostr_npub: null,
      }),
    ).toBe(true);
  });

  it('returns false for GG18 post-cutoff', () => {
    expect(
      resolveUseLegacyDerivationPaths({
        tss_backend: 'gg18',
        created_at: POST_CUTOFF_MS,
        local_party_key: 'KeyShare1',
        keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
        pub_key: 'ab',
        chain_code_hex: 'cd',
        nostr_npub: null,
      }),
    ).toBe(false);
  });

  it('infers dkls23 from share_b64 shape', () => {
    expect(
      resolveUseLegacyDerivationPaths({
        share_b64: 'abc',
        created_at: PRE_CUTOFF_MS,
        local_party_key: 'KeyShare1',
        keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
        pub_key: 'ab',
        chain_code_hex: 'cd',
        nostr_npub: null,
      } as any),
    ).toBe(false);
  });

  it('assumes legacy paths for missing created_at on GG18 shape', () => {
    expect(
      resolveUseLegacyDerivationPaths({
        ecdsa_local_data: {},
        local_party_key: 'KeyShare1',
        keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
        pub_key: 'ab',
        chain_code_hex: 'cd',
        nostr_npub: null,
      } as any),
    ).toBe(true);
  });
});

describe('formatKeyshareCreatedAtLong', () => {
  it('returns a long locale string for milliseconds', () => {
    const s = formatKeyshareCreatedAtLong(POST_CUTOFF_MS);
    expect(s).toBeTruthy();
    expect(s!.length).toBeGreaterThan(20);
  });

  it('returns null when missing', () => {
    expect(formatKeyshareCreatedAtLong(null)).toBeNull();
  });
});

describe('formatKeyshareCreatedAt', () => {
  it('formats millisecond timestamps', () => {
    const s = formatKeyshareCreatedAt(POST_CUTOFF_MS);
    expect(s).not.toBeNull();
    expect(s).toMatch(/2025|2026/);
  });

  it('formats second timestamps from legacy DKLs exports', () => {
    const s = formatKeyshareCreatedAt(DKLS_SECONDS);
    expect(s).not.toBeNull();
    expect(s).toMatch(/2025|2026/);
  });

  it('returns null when missing', () => {
    expect(formatKeyshareCreatedAt(null)).toBeNull();
  });
});

describe('isLegacyWallet', () => {
  it('uses millisecond cutoff only', () => {
    expect(isLegacyWallet(PRE_CUTOFF_MS)).toBe(true);
    expect(isLegacyWallet(POST_CUTOFF_MS)).toBe(false);
    expect(isLegacyWallet(null)).toBe(true);
  });
});

describe('detectKeyshareTssBackend', () => {
  it('detects dkls23 and gg18', () => {
    expect(detectKeyshareTssBackend({tss_backend: 'dkls23'})).toBe('dkls23');
    expect(detectKeyshareTssBackend({tss_backend: 'gg18'})).toBe('gg18');
    expect(
      detectKeyshareTssBackend({share_b64: 'x', ecdsa_local_data: null}),
    ).toBe('dkls23');
    expect(detectKeyshareTssBackend({ecdsa_local_data: {}})).toBe('gg18');
  });

  it('prefers gg18 when ecdsa_local_data is present (backward compat)', () => {
    expect(
      detectKeyshareTssBackend({ecdsa_local_data: {}, share_b64: 'x'}),
    ).toBe('gg18');
  });
});

describe('GG18 backward compatibility (metadata-only)', () => {
  const base = {
    local_party_key: 'KeyShare1',
    keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
    pub_key: 'ab',
    chain_code_hex: 'cd',
    nostr_npub: null,
  };

  it('legacy GG18 wallet (pre-cutoff) still uses BIP44-only paths', () => {
    expect(
      resolveUseLegacyDerivationPaths({
        ...base,
        tss_backend: 'gg18',
        created_at: PRE_CUTOFF_MS,
      }),
    ).toBe(true);
  });

  it('normal GG18 wallet (post-cutoff) still uses standard paths', () => {
    expect(
      resolveUseLegacyDerivationPaths({
        ...base,
        tss_backend: 'gg18',
        created_at: POST_CUTOFF_MS,
      }),
    ).toBe(false);
  });

  it('metadata without tss_backend defaults to GG18 timestamp rules', () => {
    expect(
      resolveUseLegacyDerivationPaths({
        ...base,
        created_at: PRE_CUTOFF_MS,
      }),
    ).toBe(true);
    expect(
      resolveUseLegacyDerivationPaths({
        ...base,
        created_at: POST_CUTOFF_MS,
      }),
    ).toBe(false);
  });
});
