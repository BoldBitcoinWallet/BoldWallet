import {
  getPrepareModalCopy,
  getWalletSetupKeygenModalCopy,
  getWalletSetupPrepCardCopy,
  WALLET_SETUP_PREPARE_COPY,
  WALLET_SETUP_PREP_CARD,
} from '../services/walletSetupUi';

describe('walletSetupUi', () => {
  it('uses the same prepare copy for GG18 and DKLS', () => {
    expect(getPrepareModalCopy('gg18')).toEqual(WALLET_SETUP_PREPARE_COPY);
    expect(getPrepareModalCopy('dkls23')).toEqual(WALLET_SETUP_PREPARE_COPY);
  });

  it('uses the same pre-prep card copy for GG18 and DKLS', () => {
    expect(getWalletSetupPrepCardCopy('gg18')).toEqual(WALLET_SETUP_PREP_CARD);
    expect(getWalletSetupPrepCardCopy('dkls23')).toEqual(
      WALLET_SETUP_PREP_CARD,
    );
  });

  it('exposes keygen modal copy', () => {
    expect(getWalletSetupKeygenModalCopy().title).toBe('Finalizing Your Wallet');
    expect(getWalletSetupKeygenModalCopy('android').subtitle).toMatch(
      /notification/,
    );
  });
});
