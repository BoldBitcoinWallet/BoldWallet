import {scriptPubKeyFromAddress} from '../utils/scriptPubKeyFromAddress';

describe('scriptPubKeyFromAddress', () => {
  it('derives P2WPKH script for the BIP173 mainnet example', () => {
    expect(
      scriptPubKeyFromAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'),
    ).toBe('0014751e76e8199196d454941c45d1b3a323f1433bd6');
  });

  it('derives P2WPKH script for the BIP173 testnet example', () => {
    expect(
      scriptPubKeyFromAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'),
    ).toBe('0014751e76e8199196d454941c45d1b3a323f1433bd6');
  });

  it('derives P2PKH script', () => {
    expect(scriptPubKeyFromAddress('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH')).toBe(
      '76a914751e76e8199196d454941c45d1b3a323f1433bd688ac',
    );
  });

  it('returns null for garbage', () => {
    expect(scriptPubKeyFromAddress('tb1qrecv')).toBeNull();
    expect(scriptPubKeyFromAddress('')).toBeNull();
  });
});
