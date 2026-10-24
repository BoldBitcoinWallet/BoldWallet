jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    mpcSignPSBT: jest.fn(),
    nostrMpcSignPSBT: jest.fn(),
    dklsMpcSignPSBT: jest.fn(),
    dklsNostrMpcSignPSBT: jest.fn(),
    requestSignCeremonyToken: jest.fn(),
    completeCeremonyToken: jest.fn(),
    releaseCeremonyToken: jest.fn(),
    sha256: jest.fn(async (s: string) => `sha256(${s})`),
  },
}));

// 3b-6: tssBackend is deliberately NOT mocked — the point of this
// suite is the real legacy-GG18 detection and resolution path.
jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {
    getBool: jest.fn((_key: string, def: boolean) => def),
    setBool: jest.fn(),
    set: jest.fn(),
    get: jest.fn((_key: string) => null),
    remove: jest.fn(),
  },
  CONFIG_KEYS: {
    DKLS23_OPTED_OUT: 'dkls23_opted_out',
    KEYSHARE_META_JSON: 'keyshare_meta_json',
  },
}));

jest.mock('../services/mpcCancel', () => ({
  markMpcInProgress: jest.fn(),
  resetMpcCancelState: jest.fn(),
  safeCancelMpc: jest.fn(),
}));

// Legacy GG18 keyshare shape mirrors BBMTLib/tss LocalState JSON
// (pub_key, ecdsa_local_data, keygen_committee_keys, local_party_key,
// chain_code_hex, created_at) as written before the token core —
// critically, WITHOUT tss_backend.
const LEGACY_GG18_KEYSHARE = {
  pub_key: `03${'ab'.repeat(32)}`,
  ecdsa_local_data: {
    LocalPreParams: {PaillierSK: {D: 'redacted-fixture'}},
    Ks: ['1', '2'],
    PartyID: 'p1-fixture',
    ShareID: 'fixture-share',
    ECDSAPub: {X: 'fixture-x', Y: 'fixture-y', Curve: 'secp256k1'},
  },
  keygen_committee_keys: ['p1-fixture', 'p2-fixture'],
  local_party_key: 'p1-fixture',
  chain_code_hex: 'cc'.repeat(32),
  created_at: 1710000000,
};

// Stored metadata for a legacy user: allowlisted fields only, no
// tss_backend (predates backend tagging).
const LEGACY_GG18_META = {
  pub_key: LEGACY_GG18_KEYSHARE.pub_key,
  suite: 'gg18',
};

jest.mock('../utils', () => ({
  dbg: jest.fn(),
  getKeyshareMetadata: jest.fn(),
}));

import {BBMTLibNativeModule} from '../native_modules';
import {TssProvider} from '../services/TssProvider';
import {
  detectKeyshareTssBackend,
  resolveTssBackend,
} from '../services/tssBackend';
import {getKeyshareMetadata} from '../utils';

const native = BBMTLibNativeModule as any;

// Strict-native simulator (same contract as the L5 suite): the mock
// native enforces class + session binding, so a passing ceremony
// proves the JS side produced a gate-acceptable call.
const mintRegistry = new Map<string, {op: string; session: string}>();

function authRejection(): Error {
  return Object.assign(new Error('denied'), {code: 'CEREMONY_AUTH_REQUIRED'});
}

function gate(token: unknown, op: string, callSession?: unknown): void {
  if (typeof token !== 'string' || token === '') {
    throw authRejection();
  }
  const entry = mintRegistry.get(token);
  if (!entry || entry.op !== op) {
    throw authRejection();
  }
  if (callSession !== undefined && entry.session !== callSession) {
    throw authRejection();
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mintRegistry.clear();
  (getKeyshareMetadata as jest.Mock).mockResolvedValue({...LEGACY_GG18_META});
  native.requestSignCeremonyToken.mockImplementation(
    async (session: string) => {
      const token = `tok-sign-${session}`;
      mintRegistry.set(token, {op: 'sign', session});
      return token;
    },
  );
  native.completeCeremonyToken.mockResolvedValue(true);
  native.releaseCeremonyToken.mockResolvedValue(true);
  native.mpcSignPSBT.mockImplementation(async (...a: unknown[]) => {
    gate(a[a.length - 1], 'sign', a[3]);
    return 'signed-psbt-gg18-legacy';
  });
  native.nostrMpcSignPSBT.mockImplementation(async (...a: unknown[]) => {
    gate(a[a.length - 1], 'sign');
    return 'signed-nostr-psbt-gg18-legacy';
  });
  // DKLs natives must never fire for a legacy user — fail loudly.
  native.dklsMpcSignPSBT.mockRejectedValue(new Error('DKLS_UNREACHABLE'));
  native.dklsNostrMpcSignPSBT.mockRejectedValue(
    new Error('DKLS_UNREACHABLE'),
  );
});

describe('3b-6 GG18 legacy end-to-end (F10-GG18 / F19)', () => {
  test('legacy keyshare without tss_backend detects as gg18', () => {
    expect('tss_backend' in LEGACY_GG18_KEYSHARE).toBe(false);
    expect(detectKeyshareTssBackend(LEGACY_GG18_KEYSHARE)).toBe('gg18');
  });

  test('legacy metadata without tss_backend resolves spend backend to gg18', async () => {
    await expect(resolveTssBackend()).resolves.toBe('gg18');
  });

  test('legacy GG18 server sign completes a tokenized ceremony', async () => {
    const out = await TssProvider.mpcSignPSBT(
      'srv',
      'p1',
      'p1,p2',
      'sess-legacy-1',
      'sk',
      'ek',
      'dk',
      'cHNidA==',
    );
    expect(out).toBe('signed-psbt-gg18-legacy');
    // GG18 branch taken, token minted for this session and passed last.
    expect(native.dklsMpcSignPSBT).not.toHaveBeenCalled();
    expect(native.requestSignCeremonyToken).toHaveBeenCalledWith(
      'sess-legacy-1',
    );
    expect(native.mpcSignPSBT).toHaveBeenCalledWith(
      'srv',
      'p1',
      'p1,p2',
      'sess-legacy-1',
      'sk',
      'ek',
      'dk',
      'cHNidA==',
      'tok-sign-sess-legacy-1',
    );
    // Lifecycle completes; the minted token is consumed, not leaked.
    expect(native.completeCeremonyToken).toHaveBeenCalledWith(
      'tok-sign-sess-legacy-1',
    );
    expect(native.releaseCeremonyToken).not.toHaveBeenCalled();
  });

  test('legacy GG18 nostr sign completes a single-call ceremony', async () => {
    const out = await TssProvider.nostrMpcSignPSBT(
      'wss://r',
      'npub1,npub2',
      'npub1,npub2',
      'cHNidA==',
    );
    expect(out).toBe('signed-nostr-psbt-gg18-legacy');
    expect(native.dklsNostrMpcSignPSBT).not.toHaveBeenCalled();
    expect(native.requestSignCeremonyToken).toHaveBeenCalledTimes(1);
    const mintedSession = native.requestSignCeremonyToken.mock.calls[0][0];
    const call = native.nostrMpcSignPSBT.mock.calls[0];
    expect(call[call.length - 1]).toBe(`tok-sign-${mintedSession}`);
    expect(native.completeCeremonyToken).toHaveBeenCalledTimes(1);
  });

  test('same GG18 call without a token fails closed (control)', async () => {
    await expect(
      native.mpcSignPSBT(
        's',
        'p',
        'pp',
        'sess-legacy-1',
        'sk',
        'ek',
        'dk',
        'psbt',
      ),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
  });
});

// NOTE on "signature verified against the expected pubkey": signature
// validity is a property of the untouched Go GG18 crypto path — the
// token gate runs strictly before crypto (verify-then-work on both
// platforms) and cannot alter the bytes being signed. No tss-lib code
// changed in 3b-6, so there is no new crypto behavior to verify. What
// this suite proves is the actual 3b-6 regression risk: that a legacy
// GG18 user still reaches the signing ceremony through the token
// core (detection → routing → mint → gate-acceptable call →
// lifecycle completion) instead of being locked out by it.
