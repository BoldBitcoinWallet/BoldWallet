import {AIRGAP_PIN_DIGITS, formatAirgapPinDisplay, generateAirgapPin, isAirgapPin} from '../services/airgapPin';

describe('airgapPin', () => {
  it('generates a 6-digit decimal PIN', async () => {
    for (let i = 0; i < 40; i++) {
      const pin = await generateAirgapPin();
      expect(isAirgapPin(pin)).toBe(true);
      expect(pin).toHaveLength(AIRGAP_PIN_DIGITS);
    }
  });

  it('formats a PIN with a middle space', () => {
    expect(formatAirgapPinDisplay('384291')).toBe('384 291');
    expect(formatAirgapPinDisplay('000001')).toBe('000 001');
  });
});
