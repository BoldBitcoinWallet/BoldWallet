/**
 * F16: single export gate. Export requires the FULL 5-rule policy (isValid),
 * not a reduced strength score: a strength-3 password such as
 * "passwordpassword1" must not enable export. The strength meter remains
 * display-only.
 */
export function isBackupExportAllowed(
  password: string,
  confirmPassword: string,
): boolean {
  if (!password || !confirmPassword || password !== confirmPassword) {
    return false;
  }
  return evaluateBackupPassword(password).isValid;
}

export type BackupPasswordRules = {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  symbol: boolean;
};

export function getBackupPasswordRules(pass: string): BackupPasswordRules {
  return {
    length: pass.length >= 12,
    uppercase: /[A-Z]/.test(pass),
    lowercase: /[a-z]/.test(pass),
    number: /\d/.test(pass),
    symbol: /[!@#$%^&*(),.?":{}|<>]/.test(pass),
  };
}

export function evaluateBackupPassword(pass: string): {
  errors: string[];
  strength: number;
  isValid: boolean;
} {
  const rules = getBackupPasswordRules(pass);
  const errors: string[] = [];
  if (!rules.length) {
    errors.push('12+ characters');
  }
  if (!rules.uppercase) {
    errors.push('Uppercase letter (A-Z)');
  }
  if (!rules.lowercase) {
    errors.push('Lowercase letter (a-z)');
  }
  if (!rules.number) {
    errors.push('Number (0-9)');
  }
  if (!rules.symbol) {
    errors.push('Special character (!@#$...)');
  }
  const strength = Object.values(rules).filter(Boolean).length;
  return {errors, strength, isValid: errors.length === 0};
}
