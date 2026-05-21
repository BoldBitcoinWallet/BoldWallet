import {
  getPrepareModalCopy,
  getWalletSetupKeygenModalCopy,
  WALLET_SETUP_PREPARE_COPY,
} from '../services/walletSetupUi';

describe('walletSetupUi', () => {
  it('uses the same prepare copy for GG18 and DKLS', () => {
    expect(getPrepareModalCopy('gg18')).toEqual(WALLET_SETUP_PREPARE_COPY);
    expect(getPrepareModalCopy('dkls23')).toEqual(WALLET_SETUP_PREPARE_COPY);
  });

  it('exposes keygen modal copy', () => {
    expect(getWalletSetupKeygenModalCopy().title).toBe('Finalizing Your Wallet');
  });
});
