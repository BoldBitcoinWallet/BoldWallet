import {assertTrioLanKeygenReady} from '../services/trioLanKeygenPreflight';

const ok: Parameters<typeof assertTrioLanKeygenReady>[0] = {
  peerIP: '192.168.1.10',
  peerIP2: '192.168.1.11',
  peerDevice: 'PhoneB',
  peerDevice2: 'PhoneC',
  localParty: 'KeyShare1',
  peerParty: 'KeyShare2',
  peerParty2: 'KeyShare3',
  peerPubkey: 'aa',
  peerPubkey2: 'bb',
};

describe('assertTrioLanKeygenReady', () => {
  it('accepts complete trio state', () => {
    expect(() => assertTrioLanKeygenReady(ok)).not.toThrow();
  });

  it('rejects missing second peer', () => {
    expect(() =>
      assertTrioLanKeygenReady({...ok, peerIP2: null}),
    ).toThrow(/second peer/);
  });

  it('rejects duplicate roles', () => {
    expect(() =>
      assertTrioLanKeygenReady({
        ...ok,
        localParty: 'KeyShare1',
        peerParty: 'KeyShare1',
        peerParty2: 'KeyShare3',
      }),
    ).toThrow(/Duplicate party roles/);
  });

  it('rejects invalid local party', () => {
    expect(() =>
      assertTrioLanKeygenReady({...ok, localParty: 'KeyShare9'}),
    ).toThrow(/Invalid local party/);
  });
});
