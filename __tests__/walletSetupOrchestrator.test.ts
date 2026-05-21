jest.mock('../services/WalletService', () => ({
  waitMS: jest.fn(() => Promise.resolve()),
}));

jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {},
}));

jest.mock('../services/tssKeygenPrepare', () => ({
  prepareDeviceForKeygen: jest.fn(async () => 'dkls23'),
}));

jest.mock('../services/tssBackend', () => ({
  resolveTssBackendForKeygen: jest.fn(async () => 'dkls23'),
}));

import {
  resolveWalletSetupBackend,
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
});
