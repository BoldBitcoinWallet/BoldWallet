jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {},
}));

import {secureRandomHex} from '../services/secureRandom';

describe('secureRandomHex', () => {
  it('falls back to JS CSPRNG when native secureRandom is missing', async () => {
    const a = await secureRandomHex(64);
    const b = await secureRandomHex(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('rejects non-positive length', async () => {
    await expect(secureRandomHex(0)).rejects.toThrow(/positive integer/);
    await expect(secureRandomHex(-1)).rejects.toThrow(/positive integer/);
  });
});
