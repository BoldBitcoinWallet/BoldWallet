import * as fs from 'fs';
import * as path from 'path';

/**
 * 3b-3 F18 removal evidence (source-text pin, diceCrosscheck precedent):
 * nostrJoinKeysign must be absent from every JS-reachable layer —
 * bridge registration, bridge methods, and all JS/TS callers —
 * while the native-only Go core stays (documented, harmless).
 * Fails the build if the method is reintroduced.
 */
const root = path.join(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(root, dir), {
    withFileTypes: true,
  })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTs(rel, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

describe('3b-3 F18 removal (nostrJoinKeysign)', () => {
  test('Android bridge method is gone (comment marker remains)', () => {
    const kt = read('android/app/src/main/java/com/boldwallet/BBMTLibNativeModule.kt');
    expect(kt).not.toMatch(/fun nostrJoinKeysign\(/);
    expect(kt).not.toContain('@ReactMethod\n    fun nostrJoinKeysign');
    expect(kt).toContain('F18 (3b-3): nostrJoinKeysign REMOVED');
  });

  test('Android JNI wrapper chain for the bridge method is gone', () => {
    const kt = read('android/app/src/main/java/com/boldwallet/DklsNative.kt');
    expect(kt).not.toMatch(/fun bbmtNostrJoinKeysignNative\(/);
    expect(kt).not.toMatch(/fun bbmtNostrJoinKeysignJni\(/);
    const cpp = read('android/app/src/main/cpp/bbmt_tss_jni.cpp');
    expect(cpp).not.toMatch(
      /Java_com_boldwallet_DklsNative_bbmtNostrJoinKeysignJni\(/,
    );
  });

  test('iOS bridge method and export entry are gone', () => {
    const swift = read('ios/BBMTLibNativeModule.swift');
    expect(swift).not.toMatch(/func nostrJoinKeysign\(/);
    expect(swift).toContain('F18 (3b-3): nostrJoinKeysign REMOVED');
    const m = read('ios/BBMTLibNativeModule.m');
    expect(m).not.toContain('RCT_EXTERN_METHOD(nostrJoinKeysign');
  });

  test('iOS shim and BbmtBridge layers are gone', () => {
    const shim = read('ios/TssShim.swift');
    expect(shim).not.toContain('func TssNostrJoinKeysign(');
    const mm = read('ios/BbmtBridge.mm');
    expect(mm).not.toContain('nostrJoinKeysign:');
    const h = read('ios/BbmtBridge.h');
    expect(h).not.toContain('nostrJoinKeysign:');
  });

  test('zero JS/TS references across app sources', () => {
    const offenders: string[] = [];
    for (const dir of ['services', 'screens', 'components', 'context']) {
      for (const rel of walkTs(dir)) {
        const text = read(rel);
        if (/(^|[^A-Za-z])nostrJoinKeysign([^A-Za-z]|$)/.test(text)) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('Go core stays native-only (documented, harmless)', () => {
    const go = read('BBMTLib/bbmtmobile/export_tss.go');
    expect(go).toContain('BbmtNostrJoinKeysign');
  });
});
