/**
 * Backend × transport matrix for keygen persist + keysign dispatch.
 *
 * Combinations under test:
 *   gg18  × lan|nostr × keygen|keysign(send|psbt)
 *   dkls23 × lan|nostr × keygen|keysign(send|psbt)
 *
 * GG18 keygen asserts Go-shaped `*big.Int` JSON survives JS persist
 * (the device failure: cannot unmarshal "1.43…e+308" into a *big.Int).
 * DKLs keygen asserts share bytes never transit JS (staged handle only).
 */

jest.mock('../services/walletOrigin', () => ({
  markWalletCreated: jest.fn(),
  markWalletImported: jest.fn(),
  isCreatedWallet: jest.fn(() => false),
  shouldSeedFreshHd: jest.fn(() => false),
  FRESH_DISCOVERY_STATUS: 'fresh',
}));

jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    hasKeyshareInSecureStorage: jest.fn(async () => true),
    destroyKeyshareHandles: jest.fn(async () => true),
    persistStoredKeyshare: jest.fn(),
    dklsMpcTssSetup: jest.fn(),
    mpcTssSetup: jest.fn(),
    dklsNostrMpcTssSetup: jest.fn(),
    nostrMpcTssSetup: jest.fn(),
    dklsMpcSignPSBT: jest.fn(),
    dklsMpcSendBTCWithUTXOs: jest.fn(),
    dklsNostrMpcSendBTC: jest.fn(),
    dklsNostrMpcSignPSBT: jest.fn(),
    mpcSignPSBT: jest.fn(),
    mpcSendBTCWithUTXOs: jest.fn(),
    nostrMpcSendBTC: jest.fn(),
    nostrMpcSignPSBT: jest.fn(),
    requestKeygenCeremonyToken: jest.fn(async () => 'tok-keygen'),
    requestImportCeremonyToken: jest.fn(async () => 'tok-import'),
    requestSignCeremonyToken: jest.fn(async () => 'tok-sign'),
    requestPsbtSignCeremonyToken: jest.fn(async () => 'tok-sign'),
    requestSendSignCeremonyToken: jest.fn(async () => 'tok-sign'),
    completeCeremonyToken: jest.fn(async () => true),
    releaseCeremonyToken: jest.fn(async () => true),
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

jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(() => Promise.resolve()),
    getItem: jest.fn(() => Promise.resolve(null)),
  },
}));

jest.mock('../utils', () => ({
  dbg: jest.fn(),
  KEYSHARE_STORAGE_KEY: 'keyshare',
  saveKeyshareMetadata: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/walletGuard', () => ({
  assertNoExistingWallet: jest.fn(() => Promise.resolve()),
  WalletAlreadyLoadedError: class WalletAlreadyLoadedError extends Error {},
}));

jest.mock('../services/secureStorageErrors', () => ({
  secureStorageMessageFor: jest.fn(() => null),
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

import EncryptedStorage from 'react-native-encrypted-storage';
import {BBMTLibNativeModule} from '../native_modules';
import {TssProvider} from '../services/TssProvider';
import {
  persistStagedKeyshare,
  persistWalletKeyshare,
} from '../services/walletSetupOrchestrator';
import {
  resolveTssBackend,
  resolveTssBackendForKeygen,
} from '../services/tssBackend';
import {saveKeyshareMetadata} from '../utils';
import {
  assertJsonSafeForGoBigIntUnmarshal,
  buildDklsStagedSetupRaw,
  buildGoShapedGg18KeyshareJson,
  DKLS_STAGED_HANDLE,
  DKLS_STAGED_METADATA,
  GG18_HUGE_PAILLIER_D,
  naiveJsRoundTripCorruptsGg18BigInts,
} from './fixtures/mpcKeyshareFixtures';

const native = BBMTLibNativeModule as any;
const resolveSpend = resolveTssBackend as jest.Mock;
const resolveKeygen = resolveTssBackendForKeygen as jest.Mock;

const PSBT = 'cHNidA==';
const LAN_SIGN_ARGS = [
  'srv',
  'p1',
  'p1,p2',
  'sess-matrix',
  'sk',
  'ek',
  'dk',
  PSBT,
] as const;

const LAN_SEND_ARGS = [
  'srv',
  'p1',
  'p1,p2',
  'sess-send',
  'sk',
  'ek',
  'dk',
  'btcpub',
  'tb1qto',
  '1000',
  '10',
  '[]',
  'tb1qchange',
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  resolveSpend.mockResolvedValue('dkls23');
  resolveKeygen.mockResolvedValue('dkls23');
  native.hasKeyshareInSecureStorage.mockResolvedValue(true);
  native.persistStoredKeyshare.mockResolvedValue(
    JSON.stringify(DKLS_STAGED_METADATA),
  );
  native.dklsMpcSignPSBT.mockResolvedValue('signed-dkls-lan-psbt');
  native.dklsMpcSendBTCWithUTXOs.mockResolvedValue('txid-dkls-lan');
  native.dklsNostrMpcSignPSBT.mockResolvedValue('signed-dkls-nostr-psbt');
  native.dklsNostrMpcSendBTC.mockResolvedValue('txid-dkls-nostr');
  native.mpcSignPSBT.mockResolvedValue('signed-gg18-lan-psbt');
  native.mpcSendBTCWithUTXOs.mockResolvedValue('txid-gg18-lan');
  native.nostrMpcSignPSBT.mockResolvedValue('signed-gg18-nostr-psbt');
  native.nostrMpcSendBTC.mockResolvedValue('txid-gg18-nostr');
});

describe('fixture: Go-shaped GG18 vs naïve JS', () => {
  it('naïve JSON.parse/stringify destroys Paillier-scale big.Int (bug mode)', () => {
    const raw = buildGoShapedGg18KeyshareJson();
    expect(naiveJsRoundTripCorruptsGg18BigInts(raw)).toBe(true);
    const destroyed = JSON.stringify(JSON.parse(raw));
    expect(destroyed).toMatch(/\d+\.\d+[eE][+-]?\d+/);
    expect(destroyed).not.toContain(GG18_HUGE_PAILLIER_D);
  });
});

describe('keygen → persist matrix', () => {
  it.each([
    ['lan', undefined],
    [
      'nostr',
      {
        partyNsec: 'nsec1matrixgg18testonly',
        nostrNpub:
          'npub1qcujl24je9hw0wqd6skelcv4z2ga6mk8hktdz9vrdrjns6yd6q8syxycaf',
      },
    ],
  ] as const)(
    'gg18 %s: persist keeps Go big.Int decimals (no e+ / Infinity)',
    async (transport, opts) => {
      const raw = buildGoShapedGg18KeyshareJson();
      // Simulate native keygen return (TssProvider legacy branch).
      if (transport === 'lan') {
        resolveKeygen.mockResolvedValue('gg18');
        native.mpcTssSetup.mockResolvedValue(raw);
        const setup = await TssProvider.mpcTssSetup(
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
        expect(setup).toEqual({kind: 'legacy-gg18', json: raw});
        expect(native.dklsMpcTssSetup).not.toHaveBeenCalled();
      } else {
        resolveKeygen.mockResolvedValue('gg18');
        native.nostrMpcTssSetup.mockResolvedValue(raw);
        const setup = await TssProvider.nostrMpcTssSetup(
          'relays',
          'nsec1x',
          'npub1,npub2',
          'sid',
          'sk',
          'cc',
          'ppm',
        );
        expect(setup).toEqual({kind: 'legacy-gg18', json: raw});
        expect(native.dklsNostrMpcTssSetup).not.toHaveBeenCalled();
      }

      const saved = await persistWalletKeyshare(raw, opts);
      assertJsonSafeForGoBigIntUnmarshal(saved);
      expect(EncryptedStorage.setItem).toHaveBeenCalledWith('keyshare', saved);
      expect(saveKeyshareMetadata).toHaveBeenCalled();
      if (opts) {
        expect(saved).toContain('"nostr_npub"');
        expect(saved).toContain('"nsec"');
      }
    },
  );

  it.each(['lan', 'nostr'] as const)(
    'dkls23 %s: staged persist — no share blob through EncryptedStorage.setItem',
    async transport => {
      resolveKeygen.mockResolvedValue('dkls23');
      const stagedRaw = buildDklsStagedSetupRaw();
      if (transport === 'lan') {
        native.dklsMpcTssSetup.mockResolvedValue(stagedRaw);
        const setup = await TssProvider.mpcTssSetup(
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
        expect(setup.kind).toBe('staged');
        if (setup.kind === 'staged') {
          expect(setup.handle).toBe(DKLS_STAGED_HANDLE);
          expect(JSON.stringify(setup)).not.toContain('share_b64');
          expect(JSON.stringify(setup)).not.toContain('ecdsa_local_data');
        }
        expect(native.mpcTssSetup).not.toHaveBeenCalled();
      } else {
        native.dklsNostrMpcTssSetup.mockResolvedValue(stagedRaw);
        const setup = await TssProvider.nostrMpcTssSetup(
          'relays',
          'nsec1x',
          'npub1,npub2',
          'sid',
          'sk',
          'cc',
          'ppm',
        );
        expect(setup.kind).toBe('staged');
        expect(native.nostrMpcTssSetup).not.toHaveBeenCalled();
      }

      const meta = await persistStagedKeyshare(
        DKLS_STAGED_HANDLE,
        transport === 'nostr'
          ? {
              partyNsec: 'nsec1matrixdklstest',
              nostrNpub:
                'npub1qcujl24je9hw0wqd6skelcv4z2ga6mk8hktdz9vrdrjns6yd6q8syxycaf',
            }
          : undefined,
      );
      expect(native.persistStoredKeyshare).toHaveBeenCalled();
      expect(EncryptedStorage.setItem).not.toHaveBeenCalled();
      expect(meta.pub_key).toBe(DKLS_STAGED_METADATA.pub_key);
      expect(JSON.stringify(meta)).not.toContain('share_b64');
      expect(JSON.stringify(meta)).not.toContain('ecdsa_local_data');
    },
  );
});

describe('keysign dispatch matrix (send + PSBT)', () => {
  it.each([
    {
      backend: 'gg18' as const,
      transport: 'lan' as const,
      op: 'psbt' as const,
      run: () => TssProvider.mpcSignPSBT(...LAN_SIGN_ARGS),
      expectNative: 'mpcSignPSBT',
      forbid: ['dklsMpcSignPSBT', 'nostrMpcSignPSBT', 'dklsNostrMpcSignPSBT'],
      result: 'signed-gg18-lan-psbt',
    },
    {
      backend: 'gg18' as const,
      transport: 'lan' as const,
      op: 'send' as const,
      run: () => TssProvider.mpcSendBTCWithUTXOs(...LAN_SEND_ARGS),
      expectNative: 'mpcSendBTCWithUTXOs',
      forbid: [
        'dklsMpcSendBTCWithUTXOs',
        'nostrMpcSendBTC',
        'dklsNostrMpcSendBTC',
      ],
      result: 'txid-gg18-lan',
    },
    {
      backend: 'gg18' as const,
      transport: 'nostr' as const,
      op: 'psbt' as const,
      run: () =>
        TssProvider.nostrMpcSignPSBT(
          'wss://r',
          'npub1,npub2',
          'npub1,npub2',
          PSBT,
        ),
      expectNative: 'nostrMpcSignPSBT',
      forbid: ['dklsNostrMpcSignPSBT', 'mpcSignPSBT', 'dklsMpcSignPSBT'],
      result: 'signed-gg18-nostr-psbt',
    },
    {
      backend: 'gg18' as const,
      transport: 'nostr' as const,
      op: 'send' as const,
      run: () =>
        TssProvider.nostrMpcSendBTC(
          'wss://r',
          'npub1,npub2',
          'npub1,npub2',
          '5000',
          'tb1qto',
          '1000',
          '10',
          '[]',
          'tb1qchange',
        ),
      expectNative: 'nostrMpcSendBTC',
      forbid: [
        'dklsNostrMpcSendBTC',
        'mpcSendBTCWithUTXOs',
        'dklsMpcSendBTCWithUTXOs',
      ],
      result: 'txid-gg18-nostr',
    },
    {
      backend: 'dkls23' as const,
      transport: 'lan' as const,
      op: 'psbt' as const,
      run: () => TssProvider.mpcSignPSBT(...LAN_SIGN_ARGS),
      expectNative: 'dklsMpcSignPSBT',
      forbid: ['mpcSignPSBT', 'nostrMpcSignPSBT', 'dklsNostrMpcSignPSBT'],
      result: 'signed-dkls-lan-psbt',
    },
    {
      backend: 'dkls23' as const,
      transport: 'lan' as const,
      op: 'send' as const,
      run: () => TssProvider.mpcSendBTCWithUTXOs(...LAN_SEND_ARGS),
      expectNative: 'dklsMpcSendBTCWithUTXOs',
      forbid: [
        'mpcSendBTCWithUTXOs',
        'nostrMpcSendBTC',
        'dklsNostrMpcSendBTC',
      ],
      result: 'txid-dkls-lan',
    },
    {
      backend: 'dkls23' as const,
      transport: 'nostr' as const,
      op: 'psbt' as const,
      run: () =>
        TssProvider.nostrMpcSignPSBT(
          'wss://r',
          'npub1,npub2',
          'npub1,npub2',
          PSBT,
        ),
      expectNative: 'dklsNostrMpcSignPSBT',
      forbid: ['nostrMpcSignPSBT', 'mpcSignPSBT', 'dklsMpcSignPSBT'],
      result: 'signed-dkls-nostr-psbt',
    },
    {
      backend: 'dkls23' as const,
      transport: 'nostr' as const,
      op: 'send' as const,
      run: () =>
        TssProvider.nostrMpcSendBTC(
          'wss://r',
          'npub1,npub2',
          'npub1,npub2',
          '5000',
          'tb1qto',
          '1000',
          '10',
          '[]',
          'tb1qchange',
        ),
      expectNative: 'dklsNostrMpcSendBTC',
      forbid: [
        'nostrMpcSendBTC',
        'mpcSendBTCWithUTXOs',
        'dklsMpcSendBTCWithUTXOs',
      ],
      result: 'txid-dkls-nostr',
    },
  ])(
    '$backend × $transport × $op routes to $expectNative',
    async ({backend, run, expectNative, forbid, result}) => {
      resolveSpend.mockResolvedValue(backend);
      await expect(run()).resolves.toBe(result);
      expect(native[expectNative]).toHaveBeenCalledTimes(1);
      const call = native[expectNative].mock.calls[0];
      expect(call[call.length - 1]).toBe('tok-sign');
      for (const name of forbid) {
        expect(native[name]).not.toHaveBeenCalled();
      }
    },
  );
});

describe('gg18 keygen→persist→simulated keysign load', () => {
  it.each(['lan', 'nostr'] as const)(
    '%s: after persist, simulated Go load accepts; naïve blob would fail keysign',
    async transport => {
      const raw = buildGoShapedGg18KeyshareJson();
      expect(naiveJsRoundTripCorruptsGg18BigInts(raw)).toBe(true);

      const opts =
        transport === 'nostr'
          ? {
              partyNsec: 'nsec1simkeysign',
              nostrNpub: 'npub1sim',
            }
          : undefined;
      const saved = await persistWalletKeyshare(raw, opts);

      // Simulate native KeysignECDSA local-state load (Go unmarshal rules).
      const simulateGoUnmarshalLocalState = (blob: string) => {
        if (/\d+\.\d+[eE][+-]?\d+/.test(blob) || blob.includes('Infinity')) {
          throw new Error(
            'failed to unmarshal local state, error: math/big: cannot unmarshal scientific float into a *big.Int',
          );
        }
        if (!blob.includes(GG18_HUGE_PAILLIER_D)) {
          throw new Error('failed to unmarshal local state: lost Paillier D');
        }
        return true;
      };

      expect(() => simulateGoUnmarshalLocalState(saved)).not.toThrow();
      expect(() =>
        simulateGoUnmarshalLocalState(JSON.stringify(JSON.parse(raw))),
      ).toThrow(/cannot unmarshal/);

      // Keysign dispatch still hits GG18 native for this transport.
      resolveSpend.mockResolvedValue('gg18');
      if (transport === 'lan') {
        await expect(
          TssProvider.mpcSendBTCWithUTXOs(...LAN_SEND_ARGS),
        ).resolves.toBe('txid-gg18-lan');
        expect(native.mpcSendBTCWithUTXOs).toHaveBeenCalled();
        expect(native.dklsMpcSendBTCWithUTXOs).not.toHaveBeenCalled();
      } else {
        await expect(
          TssProvider.nostrMpcSendBTC(
            'wss://r',
            'npub1,npub2',
            'npub1,npub2',
            '5000',
            'tb1qto',
            '1000',
            '10',
            '[]',
            'tb1qchange',
          ),
        ).resolves.toBe('txid-gg18-nostr');
        expect(native.nostrMpcSendBTC).toHaveBeenCalled();
        expect(native.dklsNostrMpcSendBTC).not.toHaveBeenCalled();
      }
    },
  );
});
