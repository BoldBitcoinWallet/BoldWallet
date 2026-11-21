/**
 * Derive the fingerprint pill's leading band color.
 * The id icon stays untinted: a white shield with a black mark. Tinting
 * paints both of those the same color, and that color can match the band.
 * The band carries the identity hue at a fixed mid luminance so the white
 * shield stays separate from it in light and dark themes.
 */

export type FingerprintBandColors = {
  bandBackgroundColor: string;
};

/** Mid gray that still separates a white shield from either card surface. */
const NEUTRAL_BAND: FingerprintBandColors = {
  bandBackgroundColor: 'rgb(61, 76, 89)',
};

/** Target sRGB relative luminance for the band. White shield contrast stays above 3:1. */
const TARGET_LUMINANCE = 0.18;
const BAND_SATURATION = 0.72;

function rgbFromFingerprintSeed(fingerprint: string): {r: number; g: number; b: number} {
  const hex = fingerprint.replace(/[^0-9a-f]/gi, '').toLowerCase();
  const seed = (hex.length >= 6 ? hex : hex.padEnd(6, '0')).slice(0, 6);
  return {
    r: parseInt(seed.slice(0, 2), 16),
    g: parseInt(seed.slice(2, 4), 16),
    b: parseInt(seed.slice(4, 6), 16),
  };
}

function channelLuminance(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function rgbToHsl(r: number, g: number, b: number): {h: number; s: number} {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) {
    return {h: 0, s: 0};
  }
  const l = (max + min) / 2;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    h = (bn - rn) / d + 2;
  } else {
    h = (rn - gn) / d + 4;
  }
  return {h: h / 6, s};
}

function hueToRgb(p: number, q: number, t: number): number {
  let hue = t;
  if (hue < 0) {
    hue += 1;
  }
  if (hue > 1) {
    hue -= 1;
  }
  if (hue < 1 / 6) {
    return p + (q - p) * 6 * hue;
  }
  if (hue < 1 / 2) {
    return q;
  }
  if (hue < 2 / 3) {
    return p + (q - p) * (2 / 3 - hue) * 6;
  }
  return p;
}

function hslToRgb(h: number, s: number, l: number): {r: number; g: number; b: number} {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, h) * 255),
    b: Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  };
}

/** Hold the fingerprint hue and pull lightness until the band is mid-tone. */
function bandRgb(h: number): {r: number; g: number; b: number} {
  let lo = 0.05;
  let hi = 0.62;
  let best = hslToRgb(h, BAND_SATURATION, 0.36);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const rgb = hslToRgb(h, BAND_SATURATION, mid);
    best = rgb;
    if (relativeLuminance(rgb.r, rgb.g, rgb.b) > TARGET_LUMINANCE) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

function rgbCss(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** Map fingerprint hex → leading band background. The icon is not recolored. */
export function colorsFromWalletFingerprint(
  fingerprint: string | null | undefined,
  _isLightTheme: boolean,
): FingerprintBandColors {
  const raw = String(fingerprint ?? '')
    .trim()
    .toLowerCase();
  const hex = raw.replace(/[^0-9a-f]/g, '');
  if (!raw || raw === 'n/a' || hex.length < 2) {
    return NEUTRAL_BAND;
  }

  const {r, g, b} = rgbFromFingerprintSeed(raw);
  const {h, s} = rgbToHsl(r, g, b);
  // A gray seed has no hue. Spread those across the wheel from the hex itself.
  const hue = s < 0.12 ? (parseInt(hex.slice(0, 6).padEnd(6, '0'), 16) % 360) / 360 : h;
  const band = bandRgb(hue);
  return {bandBackgroundColor: rgbCss(band.r, band.g, band.b)};
}
