/**
 * Wave 3a L1 primary evidence (§8 wave3-design): per-flow bridge-spy.
 * The mocked native module + EncryptedStorage record EVERY arg and
 * resolution; each test drives a closed 3a flow with a known share
 * fixture and asserts no recorded string carries share bytes.
 *
 * Assertion tiers (see header rationale in each flow):
 *  - T1: base64(known share bytes) absent from ALL traffic, both
 *        directions, every flow. Strongest, direction-agnostic.
 *  - T2: `share_b64` / `ecdsa_local_data` markers absent everywhere.
 *  - T3: `nsec1` absent from native→JS resolutions. Allowed in
 *        JS→native ARGS only for persist-finalize (nsec originates
 *        in the JS pairing flow; native must embed it) — asserted
 *        as a documented exception, never in resolutions.
 * Chaincode in secure-metadata resolutions is BY DESIGN (§3
 * superset) and is not asserted absent.
 */
import {Buffer} from 'buffer';

jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    dklsMpcTssSetup: jest.fn(),
    mpcTssSetup: jest.fn(),
    dklsNostrMpcTssSetup: jest.fn(),
    nostrMpcTssSetup: jest.fn(),
    importBackupToStagedHandle: jest.fn(),
    persistStoredKeyshare: jest.fn(),
    hasKeyshareInSecureStorage: jest.fn(async () => true),
    getKeyshareMetadataJSON: jest.fn(),
    getKeyshareStructureRedacted: jest.fn(),
    destroyKeyshareHandles: jest.fn(async () => true),
    ensureKeyshareEnveloped: jest.fn(),
    sha256: jest.fn(),
    // 3b-2b: setup is keygen-token-gated; the spy records the
    // token arg (share-free) like any other bridge traffic.
    requestKeygenCeremonyToken: jest.fn(),
    // 3b-2e: stage/persist are import-token-gated (same).
    requestImportCeremonyToken: jest.fn(),
    completeCeremonyToken: jest.fn(),
    releaseCeremonyToken: jest.fn(),
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

jest.mock('../services/WalletService', () => ({
  waitMS: jest.fn(() => Promise.resolve()),
}));
jest.mock('../services/lanMpcSetup', () => ({}));
jest.mock('../services/lanMpcTransport', () => ({}));
jest.mock('../services/trioLanKeygenPreflight', () => ({}));
jest.mock('../services/tssKeygenPrepare', () => ({
  prepareDeviceForKeygen: jest.fn(async () => 'dkls23'),
}));
jest.mock('../services/walletGuard', () => ({
  assertNoExistingWallet: jest.fn(() => Promise.resolve()),
  WalletAlreadyLoadedError: class WalletAlreadyLoadedError extends Error {},
}));

jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../utils', () => ({
  KEYSHARE_STORAGE_KEY: 'keyshare',
  dbg: jest.fn(),
  detectKeyshareTssBackend: jest.fn(() => 'dkls23'),
  resolveUseLegacyDerivationPaths: jest.fn(() => false),
  saveKeyshareMetadata: jest.fn(() => Promise.resolve()),
  getKeyshareMetadata: jest.fn(async () => ({
    pub_key: '03aa',
    chain_code_hex: '',
  })),
  // Secure reader delegates to the SPIED native getter (records traffic).
  getKeyshareSecureMetadata: jest.fn(async () => {
    const {BBMTLibNativeModule} = require('../native_modules');
    return JSON.parse(await BBMTLibNativeModule.getKeyshareMetadataJSON());
  }),
}));

jest.mock('@react-navigation/native', () => ({
  CommonActions: {reset: jest.fn((p: unknown) => p)},
}));
jest.mock('react-native-haptic-feedback', () => ({trigger: jest.fn()}));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  copyFile: jest.fn(),
  readFile: jest.fn(),
}));
jest.mock('../services/rnfsSafe', () => ({safeUnlink: jest.fn()}));
jest.mock('../services/LocalCache', () => ({
  __esModule: true,
  default: {clear: jest.fn()},
}));
jest.mock('../App', () => ({isDebugLoggingEnabled: () => false}));
jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {get: jest.fn(), set: jest.fn(), remove: jest.fn(), getBool: jest.fn(() => false)},
  CONFIG_KEYS: {
    ENVELOPE_MIGRATION_BACKUP_PROMPTED: 'envelope_migration_backup_prompted',
  },
}));

import * as fs from 'fs';
import * as path from 'path';
import EncryptedStorage from 'react-native-encrypted-storage';
import {BBMTLibNativeModule} from '../native_modules';
import {resolveChaincodeHex} from '../services/chaincodeReader';
import {discardPendingKeyshares} from '../services/keyshareHandles';
import {decryptAndValidateKeyshare} from '../services/keyshareImport';
import {runEnvelopeMigrationIfNeeded} from '../services/keyshareEnvelopeMigration';
import {resolveTssBackendForKeygen} from '../services/tssBackend';
import {TssProvider} from '../services/TssProvider';
import {
  invokeLanWalletKeygen,
  invokeNostrWalletKeygen,
  persistStagedKeyshare,
} from '../services/walletSetupOrchestrator';
import {parseKeyshareJsonForDevView} from '../utils/keyshareDevView';

const native = BBMTLibNativeModule as any;
const storage = EncryptedStorage as any;
const resolveBackend = resolveTssBackendForKeygen as jest.Mock;

// Known-share fixture: if ANY of these bytes cross, the spy catches it.
const SHARE_BYTES = 'F15B-L1-KNOWN-SHARE-BYTES-0123456789';
const SHARE_B64 = Buffer.from(SHARE_BYTES, 'utf8').toString('base64');
const NSEC_FIXTURE = 'nsec1f15bl1knowntestvector00000000000000000000000';

type Record = {dir: 'arg' | 'res'; method: string; text: string};
let traffic: Record[] = [];

function resetTraffic() {
  traffic = [];
  jest.clearAllMocks();
  resolveBackend.mockResolvedValue('dkls23');
  // Wrap every native fn + storage fn to record args and resolutions.
  for (const name of Object.keys(native)) {
    const fn = native[name] as jest.Mock;
    fn.mockImplementation(async (...args: unknown[]) => {
      for (const a of args) {
        traffic.push({dir: 'arg', method: name, text: stringify(a)});
      }
      const out = stubResolve(name, args);
      traffic.push({dir: 'res', method: name, text: stringify(out)});
      return out;
    });
  }
  for (const name of ['getItem', 'setItem', 'removeItem']) {
    const fn = storage[name] as jest.Mock;
    fn.mockImplementation(async (...args: unknown[]) => {
      for (const a of args) {
        traffic.push({dir: 'arg', method: `RNES.${name}`, text: stringify(a)});
      }
      return null;
    });
  }
}

function stringify(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const STAGED_META = {
  pub_key: '03aa',
  chain_code_hex: 'bb'.repeat(32),
  keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
  local_party_key: 'KeyShare1',
  nostr_npub: 'npub1x',
  created_at: 1720000000000,
  tss_backend: 'dkls23',
  suite: 1,
};

// Default native resolutions: staged/metadata shapes, zero secrets.
function stubResolve(name: string, _args: unknown[]): unknown {
  switch (name) {
    case 'dklsMpcTssSetup':
    case 'dklsNostrMpcTssSetup':
    case 'importBackupToStagedHandle':
      return JSON.stringify({
        handle: 'ab'.repeat(16),
        metadata: STAGED_META,
        legacy: false,
      });
    case 'persistStoredKeyshare':
      return JSON.stringify(STAGED_META);
    case 'getKeyshareMetadataJSON':
      return JSON.stringify(STAGED_META);
    case 'getKeyshareStructureRedacted':
      return JSON.stringify({
        pub_key: '03aa',
        share_b64: '<redacted len=44>',
        nsec: '<redacted len=8>',
        ecdsa_local_data: '<redacted object>',
      });
    case 'ensureKeyshareEnveloped':
      return {migrated: true};
    case 'hasKeyshareInSecureStorage':
    case 'destroyKeyshareHandles':
      return true;
    case 'requestKeygenCeremonyToken':
      return 'tok-spy-keygen-1';
    case 'requestImportCeremonyToken':
      return 'tok-spy-import-1';
    case 'sha256':
      return 'spy-sha256-stub';
    case 'completeCeremonyToken':
    case 'releaseCeremonyToken':
      return true;
    default:
      return null;
  }
}

function texts(dir?: 'arg' | 'res'): string[] {
  return traffic.filter(r => !dir || r.dir === dir).map(r => r.text);
}

// T1+T2: share bytes and share markers nowhere, either direction.
function expectNoShareTraffic() {
  for (const t of texts()) {
    expect(t).not.toContain(SHARE_B64);
    expect(t).not.toContain(SHARE_BYTES);
    expect(t).not.toContain('share_b64');
    expect(t).not.toContain('ecdsa_local_data');
  }
}

// T3: nsec1 never flows native→JS.
function expectNoNsecInResolutions() {
  for (const t of texts('res')) {
    expect(t).not.toContain('nsec1');
  }
}

beforeEach(() => {
  resetTraffic();
});

describe('Wave 3a L1 bridge-spy (F15b-1 + F10-clip)', () => {
  test('setup-output LAN: staged handle+metadata only', async () => {
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
    expect(res.kind).toBe('staged');
    expect(native.dklsMpcTssSetup).toHaveBeenCalledTimes(1);
    expectNoShareTraffic();
    expectNoNsecInResolutions();
  });

  test('setup-output Nostr: staged handle+metadata only', async () => {
    const res = await TssProvider.nostrMpcTssSetup(
      'relays',
      'party-nsec-input',
      'npubs',
      'sid',
      'sk',
      'cc',
      'ppm',
    );
    expect(res.kind).toBe('staged');
    expect(native.dklsNostrMpcTssSetup).toHaveBeenCalledTimes(1);
    expectNoShareTraffic();
    expectNoNsecInResolutions();
  });

  test('F19: GG18 legacy branch skipped by the spy with explicit kind', async () => {
    // Per §8 GG18 note (F19): the legacy branch keeps the current
    // plaintext flow and is NOT spy-asserted — but it must be
    // explicitly kind-tagged so no caller mistakes it for staged.
    resolveBackend.mockResolvedValue('gg18');
    native.mpcTssSetup.mockImplementation(async (...args: unknown[]) => {
      for (const a of args) {
        traffic.push({dir: 'arg', method: 'mpcTssSetup', text: stringify(a)});
      }
      const out = JSON.stringify({pub_key: 'bb', tss_backend: 'gg18'});
      traffic.push({dir: 'res', method: 'mpcTssSetup', text: out});
      return out;
    });
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
    expect(res).toEqual(
      expect.objectContaining({kind: 'legacy-gg18'}),
    );
  });

  test('orchestrator invoke passes staged results through untouched', async () => {
    const orch = {
      server: 'srv',
      partyID: 'p1',
      partiesCSV: 'p1,p2',
      sessionID: 'sid',
      transport: {sessionKey: 'sk', encKey: 'ek', decKey: 'dk'},
      chaincode: 'cc',
      backend: 'dkls23',
    } as any;
    const lan = await invokeLanWalletKeygen(orch, 'ppm', 'duo');
    expect(lan.kind).toBe('staged');
    const nostr = await invokeNostrWalletKeygen({
      relaysCSV: 'r',
      partyNsec: 'party-nsec-input',
      partiesNpubsCSV: 'npub1,npub2',
      sessionID: 'sid',
      sessionKey: 'sk',
      chaincode: 'cc',
      ppmPath: 'ppm',
      setupMode: 'duo',
      backend: 'dkls23',
    } as any);
    expect(nostr.kind).toBe('staged');
    expectNoShareTraffic();
    expectNoNsecInResolutions();
  });

  test('import: password in, staged handle+metadata out', async () => {
    const out = await decryptAndValidateKeyshare('Y2lwaGVyLWJsb2I=', 'pw');
    expect(out.handle).toBe('ab'.repeat(16));
    expect(out.legacy).toBe(false);
    expect(native.importBackupToStagedHandle).toHaveBeenCalledTimes(1);
    // F1 intent preserved (3b-2e): sha256 may mint ceremony
    // session IDs only — never a password-derived key. Every
    // input must be a `ceremony/<purpose>/…` nonce string.
    for (const call of native.sha256.mock.calls as unknown[][]) {
      expect(String(call[0]).startsWith('ceremony/')).toBe(true);
      expect(String(call[0])).not.toContain('pw');
    }
    expectNoShareTraffic();
    expectNoNsecInResolutions();
  });

  test('persist: handle in, metadata out (nsec arg exception documented)', async () => {
    const meta = await persistStagedKeyshare('ab'.repeat(16), {
      partyNsec: NSEC_FIXTURE,
      nostrNpub: 'npub1x',
    });
    expect(meta.pub_key).toBe('03aa');
    const [h, nsecArg] = native.persistStoredKeyshare.mock.calls[0];
    expect(h).toBe('ab'.repeat(16));
    // Documented T3 exception: finalize must embed the pairing nsec,
    // which originates in JS — it crosses JS→native as an arg…
    expect(String(nsecArg)).toContain('nsec1');
    // …but share bytes/markers cross nowhere, and nsec1 never
    // comes back in a resolution.
    expectNoShareTraffic();
    expectNoNsecInResolutions();
  });

  test('read/metadata: chaincode via secure getter, blob never read', async () => {
    const hex = await resolveChaincodeHex();
    expect(hex).toBe('bb'.repeat(32));
    expect(native.getKeyshareMetadataJSON).toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalledWith(
      'keyshare',
      expect.anything(),
    );
    expect(storage.getItem).not.toHaveBeenCalled();
    expectNoShareTraffic();
    expectNoNsecInResolutions();
  });

  test('dev-view: redacted structure parses, secrets absent', async () => {
    const raw = await native.getKeyshareStructureRedacted();
    const parsed = parseKeyshareJsonForDevView(raw);
    expect('data' in parsed).toBe(true);
    if ('data' in parsed) {
      expect(parsed.data.share_b64).toBe('<redacted len=44>');
      expect(parsed.data.ecdsa_local_data).toBe('<redacted object>');
    }
    // A9 refinement of T2: the redacted shape keeps secret KEYS
    // with placeholder VALUES by design — assert placeholders,
    // not key absence. T1 (no share bytes) still holds fully.
    for (const t of texts()) {
      expect(t).not.toContain(SHARE_B64);
      expect(t).not.toContain(SHARE_BYTES);
    }
    expect(raw).toContain('<redacted len=44>');
    expect(raw).toContain('<redacted object>');
    expectNoNsecInResolutions();
  });

  test('dev-view source guardrail: component uses redacted getter', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'KeyshareInfoContent.tsx'),
      'utf8',
    );
    expect(src).toContain('getKeyshareStructureRedacted');
    expect(src).not.toMatch(
      /EncryptedStorage\.getItem\(\s*['"]keyshare['"]\s*\)/,
    );
  });

  test('delete: destroy takes no secret args, reads nothing', async () => {
    await discardPendingKeyshares();
    expect(native.destroyKeyshareHandles).toHaveBeenCalledTimes(1);
    expect(
      native.destroyKeyshareHandles.mock.calls[0].length,
    ).toBe(0);
    expect(storage.getItem).not.toHaveBeenCalled();
    expectNoShareTraffic();
    expectNoNsecInResolutions();
  });

  test('migration: resolve is {migrated} only', async () => {
    const out = await runEnvelopeMigrationIfNeeded();
    expect(out).toEqual({migrated: true});
    expect(native.ensureKeyshareEnveloped).toHaveBeenCalledTimes(1);
    expectNoShareTraffic();
    expectNoNsecInResolutions();
  });
});
