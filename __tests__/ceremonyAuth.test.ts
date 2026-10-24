/**
 * 3b-1 token-core acceptance (F10-bridge authorization basis).
 * Per-ceremony mint ONLY: asserts each wrapper forwards to its
 * hardcoded native entry, and — the malicious-mint simulation —
 * that NO generic "request token for class X" bridge method
 * exists on either platform (JS can neither choose the class
 * nor spoof the action label) and no prompt-bypassing minter
 * is reachable in release shape.
 */
jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    requestSignCeremonyToken: jest.fn(),
    requestKeygenCeremonyToken: jest.fn(),
    requestExportCeremonyToken: jest.fn(),
    requestImportCeremonyToken: jest.fn(),
    requestConfigCeremonyToken: jest.fn(),
    completeCeremonyToken: jest.fn(async () => true),
    releaseCeremonyToken: jest.fn(async () => true),
    // NOTE: requestCeremonyToken (generic) and
    // requestCeremonyTokenTest (DEBUG) deliberately ABSENT —
    // release shape.
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
  requestConfigCeremonyToken,
  requestExportCeremonyToken,
  requestImportCeremonyToken,
  requestKeygenCeremonyToken,
  requestSignCeremonyToken,
} from '../services/ceremonyAuth';

const native = BBMTLibNativeModule as any;
const ROOT = path.join(__dirname, '..');

const PER_OP: Array<[string, (s: string) => Promise<string>]> = [
  ['requestSignCeremonyToken', requestSignCeremonyToken],
  ['requestKeygenCeremonyToken', requestKeygenCeremonyToken],
  ['requestExportCeremonyToken', requestExportCeremonyToken],
  ['requestImportCeremonyToken', requestImportCeremonyToken],
  ['requestConfigCeremonyToken', requestConfigCeremonyToken],
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('3b-1 ceremonyAuth per-ceremony mint', () => {
  test.each(PER_OP)('%s forwards sessionID, returns token verbatim', async (
    method,
    fn,
  ) => {
    native[method].mockResolvedValue('tok-release-1');
    const token = await fn('s1');
    expect(native[method]).toHaveBeenCalledWith('s1');
    expect(token).toBe('tok-release-1');
  });

  test('empty token resolves fail closed', async () => {
    native.requestSignCeremonyToken.mockResolvedValue('');
    await expect(requestSignCeremonyToken('s1')).rejects.toBeInstanceOf(
      CeremonyAuthRequiredError,
    );
  });

  test('NO_LOCK maps to CeremonyNoLockError', async () => {
    const err: any = new Error('Set a device screen lock to continue.');
    err.code = 'CEREMONY_AUTH_NO_LOCK';
    native.requestExportCeremonyToken.mockRejectedValue(err);
    await expect(requestExportCeremonyToken('s1')).rejects.toBeInstanceOf(
      CeremonyNoLockError,
    );
  });

  test('auth failure maps to CeremonyAuthRequiredError', async () => {
    const err: any = new Error('Confirm to continue — authenticate.');
    err.code = 'CEREMONY_AUTH_REQUIRED';
    native.requestSignCeremonyToken.mockRejectedValue(err);
    await expect(requestSignCeremonyToken('s1')).rejects.toBeInstanceOf(
      CeremonyAuthRequiredError,
    );
  });

  test('complete/release forward the token', async () => {
    await completeCeremonyToken('tok-1');
    await releaseCeremonyToken('tok-2');
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-1');
    expect(native.releaseCeremonyToken).toHaveBeenCalledWith('tok-2');
  });
});

describe('3b-1 no generic mint (malicious-mint simulation)', () => {
  test('release-shaped module exposes no generic or silent minter', () => {
    expect(native.requestCeremonyToken).toBeUndefined();
    expect(native.requestCeremonyTokenTest).toBeUndefined();
    const silentMinters = Object.keys(native).filter(
      n =>
        !/^(request(Sign|Keygen|Export|Import|Config)CeremonyToken|completeCeremonyToken|releaseCeremonyToken)$/.test(
          n,
        ) && /token|mint|ceremony/i.test(n),
    );
    expect(silentMinters).toEqual([]);
  });

  test('native bridge declares no generic mint method', () => {
    // The generic name must not appear as a bridge method on
    // either platform (the DEBUG Test hook contains it as a
    // substring — match the exact method name only).
    const kt = fs.readFileSync(
      path.join(
        ROOT,
        'android',
        'app',
        'src',
        'main',
        'java',
        'com',
        'boldwallet',
        'BBMTLibNativeModule.kt',
      ),
      'utf8',
    );
    const swift = fs.readFileSync(
      path.join(ROOT, 'ios', 'BBMTLibNativeModule.swift'),
      'utf8',
    );
    const m = fs.readFileSync(
      path.join(ROOT, 'ios', 'BBMTLibNativeModule.m'),
      'utf8',
    );
    const genericRe = /requestCeremonyToken\(/;
    expect(kt).not.toMatch(genericRe);
    expect(swift).not.toMatch(genericRe);
    expect(m).not.toMatch(/requestCeremonyToken:/);
    // …while each per-ceremony entry exists on both platforms.
    for (const [method] of PER_OP) {
      expect(kt).toContain(`fun ${method}(`);
      expect(swift).toContain(`func ${method}(`);
      expect(m).toContain(`${method}:`);
    }
  });

  test('production JS never references the DEBUG Test hook or module', () => {
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
          if (
            text.includes('requestCeremonyTokenTest') ||
            text.includes('CeremonyTestModule')
          ) {
            hits.push(path.relative(ROOT, full));
          }
        }
      }
    };
    for (const sub of ['services', 'screens', 'components', 'context', 'utils']) {
      walk(path.join(ROOT, sub));
    }
    expect(hits).toEqual([]);
  });

  test('Android Test mint lives ONLY in the debug source set', () => {
    // Compile-time elimination: the prompt-bypassing minter must
    // not exist under src/main (release compiles main only).
    const mainHits: string[] = [];
    const walkMain = (dir: string) => {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkMain(full);
        } else if (/\.(kt|java)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (
            text.includes('requestCeremonyTokenTest') ||
            text.includes('CeremonyTestModule') ||
            text.includes('CeremonyTestPackage')
          ) {
            mainHits.push(path.relative(ROOT, full));
          }
        }
      }
    };
    walkMain(path.join(ROOT, 'android', 'app', 'src', 'main'));
    // Allowed: MainApplication's reflective loader (string name
    // only — no static edge, release-safe) + NOTE comments naming
    // the debug location. Anything else is a leak.
    const loaderOk = (f: string, text: string) =>
      f.endsWith('MainApplication.kt') &&
      !text.includes('import com.boldwallet.CeremonyTest');
    const leaks = mainHits.filter(f => {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      if (loaderOk(f, text)) {
        return false;
      }
      // NOTE comments may name the debug module; method/callers may not.
      const stripped = text
        .split('\n')
        .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      return (
        stripped.includes('requestCeremonyTokenTest') ||
        stripped.includes('CeremonyTestModule(') ||
        stripped.includes('CeremonyTestPackage(')
      );
    });
    expect(leaks).toEqual([]);
    // …and the debug source set actually contains the minter
    // (guard against vacuous pass by deletion).
    const debugMod = fs.readFileSync(
      path.join(
        ROOT,
        'android',
        'app',
        'src',
        'debug',
        'java',
        'com',
        'boldwallet',
        'CeremonyTestModule.kt',
      ),
      'utf8',
    );
    expect(debugMod).toContain('fun requestCeremonyTokenTest(');
  });

  test('iOS Test hook sits inside #if DEBUG on both sides', () => {
    const swift = fs.readFileSync(
      path.join(ROOT, 'ios', 'BBMTLibNativeModule.swift'),
      'utf8',
    );
    const m = fs.readFileSync(
      path.join(ROOT, 'ios', 'BBMTLibNativeModule.m'),
      'utf8',
    );
    for (const text of [swift, m]) {
      const use = text.indexOf('requestCeremonyTokenTest');
      expect(use).toBeGreaterThan(-1);
      const ifDebug = text.lastIndexOf('#if DEBUG', use);
      const endif = text.indexOf('#endif', use);
      expect(ifDebug).toBeGreaterThan(-1);
      expect(endif).toBeGreaterThan(use);
      // No second, unguarded occurrence.
      expect(text.indexOf('requestCeremonyTokenTest', endif)).toBe(-1);
    }
  });
});
