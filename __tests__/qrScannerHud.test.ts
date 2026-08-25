import {
  elapsedScanSecondsSince,
  formatAndroidZxingProgressLabel,
  formatElapsedScanSeconds,
  withElapsedScanLabel,
} from '../utils/scanElapsed';

describe('QRScannerHud elapsed labels', () => {
  it('formats seconds under a minute as Ns', () => {
    expect(formatElapsedScanSeconds(0)).toBe('0s');
    expect(formatElapsedScanSeconds(12)).toBe('12s');
    expect(formatElapsedScanSeconds(59)).toBe('59s');
  });

  it('formats a minute and more as m:ss', () => {
    expect(formatElapsedScanSeconds(60)).toBe('1:00');
    expect(formatElapsedScanSeconds(75)).toBe('1:15');
    expect(formatElapsedScanSeconds(125)).toBe('2:05');
  });

  it('appends elapsed to the scan status line', () => {
    expect(withElapsedScanLabel('Recovered 12 / 40', 8)).toBe(
      'Recovered 12 / 40 · 8s',
    );
    expect(withElapsedScanLabel('', 61)).toBe('Elapsed 1:01');
  });

  it('computes elapsed from a start timestamp (not a paused JS interval)', () => {
    const now = 1_700_000_012_500;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    expect(elapsedScanSecondsSince(now - 8500)).toBe(8);
    expect(elapsedScanSecondsSince(now)).toBe(0);
    expect(elapsedScanSecondsSince(null)).toBe(0);
    expect(elapsedScanSecondsSince(0)).toBe(0);
    jest.restoreAllMocks();
  });

  it('formats a two-line ZXing overlay with recovered frames', () => {
    expect(
      formatAndroidZxingProgressLabel({
        title: 'Scanning Animated QR...',
        progress: {received: 12, total: 40, percentage: 30},
        elapsedSeconds: 8,
      }),
    ).toBe('Scanning Animated QR...\n12 / 40 (30%) · 8s');
    expect(
      formatAndroidZxingProgressLabel({
        title: 'Scanning Animated QR...',
        progress: {received: 40, total: 40, percentage: 100},
        elapsedSeconds: 12,
      }),
    ).toBe('Scanning Animated QR...\nProcessing… · 12s');
  });
});
