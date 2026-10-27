/* eslint-disable no-bitwise */
jest.mock('../services/WalletService', () => ({
  waitMS: jest.fn(() => Promise.resolve()),
}));

jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    hasKeyshareInSecureStorage: jest.fn(async () => true),
    destroyKeyshareHandles: jest.fn(async () => true),
  },
}));

jest.mock('../services/lanMpcSetup', () => ({}));
jest.mock('../services/lanMpcTransport', () => ({}));
jest.mock('../services/trioLanKeygenPreflight', () => ({}));
jest.mock('../services/TssProvider', () => ({
  // 3b-2e: persist routes via TssProvider (token plumbing pinned in
  // tssImportTokenGating; this suite pins orchestration).
  TssProvider: {
    mpcTssSetup: jest.fn(),
    nostrMpcTssSetup: jest.fn(),
    persistStoredKeyshare: jest.fn(async () =>
      JSON.stringify({pub_key: 'aa', tss_backend: 'dkls23'}),
    ),
  },
}));

jest.mock('../services/tssKeygenPrepare', () => ({
  prepareDeviceForKeygen: jest.fn(async () => 'dkls23'),
}));

jest.mock('../services/tssBackend', () => ({
  resolveTssBackendForKeygen: jest.fn(async () => 'dkls23'),
}));

jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(() => Promise.resolve()),
    getItem: jest.fn(() => Promise.resolve(null)),
  },
}));

jest.mock('../utils', () => ({
  KEYSHARE_STORAGE_KEY: 'keyshare',
  saveKeyshareMetadata: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/walletOrigin', () => ({
  markWalletCreated: jest.fn(),
  markWalletImported: jest.fn(),
  isCreatedWallet: jest.fn(() => false),
  shouldSeedFreshHd: jest.fn(() => false),
  FRESH_DISCOVERY_STATUS: 'fresh',
}));

jest.mock('../services/walletGuard', () => ({
  assertNoExistingWallet: jest.fn(() => Promise.resolve()),
  WalletAlreadyLoadedError: class WalletAlreadyLoadedError extends Error {},
}));

jest.mock('../services/secureStorageErrors', () => ({
  secureStorageMessageFor: jest.fn(() => null),
}));

import EncryptedStorage from 'react-native-encrypted-storage';
import {BBMTLibNativeModule} from '../native_modules';
import {TssProvider} from '../services/TssProvider';
import {assertNoExistingWallet} from '../services/walletGuard';
import {saveKeyshareMetadata} from '../utils';
import {
  discardPendingKeyshares,
  finalizeKeyshareForStorage,
  invokeLanWalletKeygen,
  invokeNostrWalletKeygen,
  mixNostrChaincodeWithDice,
  nsecFieldForKeyshareJson,
  persistStagedKeyshare,
  persistWalletKeyshare,
  resolveWalletSetupBackend,
  verifyWalletKeysharePersisted,
  WALLET_SETUP_PREPARE_TIMEOUT_MIN,
} from '../services/walletSetupOrchestrator';
import {resolveTssBackendForKeygen} from '../services/tssBackend';
import {quoteOversizedJsonIntegers} from '../utils/keyshareDevView';

describe('walletSetupOrchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses explicit backend over preference', async () => {
    expect(await resolveWalletSetupBackend('gg18')).toBe('gg18');
    expect(await resolveWalletSetupBackend('dkls23')).toBe('dkls23');
  });

  it('falls back to resolveTssBackendForKeygen', async () => {
    (resolveTssBackendForKeygen as jest.Mock).mockClear();
    expect(await resolveWalletSetupBackend(null, 'trio')).toBe('dkls23');
    expect(resolveTssBackendForKeygen).toHaveBeenCalledWith('trio');
  });

  it('defines LAN vs Nostr prepare timeouts like main', () => {
    expect(WALLET_SETUP_PREPARE_TIMEOUT_MIN.lan).toBe(2);
    expect(WALLET_SETUP_PREPARE_TIMEOUT_MIN.nostr).toBe(20);
  });

  it('finalizeKeyshareForStorage adds nsec without altering MPC fields', () => {
    const input = JSON.stringify({
      tss_backend: 'dkls23',
      share_b64: 'abc',
      pub_key: 'deadbeef',
      keygen_committee_keys: ['npub1a', 'npub1b'],
      local_party_key: 'npub1a',
    });
    const nsec = 'nsec1testkeyforwalletsetuponly';
    const out = finalizeKeyshareForStorage(input, {
      partyNsec: nsec,
      nostrNpub: 'npub1test',
    });
    const parsed = JSON.parse(out);
    expect(parsed.share_b64).toBe('abc');
    expect(parsed.pub_key).toBe('deadbeef');
    expect(parsed.nostr_npub).toBe('npub1test');
    expect(parsed.nsec).toBe(nsecFieldForKeyshareJson(nsec));
  });

  it('finalizeKeyshareForStorage does not overwrite existing nsec', () => {
    const existing = 'abcdef';
    const input = JSON.stringify({nsec: existing, nostr_npub: 'npub1x'});
    const out = finalizeKeyshareForStorage(input, {
      partyNsec: 'nsec1other',
      nostrNpub: 'npub1y',
    });
    expect(JSON.parse(out).nsec).toBe(existing);
    expect(JSON.parse(out).nostr_npub).toBe('npub1x');
  });

  it('finalizeKeyshareForStorage preserves GG18 big.Int as bare numbers for Go', () => {
    const {
      assertJsonSafeForGoBigIntUnmarshal,
      buildGoShapedGg18KeyshareJson,
      GG18_HUGE_ALPHA,
      naiveJsRoundTripCorruptsGg18BigInts,
    } = require('./fixtures/mpcKeyshareFixtures');
    const input = buildGoShapedGg18KeyshareJson();
    expect(naiveJsRoundTripCorruptsGg18BigInts(input)).toBe(true);
    const out = finalizeKeyshareForStorage(input, {
      partyNsec: 'nsec1gg18test',
      nostrNpub: 'npub1gg18',
    });
    assertJsonSafeForGoBigIntUnmarshal(out);
    expect(out).toContain(`"Alpha":${GG18_HUGE_ALPHA}`);
    expect(out).not.toContain(`"Alpha":"${GG18_HUGE_ALPHA}"`);
    expect(JSON.parse(quoteOversizedJsonIntegers(out)).nostr_npub).toBe(
      'npub1gg18',
    );
  });

  it('finalizeKeyshareForStorage without Nostr opts leaves Go JSON untouched', () => {
    const {buildGoShapedGg18KeyshareJson} = require('./fixtures/mpcKeyshareFixtures');
    const input = buildGoShapedGg18KeyshareJson();
    expect(finalizeKeyshareForStorage(input)).toBe(input);
  });

  it('F15b-1: persistStagedKeyshare persists via native, mirrors metadata', async () => {
    const meta = await persistStagedKeyshare('handle-abc123', {
      partyNsec: 'nsec1persisttest',
      nostrNpub: 'npub1persist',
    });
    expect(assertNoExistingWallet).toHaveBeenCalled();
    expect(TssProvider.persistStoredKeyshare).toHaveBeenCalledWith(
      'handle-abc123',
      'nsec1persisttest',
      'npub1persist',
      undefined,
      undefined,
    );
    // No share bytes cross JS: RNES is never touched from here.
    expect(EncryptedStorage.setItem).not.toHaveBeenCalled();
    expect(EncryptedStorage.getItem).not.toHaveBeenCalled();
    expect(saveKeyshareMetadata).toHaveBeenCalledWith(
      {pub_key: 'aa', tss_backend: 'dkls23'},
      {throwOnError: true},
    );
    expect(meta.pub_key).toBe('aa');
  });

  it('F15b-1: persistStagedKeyshare rejects empty handles', async () => {
    await expect(persistStagedKeyshare('  ')).rejects.toThrow(
      /invalid keyshare handle/i,
    );
  });

  it('F15b-1: persistStagedKeyshare fails when verification fails', async () => {
    (BBMTLibNativeModule.hasKeyshareInSecureStorage as jest.Mock)
      .mockResolvedValueOnce(false);
    await expect(persistStagedKeyshare('handle-abc123')).rejects.toThrow(
      /key share was lost during setup/i,
    );
  });

  it('F3: persistStagedKeyshare rewrites storage failures with clear copy', async () => {
    (TssProvider.persistStoredKeyshare as jest.Mock).mockRejectedValueOnce(
      new Error('[SECURE_STORAGE_LOCKED] Device must be unlocked.'),
    );
    await expect(persistStagedKeyshare('handle-abc123')).rejects.toThrow(
      /device must be unlocked/i,
    );
  });

  it('F3: persistStagedKeyshare propagates non-storage errors unchanged', async () => {
    (TssProvider.persistStoredKeyshare as jest.Mock).mockRejectedValueOnce(
      new Error('quota exceeded'),
    );
    await expect(persistStagedKeyshare('handle-abc123')).rejects.toThrow(
      'quota exceeded',
    );
  });

  it('F19: persistWalletKeyshare legacy path still writes + mirrors (GG18)', async () => {
    const {
      assertJsonSafeForGoBigIntUnmarshal,
      buildGoShapedGg18KeyshareJson,
    } = require('./fixtures/mpcKeyshareFixtures');
    const json = buildGoShapedGg18KeyshareJson();
    (EncryptedStorage.getItem as jest.Mock).mockResolvedValue(json);
    (BBMTLibNativeModule.hasKeyshareInSecureStorage as jest.Mock)
      .mockResolvedValue(true);
    const saved = await persistWalletKeyshare(json, {
      partyNsec: 'nsec1legacytest',
      nostrNpub: 'npub1legacy',
    });
    expect(saved).toContain('"nsec"');
    assertJsonSafeForGoBigIntUnmarshal(saved);
    expect(EncryptedStorage.setItem).toHaveBeenCalledWith('keyshare', saved);
    expect(saveKeyshareMetadata).toHaveBeenCalled();
  });

  it('verifyWalletKeysharePersisted uses the native presence check', async () => {
    (BBMTLibNativeModule.hasKeyshareInSecureStorage as jest.Mock)
      .mockResolvedValueOnce(false);
    await expect(verifyWalletKeysharePersisted()).resolves.toBe(false);
    expect(EncryptedStorage.getItem).not.toHaveBeenCalled();
  });

  it('skip keeps the base chaincode and dice replaces it locally', async () => {
    const base = 'ab'.repeat(32);
    const skip = await mixNostrChaincodeWithDice(base, []);
    expect(skip.diceUsed).toBe(false);
    expect(skip.finalChaincodeHex).toBe(base);
    // Deterministic non-sequential D6×100 (meets 256-bit floor).
    let a = 42 >>> 0;
    const rnd = () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rolls = Array.from({length: 100}, () => 1 + Math.floor(rnd() * 6));
    const dice = await mixNostrChaincodeWithDice(base, [
      {kind: 'd6', sides: 6, rolls},
    ]);
    expect(dice.diceUsed).toBe(true);
    expect(dice.finalChaincodeHex).not.toBe(base);
    expect(dice.finalChaincodeHex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('F15b-1 setup invoke/discard', () => {
  const provider = TssProvider as any;
  const native = BBMTLibNativeModule as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('invokeLanWalletKeygen passes the staged SetupResult through', async () => {
    const staged = {
      kind: 'staged',
      handle: 'h1',
      metadata: {pub_key: 'aa'},
    };
    provider.mpcTssSetup.mockResolvedValue(staged);
    const orch = {
      server: 'srv',
      partyID: 'p1',
      partiesCSV: 'p1,p2',
      sessionID: 'sid',
      transport: {sessionKey: 'sk', encKey: 'ek', decKey: 'dk'},
      chaincode: 'cc',
      backend: 'dkls23',
    } as any;
    const res = await invokeLanWalletKeygen(orch, 'ppm', 'duo');
    expect(provider.mpcTssSetup).toHaveBeenCalledTimes(1);
    expect(res).toBe(staged);
    expect(JSON.stringify(res)).not.toContain('share_b64');
  });

  test('invokeNostrWalletKeygen passes the legacy branch through', async () => {
    const legacy = {kind: 'legacy-gg18', json: '{"pub_key":"bb"}'};
    provider.nostrMpcTssSetup.mockResolvedValue(legacy);
    const res = await invokeNostrWalletKeygen({
      relaysCSV: 'r',
      partyNsec: 'nsec1x',
      partiesNpubsCSV: 'npub1,npub2',
      sessionID: 'sid',
      sessionKey: 'sk',
      chaincode:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ppmPath: 'ppm',
      setupMode: 'duo',
      backend: 'gg18',
    });
    expect(provider.nostrMpcTssSetup).toHaveBeenCalledTimes(1);
    expect(res).toBe(legacy);
  });

  test('discardPendingKeyshares wipes staged entries', async () => {
    await discardPendingKeyshares();
    expect(native.destroyKeyshareHandles).toHaveBeenCalledTimes(1);
  });

  test('discardPendingKeyshares never throws', async () => {
    native.destroyKeyshareHandles.mockRejectedValueOnce(new Error('down'));
    await expect(discardPendingKeyshares()).resolves.toBeUndefined();
  });
});
