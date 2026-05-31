/**
 * Static checks: Android native module must not reference gomobile Tss.*
 * (dual Go runtime with libbbmtmobile causes heap corruption).
 */
import fs from 'fs';
import path from 'path';

const nativeModulePath = path.join(
  __dirname,
  '../android/app/src/main/java/com/boldwallet/BBMTLibNativeModule.kt',
);
const dklsNativePath = path.join(
  __dirname,
  '../android/app/src/main/java/com/boldwallet/DklsNative.kt',
);
const buildGradlePath = path.join(__dirname, '../android/app/build.gradle');

describe('Android single Go runtime', () => {
  it('BBMTLibNativeModule has no gomobile Tss references', () => {
    const src = fs.readFileSync(nativeModulePath, 'utf8');
    expect(src).not.toMatch(/\bTss\./);
    expect(src).not.toMatch(/import\s+tss\./);
  });

  it('DklsNative documents bbmtmobile-only Android bridge', () => {
    const src = fs.readFileSync(dklsNativePath, 'utf8');
    expect(src).toMatch(/Single Go runtime/);
    expect(src).toMatch(/bbmtJoinKeygenJni/);
    expect(src).not.toMatch(/gomobile tss\.aar/);
  });

  it('build.gradle does not implement tss.aar', () => {
    const gradle = fs.readFileSync(buildGradlePath, 'utf8');
    expect(gradle).not.toMatch(/implementation\s+files\(["']libs\/tss\.aar["']\)/);
  });
});
