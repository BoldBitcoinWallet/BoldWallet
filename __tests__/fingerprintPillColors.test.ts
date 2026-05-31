import {colorsFromWalletFingerprint} from '../utils/fingerprintPillColors';

describe('colorsFromWalletFingerprint', () => {
  it('returns stable band colors for the same fingerprint hex', () => {
    const a = colorsFromWalletFingerprint('a1b2c3d4', true);
    const b = colorsFromWalletFingerprint('a1b2c3d4', true);
    expect(a).toEqual(b);
    expect(a.bandBackgroundColor).toMatch(/^rgba\(/);
  });

  it('differs band background between two fingerprints', () => {
    const a = colorsFromWalletFingerprint('a1b2c3d4', true);
    const b = colorsFromWalletFingerprint('ff001122', true);
    expect(a.bandBackgroundColor).not.toBe(b.bandBackgroundColor);
  });

  it('uses neutral band palette for missing fingerprint', () => {
    const colors = colorsFromWalletFingerprint('N/A', true);
    expect(colors.bandBackgroundColor).toContain('160');
  });

  it('picks a readable icon tint on the band (dark or light)', () => {
    const light = colorsFromWalletFingerprint('9afca4e1', true);
    expect(light.iconTint).toMatch(/^#[0-9a-f]{6}$/i);

    const dark = colorsFromWalletFingerprint('9afca4e1', false);
    expect(dark.iconTint).toMatch(/^#[0-9a-f]{6}$/i);
    expect(dark.bandBackgroundColor).toContain('0.28');
  });
});
