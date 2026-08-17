import {shouldIgnoreNonUrDuringSendScan} from '../utils/sendQrScan';

describe('shouldIgnoreNonUrDuringSendScan', () => {
  it('ignores junk frames while a UR decoder is collecting', () => {
    expect(shouldIgnoreNonUrDuringSendScan('not a qr', true)).toBe(true);
    expect(shouldIgnoreNonUrDuringSendScan('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', true)).toBe(
      true,
    );
    expect(shouldIgnoreNonUrDuringSendScan('ur:bytes/1-3/taadec', true)).toBe(
      false,
    );
  });

  it('does not ignore frames before UR collection starts', () => {
    expect(shouldIgnoreNonUrDuringSendScan('not a qr', false)).toBe(false);
    expect(shouldIgnoreNonUrDuringSendScan('ur:bytes/1-3/taadec', false)).toBe(
      false,
    );
  });
});
