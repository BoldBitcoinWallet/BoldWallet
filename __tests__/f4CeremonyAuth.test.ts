import * as fs from 'fs';
import * as path from 'path';

/**
 * 3b-4 F4 ceremony-auth wiring pin (source-text, f18Removal
 * precedent): EVERY ceremony mint must flow through the
 * OS-rendered biometric-or-passcode prompt. This suite fails
 * the build if a mint is added outside promptAndMint (the
 * promptless-mint regression), if the prompt stops requiring
 * biometry/device-credential, or if the DEBUG test mint leaks
 * out of its compile-time elimination.
 */
const root = path.join(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** Remove `#if DEBUG … #endif` regions (test-only code). */
function stripDebugRegions(text: string): string {
  return text.replace(/#if DEBUG[\s\S]*?#endif/g, '');
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
  return m ? m.length : 0;
}

/** Nearest fun/func name before each CeremonyTokens.mint( call. */
function mintFunctions(text: string): string[] {
  const names: string[] = [];
  const re = /CeremonyTokens\.mint\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const before = text.slice(0, match.index);
    const fns = [...before.matchAll(/\b(?:fun|func)\s+([A-Za-z0-9_]+)\s*\(/g)];
    names.push(fns.length ? fns[fns.length - 1][1] : 'unknown');
  }
  return names.sort();
}

/**
 * Prompted mint lives in promptAndMint. These three SIGN mints are
 * silent on purpose: transport/cancel, PSBT keysign, and send sign.
 * Spend and export still require the OS prompt before anything leaves
 * the phone. A new mint function fails this list.
 */
const SILENT_SIGN_MINTS = [
  'requestPsbtSignCeremonyToken',
  'requestSendSignCeremonyToken',
  'requestSignTransportCeremonyToken',
];
const ANDROID_MINTS = [
  'onAuthenticationSucceeded',
  ...SILENT_SIGN_MINTS,
].sort();
const IOS_RELEASE_MINTS = ['promptAndMint', ...SILENT_SIGN_MINTS].sort();

describe('3b-4 F4 ceremony auth wiring (mint requires OS prompt)', () => {
  test('Android: prompted mint plus the three reviewed silent SIGN mints', () => {
    const kt = read(
      'android/app/src/main/java/com/boldwallet/BBMTLibNativeModule.kt',
    );
    expect(mintFunctions(kt)).toEqual(ANDROID_MINTS);
    expect(kt).toMatch(
      /onAuthenticationSucceeded[\s\S]{0,400}?CeremonyTokens\.mint\(/,
    );
  });

  test('Android: all 5 mint entries route via promptAndMint', () => {
    const kt = read(
      'android/app/src/main/java/com/boldwallet/BBMTLibNativeModule.kt',
    );
    expect(
      countMatches(
        kt,
        /fun request(Sign|Keygen|Export|Import|Config)CeremonyToken/,
      ),
    ).toBe(5);
    // 1 definition + 5 class entries + the wallet-setup keygen
    // prompt + F20 PSBT/send confirmation sheets (each gated
    // behind its native Confirm + this prompt); any further
    // caller fails the build until reviewed here.
    expect(countMatches(kt, /promptAndMint\(/)).toBe(9);
  });

  test('Android: prompt requires biometric-or-device-credential', () => {
    const kt = read(
      'android/app/src/main/java/com/boldwallet/BBMTLibNativeModule.kt',
    );
    expect(kt).toContain('BiometricPrompt');
    expect(kt).toContain('BIOMETRIC_STRONG');
    expect(kt).toContain('DEVICE_CREDENTIAL');
    expect(kt).toContain('CEREMONY_AUTH_NO_LOCK');
  });

  test('Android: test mint lives only in the debug source set', () => {
    const debugRel =
      'android/app/src/debug/java/com/boldwallet/CeremonyTestModule.kt';
    expect(fs.existsSync(path.join(root, debugRel))).toBe(true);
    expect(read(debugRel)).toContain('CeremonyTokens.mint(');
    expect(
      fs.existsSync(
        path.join(
          root,
          'android/app/src/main/java/com/boldwallet/CeremonyTestModule.kt',
        ),
      ),
    ).toBe(false);
  });

  test('iOS: prompted mint plus the three reviewed silent SIGN mints', () => {
    const swift = stripDebugRegions(read('ios/BBMTLibNativeModule.swift'));
    expect(mintFunctions(swift)).toEqual(IOS_RELEASE_MINTS);
    expect(swift).toMatch(
      /evaluatePolicy[\s\S]{0,600}?CeremonyTokens\.mint\(/,
    );
  });

  test('iOS: all 5 mint entries route via promptAndMint', () => {
    const swift = stripDebugRegions(read('ios/BBMTLibNativeModule.swift'));
    expect(
      countMatches(
        swift,
        /func request(Sign|Keygen|Export|Import|Config)CeremonyToken/,
      ),
    ).toBe(5);
    // 1 definition + 5 class entries + the wallet-setup keygen
    // prompt + F20 PSBT/send confirmation sheets (each gated
    // behind its native Confirm + this prompt); any further
    // caller fails the build until reviewed here.
    expect(countMatches(swift, /promptAndMint\(/)).toBe(9);
  });

  test('iOS: prompt requires biometric-or-passcode with no-lock refuse', () => {
    const swift = read('ios/BBMTLibNativeModule.swift');
    expect(swift).toContain('LAContext');
    expect(swift).toContain('.deviceOwnerAuthentication');
    expect(swift).toContain('passcodeNotSet');
    expect(swift).toContain('CEREMONY_AUTH_NO_LOCK');
  });

  test('iOS: test mint stays inside #if DEBUG (stripped from release)', () => {
    const raw = read('ios/BBMTLibNativeModule.swift');
    // Release mints plus the DEBUG test mint.
    expect(mintFunctions(raw)).toEqual(
      [...IOS_RELEASE_MINTS, 'requestCeremonyTokenTest'].sort(),
    );
    const debugBlocks = raw.match(/#if DEBUG[\s\S]*?#endif/g) ?? [];
    expect(debugBlocks.length).toBeGreaterThan(0);
    expect(
      debugBlocks.some(b => b.includes('CeremonyTokens.mint(')),
    ).toBe(true);
  });
});
