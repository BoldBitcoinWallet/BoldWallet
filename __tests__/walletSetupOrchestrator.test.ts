jest.mock('../services/WalletService', () => ({
  waitMS: jest.fn(() => Promise.resolve()),
}));

jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {},
}));

jest.mock('../services/lanMpcSetup', () => ({}));
jest.mock('../services/lanMpcTransport', () => ({}));
jest.mock('../services/trioLanKeygenPreflight', () => ({}));
jest.mock('../services/TssProvider', () => ({TssProvider: {}}));

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

import EncryptedStorage from 'react-native-encrypted-storage';
import {saveKeyshareMetadata} from '../utils';
import {
  finalizeKeyshareForStorage,
  nsecFieldForKeyshareJson,
  persistWalletKeyshare,
  resolveWalletSetupBackend,
  verifyWalletKeysharePersisted,
  WALLET_SETUP_PREPARE_TIMEOUT_MIN,
} from '../services/walletSetupOrchestrator';
import {resolveTssBackendForKeygen} from '../services/tssBackend';

describe('walletSetupOrchestrator', () => {
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

  it('persistWalletKeyshare writes encrypted keyshare and metadata', async () => {
    const json = JSON.stringify({pub_key: 'aa', share_b64: 'bb'});
    (EncryptedStorage.getItem as jest.Mock).mockResolvedValue(json);
    const saved = await persistWalletKeyshare(json, {
      partyNsec: 'nsec1persisttest',
      nostrNpub: 'npub1persist',
    });
    expect(saved).toContain('"nsec"');
    expect(EncryptedStorage.setItem).toHaveBeenCalledWith('keyshare', saved);
    expect(saveKeyshareMetadata).toHaveBeenCalledWith(saved, {
      throwOnError: true,
    });
  });

  it('persistWalletKeyshare fails when read-back verification fails', async () => {
    (EncryptedStorage.getItem as jest.Mock).mockResolvedValue(null);
    await expect(
      persistWalletKeyshare(JSON.stringify({pub_key: 'aa', share_b64: 'bb'})),
    ).rejects.toThrow(/could not save your key share securely/i);
  });

  it('verifyWalletKeysharePersisted returns false for empty storage', async () => {
    (EncryptedStorage.getItem as jest.Mock).mockResolvedValue('  ');
    await expect(verifyWalletKeysharePersisted()).resolves.toBe(false);
  });
});
