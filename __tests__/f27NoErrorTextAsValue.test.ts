import * as fs from 'fs';
import * as path from 'path';

// F27: regression tripwire for error-text-as-value. Pins the absence of the
// two known-bad bridge patterns (L5 source-text precedent):
//  - Swift: resolving `error!.localizedDescription` / the old resolve() helper
//  - Kotlin: raw JNI wrappers outside the inline-fixed/dead allowlist, and
//    promise.resolve(e.message) in catch blocks.
// Behavioral proof is native-side (instrumented tests + Go prefix contract);
// this file fails the suite if anyone reintroduces the pattern.

const SWIFT = path.join(__dirname, '../ios/BBMTLibNativeModule.swift');
const DKLs = path.join(
  __dirname,
  '../android/app/src/main/java/com/boldwallet/DklsNative.kt',
);
const MODULE = path.join(
  __dirname,
  '../android/app/src/main/java/com/boldwallet/BBMTLibNativeModule.kt',
);

// Raw wrappers whose @ReactMethod already prefix-checks inline (fixed at the
// method layer), plus dead/void wrappers. Everything else must unwrap().
const ANDROID_RAW_ALLOWLIST = new Set([
  'bbmtGenerateKeyPairNative', // eciesKeypair inline-checks
  'bbmtSecureRandomNative', // secureRandom inline-checks
  'bbmtFetchDataNative', // fetchData inline-checks
  'bbmtPublishDataNative', // publishData inline-checks
  'bbmtUseAPINative', // setAPI inline-checks
  'bbmtUseFeeAPIsNative', // setFeeAPIs inline-checks
  'bbmtBackupEncryptNative', // backupEncrypt inline-checks
  'bbmtImportBackupStagedNative', // importBackup inline-checks
  'bbmtFinalizeStagedForPersistNative', // persist inline-checks
  'bbmtDestroyStagedNative', // persist inline-checks
  'bbmtDestroyAllStagedNative', // destroyHandles inline-checks
  'bbmtProjectMetadataNative', // getKeyshareMetadata inline-checks
  'bbmtRedactedStructureNative', // getKeyshareStructure inline-checks
  'bbmtAesEncryptNative', // dead: no callers
  'bbmtAesDecryptNative', // dead: no callers
  'helloDkgNative', // dead: dklsHelloDkg resolves static text
]);

describe('F27 no error-text-as-value patterns', () => {
  test('Swift has no resolve-error-text ternary', () => {
    const src = fs.readFileSync(SWIFT, 'utf8');
    expect(src).not.toMatch(/resolver\(error == nil \? output/);
  });

  test('Swift old resolve() helper is gone (resolveOrReject only)', () => {
    const src = fs.readFileSync(SWIFT, 'utf8');
    // resolveOrReject( allowed; bare resolve("tag", ...) helper calls are not.
    // (resolve( as an RN param name — `resolve(value)` — is fine.)
    const bare = src.match(/[^a-zA-Z]resolve\("[a-zA-Z0-9]+", output, /g) || [];
    expect(bare).toEqual([]);
    expect(src).toMatch(/private func resolveOrReject\(/);
  });

  test('Android wrappers unwrap or are allowlisted', () => {
    const src = fs.readFileSync(DKLs, 'utf8');
    const lines = src.split('\n');
    const bad: string[] = [];
    lines.forEach((ln, i) => {
      const m = ln.match(/fun (\w+Native)\b/);
      if (!m) {
        return;
      }
      const name = m[1];
      // Scan the wrapper body (up to 25 lines; long signatures) for unwrap(.
      const body = lines.slice(i, i + 25).join('\n');
      if (!body.includes('unwrap(') && !ANDROID_RAW_ALLOWLIST.has(name)) {
        // Void helpers (no JNI value return) are N/A.
        if (/:\s*String\b/.test(body.slice(0, 200))) {
          bad.push(name);
        }
      }
    });
    expect(bad).toEqual([]);
  });

  test('Android has no promise.resolve(e.message) in catch', () => {
    const src = fs.readFileSync(MODULE, 'utf8');
    expect(src).not.toMatch(/promise\.resolve\(e\.message\)/);
  });
});
