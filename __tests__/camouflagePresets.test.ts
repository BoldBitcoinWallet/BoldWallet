/**
 * @format
 */

import {
  CAMOUFLAGE_LABEL_MAX_LEN,
  CAMOUFLAGE_PRESETS,
  camouflageUnlockPrompt,
  isCamouflageActive,
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

  it('exposes a preview image for every preset', () => {
    for (const preset of CAMOUFLAGE_PRESETS) {
      expect(preset.preview).toBeDefined();
    }
  });

  it('treats only non-default presets as active camouflage', () => {
    expect(isCamouflageActive('default')).toBe(false);
    expect(isCamouflageActive(null)).toBe(false);
    expect(isCamouflageActive('quickcalc')).toBe(true);
    expect(isCamouflageActive('alternative')).toBe(true);
    expect(isCamouflageActive('notes')).toBe(true);
  });

  it('uses camouflage unlock copy instead of wallet wording', () => {
    expect(camouflageUnlockPrompt('default').promptMessage).toContain('wallet');
    expect(camouflageUnlockPrompt('quickcalc').promptMessage).toBe('Unlock QuickCalc');
    expect(camouflageUnlockPrompt('notes').promptMessage).toBe('Unlock Notes');
    expect(camouflageUnlockPrompt('weather').promptMessage.toLowerCase()).not.toContain(
      'wallet',
    );
    expect(camouflageUnlockPrompt('files').promptMessage.toLowerCase()).not.toContain(
      'bold',
    );
  });
});
