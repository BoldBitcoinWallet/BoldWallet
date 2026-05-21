/**
 * Derive colors for the fingerprint pill's leading band (~25% width) only.
 * Hash text and the rest of the pill use theme surfaces (see KeyshareInfoContent).
 */

export type FingerprintBandColors = {
  bandBackgroundColor: string;
  /** Icon tint with enough contrast on bandBackgroundColor */
  iconTint: string;
};

const NEUTRAL_BAND_LIGHT: FingerprintBandColors = {
  bandBackgroundColor: 'rgba(160, 160, 160, 0.22)',
  iconTint: '#5a5a5a',
};

const NEUTRAL_BAND_DARK: FingerprintBandColors = {
  bandBackgroundColor: 'rgba(140, 140, 140, 0.2)',
  iconTint: '#d8d8d8',
};

function rgbFromFingerprintSeed(fingerprint: string): {r: number; g: number; b: number} {
  const hex = fingerprint.replace(/[^0-9a-f]/gi, '').toLowerCase();
  const seed = (hex.length >= 6 ? hex : hex.padEnd(6, '0')).slice(0, 6);
  return {
    r: parseInt(seed.slice(0, 2), 16),
    g: parseInt(seed.slice(2, 4), 16),
    b: parseInt(seed.slice(4, 6), 16),
  };
}

/** Relative luminance 0–255 from RGB channels (sRGB-ish weights). */
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Pick dark or light icon tint readable on the band fill. */
function iconTintOnBand(r: number, g: number, b: number, isLightTheme: boolean): string {
  const lum = luminance(r, g, b);
  if (isLightTheme) {
    // Pastel bands are usually light → dark icon
    return lum > 150 ? '#1A2B3C' : '#344960';
  }
  return lum > 110 ? '#1A2B3C' : '#FFFFFF';
}

/** Map fingerprint hex → leading band background + contrast-safe icon tint. */
export function colorsFromWalletFingerprint(
  fingerprint: string | null | undefined,
  isLightTheme: boolean,
): FingerprintBandColors {
  const raw = String(fingerprint ?? '')
    .trim()
    .toLowerCase();
  if (!raw || raw === 'n/a' || raw.replace(/[^0-9a-f]/g, '').length < 2) {
    return isLightTheme ? NEUTRAL_BAND_LIGHT : NEUTRAL_BAND_DARK;
  }

  const {r, g, b} = rgbFromFingerprintSeed(raw);

  if (isLightTheme) {
    return {
      bandBackgroundColor: `rgba(${blend(r, 255, 0.72)}, ${blend(g, 255, 0.72)}, ${blend(b, 255, 0.72)}, 0.88)`,
      iconTint: iconTintOnBand(r, g, b, true),
    };
  }

  return {
    bandBackgroundColor: `rgba(${r}, ${g}, ${b}, 0.28)`,
    iconTint: iconTintOnBand(r, g, b, false),
  };
}

function blend(channel: number, target: number, weight: number): number {
  return Math.round(channel * (1 - weight) + target * weight);
}
