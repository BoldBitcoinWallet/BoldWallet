import {shouldSeedFreshHd} from '../services/freshHdSeed';

describe('shouldSeedFreshHd', () => {
  const fresh = {
    created: true,
    hasState: false,
    externalIndex: 0,
    changeIndex: 0,
    restoreDone: false,
    discoveryStatus: null,
    anyUsed: false,
  };

  it('seeds a created wallet that has never been indexed', () => {
    expect(shouldSeedFreshHd(fresh)).toBe(true);
  });

  it('keeps seeding while the chain is still the fresh frontier', () => {
    expect(
      shouldSeedFreshHd({
        ...fresh,
        hasState: true,
        restoreDone: true,
        discoveryStatus: 'fresh',
      }),
    ).toBe(true);
  });

  it('does not seed an imported wallet', () => {
    expect(shouldSeedFreshHd({...fresh, created: false})).toBe(false);
  });

  it('does not seed once a receive or change index has moved', () => {
    expect(
      shouldSeedFreshHd({
        ...fresh,
        hasState: true,
        externalIndex: 1,
        discoveryStatus: 'fresh',
      }),
    ).toBe(false);
    expect(
      shouldSeedFreshHd({
        ...fresh,
        hasState: true,
        changeIndex: 1,
        discoveryStatus: 'fresh',
      }),
    ).toBe(false);
  });

  it('does not seed after a real scan has finished', () => {
    expect(
      shouldSeedFreshHd({
        ...fresh,
        hasState: true,
        restoreDone: true,
        discoveryStatus: 'ok',
      }),
    ).toBe(false);
  });

  it('does not seed when any address is already used', () => {
    expect(shouldSeedFreshHd({...fresh, anyUsed: true})).toBe(false);
  });
});
