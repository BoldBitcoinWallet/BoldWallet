import {
  parseEciesKeypairJson,
  resolveLanKeygenTransportKeys,
} from '../services/lanMpcTransport';

describe('lanMpcTransport', () => {
  it('parseEciesKeypairJson accepts valid keypair', () => {
    const jkp = JSON.stringify({
      publicKey: '04abc',
      privateKey: 'deadbeef',
    });
    expect(parseEciesKeypairJson(jkp)).toEqual({
      publicKey: '04abc',
      privateKey: 'deadbeef',
    });
  });

  it('resolveLanKeygenTransportKeys duo requires peer pubkey', async () => {
    const jkp = JSON.stringify({publicKey: '04a', privateKey: '0b'});
    await expect(
      resolveLanKeygenTransportKeys({
        isTrio: false,
        keypairJson: jkp,
        peerPubkey: '',
        sessionID: 'sess',
        masterHost: '192.168.1.1',
        sha256: async () => 'hash',
      }),
    ).rejects.toThrow(/pairing keys missing/i);
  });

  it('resolveLanKeygenTransportKeys duo returns ECIES keys', async () => {
    const jkp = JSON.stringify({publicKey: '04a', privateKey: '0b'});
    const t = await resolveLanKeygenTransportKeys({
      isTrio: false,
      keypairJson: jkp,
      peerPubkey: '04peer',
      sessionID: 'sess',
      masterHost: '192.168.1.1',
      sha256: async () => 'hash',
    });
    expect(t).toEqual({sessionKey: '', encKey: '04peer', decKey: '0b'});
  });

  it('resolveLanKeygenTransportKeys trio uses AES session key', async () => {
    const jkp = JSON.stringify({publicKey: '04a', privateKey: '0b'});
    const t = await resolveLanKeygenTransportKeys({
      isTrio: true,
      keypairJson: jkp,
      peerPubkey: '04peer',
      sessionID: 'sess',
      masterHost: '10.0.0.1',
      sha256: async (msg: string) => {
        expect(msg).toBe('sess,10.0.0.1');
        return 'derived';
      },
    });
    expect(t).toEqual({sessionKey: 'derived', encKey: '', decKey: ''});
  });
});
