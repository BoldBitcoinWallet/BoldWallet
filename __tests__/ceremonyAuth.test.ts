/**
 * 3b-1 token-core acceptance (F10-bridge authorization basis).
 * Covers the JS wrapper contract plus the malicious-mint
 * simulation: with a release-shaped native module (no DEBUG
 * Test hook), there is NO JS-callable mint path except the
 * OS-prompted requestCeremonyToken, and the wrapper forges
 * nothing (returns exactly what native resolves).
 */
jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    requestCeremonyToken: jest.fn(),
    completeCeremonyToken: jest.fn(async () => true),
    releaseCeremonyToken: jest.fn(async () => true),
    // NOTE: requestCeremonyTokenTest deliberately ABSENT —
    // release shape (Android refuses at runtime, iOS strips).
  },
}));

jest.mock('../utils', () => ({dbg: jest.fn()}));

import * as fs from 'fs';
import * as path from 'path';
import {BBMTLibNativeModule} from '../native_modules';
import {
  CeremonyAuthRequiredError,
  CeremonyNoLockError,
  completeCeremonyToken,
  releaseCeremonyToken,
  requestCeremonyToken,
} from '../services/ceremonyAuth';

const native = BBMTLibNativeModule as any;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('3b-1 ceremonyAuth wrapper', () => {
  test('request forwards op/session/title/detail, returns token verbatim', async () => {
    native.requestCeremonyToken.mockResolvedValue('tok-release-1');
    const token = await requestCeremonyToken(
      'sign',
      's1',
      'Sign transaction',
      '1 input',
    );
    expect(native.requestCeremonyToken).toHaveBeenCalledWith(
      'sign',
      's1',
      'Sign transaction',
      '1 input',
    );
    expect(token).toBe('tok-release-1');
  });

  test('empty token resolves fail closed', async () => {
    native.requestCeremonyToken.mockResolvedValue('');
    await expect(
      requestCeremonyToken('sign', 's1', 't', 'd'),
    ).rejects.toBeInstanceOf(CeremonyAuthRequiredError);
  });

  test('NO_LOCK maps to CeremonyNoLockError', async () => {
    const err: any = new Error('Set a device screen lock to continue.');
    err.code = 'CEREMONY_AUTH_NO_LOCK';
    native.requestCeremonyToken.mockRejectedValue(err);
    await expect(
      requestCeremonyToken('sign', 's1', 't', 'd'),
    ).rejects.toBeInstanceOf(CeremonyNoLockError);
  });

  test('auth failure maps to CeremonyAuthRequiredError', async () => {
    const err: any = new Error('Confirm to continue — authenticate.');
    err.code = 'CEREMONY_AUTH_REQUIRED';
    native.requestCeremonyToken.mockRejectedValue(err);
    await expect(
      requestCeremonyToken('sign', 's1', 't', 'd'),
    ).rejects.toBeInstanceOf(CeremonyAuthRequiredError);
  });

  test('complete/release forward the token', async () => {
    await completeCeremonyToken('tok-1');
    await releaseCeremonyToken('tok-2');
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-1');
    expect(native.releaseCeremonyToken).toHaveBeenCalledWith('tok-2');
  });
});

describe('3b-1 malicious-mint simulation (flag a)', () => {
  test('release-shaped module exposes no prompt-bypassing mint', () => {
    // Attacker JS enumerates the bridge for a silent minter.
    expect(native.requestCeremonyTokenTest).toBeUndefined();
    const names = Object.keys(native);
    const silentMinters = names.filter(
      n =>
        n !== 'requestCeremonyToken' &&
        /token|mint|ceremony/i.test(n) &&
        !/complete|release/i.test(n),
    );
    // complete/release only retire — they cannot create.
    expect(silentMinters).toEqual([]);
  });

  test('wrapper cannot forge: non-string native output fails closed', async () => {
    native.requestCeremonyToken.mockResolvedValue(null);
    await expect(
      requestCeremonyToken('export', 's9', 't', 'd'),
    ).rejects.toBeInstanceOf(CeremonyAuthRequiredError);
  });

  test('production source never references the DEBUG Test hook', () => {
    // Mirrors the f10Clipboard guardrail pattern. The Test hook
    // may appear in: native impls + this suite + (Android) the
    // module method itself. Never in shipped JS call paths.
    const root = path.join(__dirname, '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        if (entry.name === 'node_modules') {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (text.includes('requestCeremonyTokenTest')) {
            hits.push(path.relative(root, full));
          }
        }
      }
    };
    for (const sub of ['services', 'screens', 'components', 'context', 'utils']) {
      walk(path.join(root, sub));
    }
    expect(hits).toEqual([]);
  });
});
