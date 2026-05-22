import {
  firstValidLanPeerPayload,
  isLanPeerDiscoveryPayload,
  isNativeDiscoveryError,
  pollPeerFoundUntilValid,
  raceLanPeerDiscovery,
  shouldWritePeerFoundCache,
} from '../services/lanPeerDiscovery';

const validPayload =
  '192.168.1.10:55155@48656c6c6f@npub1abc,192.168.1.20:55155@6c6f63616c';

describe('isLanPeerDiscoveryPayload', () => {
  it('rejects native timeout error strings', () => {
    expect(
      isLanPeerDiscoveryPayload('error:peer discovery timed out after 5 seconds'),
    ).toBe(false);
  });

  it('accepts a valid duo discovery line', () => {
    expect(isLanPeerDiscoveryPayload(validPayload)).toBe(true);
  });
});

describe('shouldWritePeerFoundCache', () => {
  it('allows non-empty native lines except error:', () => {
    expect(shouldWritePeerFoundCache(validPayload)).toBe(true);
    expect(shouldWritePeerFoundCache('error:timeout')).toBe(false);
    expect(shouldWritePeerFoundCache('')).toBe(false);
  });
});

describe('raceLanPeerDiscovery', () => {
  it('returns first settled promise like main Promise.race', async () => {
    const fast = Promise.resolve('');
    const slow = new Promise<string | null>(resolve => {
      setTimeout(() => resolve(validPayload), 50);
    });
    const result = await raceLanPeerDiscovery([fast, slow]);
    expect(result).toBe('');
  });
});

describe('firstValidLanPeerPayload', () => {
  it('resolves on first valid payload without waiting for slow discover', async () => {
    const listen = new Promise<string | null>(resolve => {
      setTimeout(() => resolve(validPayload), 20);
    });
    const discover = new Promise<string | null>(resolve => {
      setTimeout(() => resolve(''), 200);
    });
    const result = await firstValidLanPeerPayload([listen, discover]);
    expect(result).toBe(validPayload);
  });

  it('returns null when no promise yields a valid payload', async () => {
    const result = await firstValidLanPeerPayload([
      Promise.resolve(null),
      Promise.resolve('error:timeout'),
    ]);
    expect(result).toBeNull();
  });
});

describe('pollPeerFoundUntilValid', () => {
  it('picks up valid cache after race returned empty', async () => {
    let cache = '';
    const deadline = Date.now() + 500;
    const poll = pollPeerFoundUntilValid(() => cache, deadline, 50);
    setTimeout(() => {
      cache = validPayload;
    }, 80);
    const result = await poll;
    expect(result).toBe(validPayload);
  });

  it('ignores error: cache lines', async () => {
    const result = await pollPeerFoundUntilValid(
      () => 'error:timeout',
      Date.now() + 100,
      30,
    );
    expect(result).toBeNull();
  });
});

describe('isNativeDiscoveryError', () => {
  it('detects error prefix', () => {
    expect(isNativeDiscoveryError('error:foo')).toBe(true);
    expect(isNativeDiscoveryError(validPayload)).toBe(false);
  });
});
