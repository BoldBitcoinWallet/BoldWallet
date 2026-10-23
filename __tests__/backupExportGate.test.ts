import {
  evaluateBackupPassword,
  isBackupExportAllowed,
} from '../services/backupPassword';

describe('backup export gate (F16)', () => {
  it('F16: passwordpassword1 (strength 3, policy-invalid) is rejected', () => {
    const {strength, isValid} = evaluateBackupPassword('passwordpassword1');
    expect(strength).toBe(3);
    expect(isValid).toBe(false);
    expect(
      isBackupExportAllowed('passwordpassword1', 'passwordpassword1'),
    ).toBe(false);
  });

  it('F16: full 5-rule password with matching confirm is allowed', () => {
    expect(
      isBackupExportAllowed('Correct-Horse-12!', 'Correct-Horse-12!'),
    ).toBe(true);
  });

  it('F16: each single missing rule blocks export', () => {
    const cases: Array<[string, string]> = [
      ['short1A!', 'too short'],
      ['alllowercase12!', 'no uppercase'],
      ['ALLUPPERCASE12!', 'no lowercase'],
      ['NoDigitsHere!!', 'no digit'],
      ['NoSymbolHere12', 'no symbol'],
    ];
    for (const [pw, _why] of cases) {
      expect(isBackupExportAllowed(pw, pw)).toBe(false);
    }
    expect(cases.length).toBe(5);
  });

  it('F16: mismatched or empty confirm blocks export', () => {
    expect(
      isBackupExportAllowed('Correct-Horse-12!', 'Correct-Horse-12?'),
    ).toBe(false);
    expect(isBackupExportAllowed('', '')).toBe(false);
    expect(isBackupExportAllowed('Correct-Horse-12!', '')).toBe(false);
  });
});
