import {redactForLog, commitmentPrefixForDisplay, isCommitmentHex} from '../services/logRedact';
import {resolveDiceMode} from '../services/diceSession';
import {DICE_SPEC_PREFIX} from '../services/diceEntropy';

describe('dice hardening (Spec v2.1 leak guards)', () => {
  test('canonical / xpub / hex64 redacted', () => {
    expect(redactForLog(`${DICE_SPEC_PREFIX}abc`)).toBe('<dice-canonical-redacted>');
    expect(redactForLog('xpub661MyMwAqRbcF')).toBe('<xkey-redacted>');
    expect(redactForLog('wpkh(xpub123/0/*)')).toBe('<descriptor-redacted>');
    const hex64 = 'a'.repeat(64);
    expect(redactForLog(hex64)).toContain('redacted');
    expect(redactForLog(hex64)).not.toBe(hex64);
  });

  test('commitment prefix display safe', () => {
    const hex64 = 'ab'.repeat(32);
    expect(commitmentPrefixForDisplay(hex64)).toBe(`${'ab'.repeat(4)}…${hex64.slice(-4)}`);
    expect(isCommitmentHex(hex64)).toBe(true);
    expect(isCommitmentHex('short')).toBe(false);
  });

  test('dice mode resolves off when no sets', () => {
    expect(resolveDiceMode([])).toBe('off');
    expect(resolveDiceMode(undefined)).toBe('off');
    expect(resolveDiceMode([{kind: 'd6', sides: 6, rolls: [1]}])).toBe('on');
  });
});
