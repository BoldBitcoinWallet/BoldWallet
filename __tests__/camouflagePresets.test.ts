/**
 * @format
 */

import {
  CAMOUFLAGE_LABEL_MAX_LEN,
  CAMOUFLAGE_PRESETS,
  isValidCamouflageLabel,
  normalizeCamouflagePresetId,
} from '../services/camouflagePresets';

describe('camouflagePresets', () => {
  it('keeps every bundled label within launcher truncation limits', () => {
    for (const preset of CAMOUFLAGE_PRESETS) {
      expect(preset.label.length).toBeLessThanOrEqual(CAMOUFLAGE_LABEL_MAX_LEN);
      expect(isValidCamouflageLabel(preset.label)).toBe(true);
    }
  });

  it('maps legacy alternative storage to quickcalc', () => {
    expect(normalizeCamouflagePresetId('alternative')).toBe('quickcalc');
    expect(normalizeCamouflagePresetId('calc')).toBe('quickcalc');
    expect(normalizeCamouflagePresetId('quickcalc')).toBe('quickcalc');
    expect(normalizeCamouflagePresetId('notes')).toBe('notes');
    expect(normalizeCamouflagePresetId('unknown')).toBe('default');
    expect(normalizeCamouflagePresetId(null)).toBe('default');
  });
});
