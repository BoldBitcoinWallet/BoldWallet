import {colorsFromWalletFingerprint} from '../utils/fingerprintPillColors';

function parseRgb(css: string): {r: number; g: number; b: number} {
  const match = css.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!match) {
    throw new Error(`expected rgb(), got ${css}`);
  }
  return {r: Number(match[1]), g: Number(match[2]), b: Number(match[3])};
}

function channelLuminance(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrast(a: {r: number; g: number; b: number}, b: {r: number; g: number; b: number}): number {
  const la = relativeLuminance(a.r, a.g, a.b);
  const lb = relativeLuminance(b.r, b.g, b.b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('colorsFromWalletFingerprint', () => {
  it('returns stable band colors for the same fingerprint hex', () => {
    const a = colorsFromWalletFingerprint('a1b2c3d4', true);
    const b = colorsFromWalletFingerprint('a1b2c3d4', true);
    expect(a).toEqual(b);
    expect(a.bandBackgroundColor).toMatch(/^rgb\(/);
  });

  it('differs band background between two fingerprints', () => {
    const a = colorsFromWalletFingerprint('a1b2c3d4', true);
    const b = colorsFromWalletFingerprint('ff001122', true);
    expect(a.bandBackgroundColor).not.toBe(b.bandBackgroundColor);
  });

  it('uses a neutral band for a missing fingerprint', () => {
    const colors = colorsFromWalletFingerprint('N/A', true);
    expect(colors.bandBackgroundColor).toBe('rgb(61, 76, 89)');
  });

  it('keeps the band away from the white shield and both card surfaces', () => {
    const white = {r: 255, g: 255, b: 255};
    const lightCard = {r: 248, g: 249, b: 250};
    const darkCard = {r: 30, g: 30, b: 30};
    const seeds = ['ffffff00', '000000ff', '1a2b3cff', 'ffff00aa', '9afca4e1', 'ff001122'];

    for (const seed of seeds) {
      for (const isLightTheme of [true, false]) {
        const band = parseRgb(colorsFromWalletFingerprint(seed, isLightTheme).bandBackgroundColor);
        expect(contrast(band, white)).toBeGreaterThanOrEqual(3);
        expect(contrast(band, lightCard)).toBeGreaterThanOrEqual(3);
        expect(contrast(band, darkCard)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
