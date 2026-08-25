/**
 * Static Play Console packaging + LAN discovery permission helper.
 * @format
 */

import fs from 'fs';
import path from 'path';
import {PermissionsAndroid, Platform} from 'react-native';
import {
  androidApiLevel,
  ensureLanDiscoveryPermission,
  NEARBY_WIFI_DEVICES,
} from '../services/lanDiscoveryPermissions';

const manifestPath = path.join(
  __dirname,
  '../android/app/src/main/AndroidManifest.xml',
);
const gradlePath = path.join(__dirname, '../android/app/build.gradle');
const playAabShPath = path.join(
  __dirname,
  '../android/scripts/build-play-aab.sh',
);
const playCopyShPath = path.join(
  __dirname,
  '../android/scripts/copy-play-artifacts.sh',
);
const checkPlayShPath = path.join(
  __dirname,
  '../android/scripts/check-play-manifest.sh',
);

describe('Play Console packaging', () => {
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const gradle = fs.readFileSync(gradlePath, 'utf8');
  const playAabSh = fs.readFileSync(playAabShPath, 'utf8');
  const playCopySh = fs.readFileSync(playCopyShPath, 'utf8');
  const checkPlaySh = fs.readFileSync(checkPlayShPath, 'utf8');

  it('marks camera, location, and wifi features optional', () => {
    const features = [
      'android.hardware.camera',
      'android.hardware.camera.autofocus',
      'android.hardware.camera.flash',
      'android.hardware.camera.front',
      'android.hardware.location',
      'android.hardware.location.gps',
      'android.hardware.wifi',
    ];
    for (const name of features) {
      expect(manifest).toMatch(
        new RegExp(
          `android:name="${name.replace(/\./g, '\\.')}" android:required="false"`,
        ),
      );
    }
  });

  it('caps location at API 32 and declares nearby Wi-Fi', () => {
    expect(manifest).toMatch(
      /ACCESS_FINE_LOCATION" android:maxSdkVersion="32"/,
    );
    expect(manifest).toMatch(
      /ACCESS_COARSE_LOCATION" android:maxSdkVersion="32"/,
    );
    expect(manifest).toContain('NEARBY_WIFI_DEVICES');
    expect(manifest).toContain('neverForLocation');
  });

  it('caps legacy storage at API 32', () => {
    expect(manifest).toMatch(
      /READ_EXTERNAL_STORAGE[\s\S]*?android:maxSdkVersion="32"/,
    );
    expect(manifest).toMatch(
      /WRITE_EXTERNAL_STORAGE[\s\S]*?android:maxSdkVersion="32"/,
    );
  });

  it('ships English-only resources, optimized R8, and native symbols', () => {
    expect(gradle).toContain('resConfigs "en"');
    expect(gradle).toContain('proguard-android-optimize.txt');
    expect(gradle).toContain("debugSymbolLevel 'SYMBOL_TABLE'");
    expect(playAabSh).toContain('bundleRelease');
    expect(playAabSh).toContain('playAbi=arm64-v8a');
    expect(playCopySh).toContain('native-debug-symbols.zip');
  });

  it('uses a single enabled launcher alias (not MainActivity LAUNCHER)', () => {
    const mainBlock = manifest.slice(
      manifest.indexOf('android:name=".MainActivity"'),
      manifest.indexOf('</activity>'),
    );
    expect(mainBlock).not.toContain('android.intent.category.LAUNCHER');
    expect(manifest).toMatch(
      /android:name="\.DefaultIconActivity"[\s\S]*?android:enabled="true"/,
    );
    expect(manifest).toMatch(
      /android:name="\.AlternativeIconActivity"[\s\S]*?android:enabled="false"/,
    );
    const launcherCount = (
      manifest.match(/android\.intent\.category\.LAUNCHER/g) || []
    ).length;
    expect(launcherCount).toBe(5);
  });

  it('declares MPC keep-alive foreground service and permissions', () => {
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE');
    expect(manifest).toContain(
      'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
    );
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).toContain('android.permission.WAKE_LOCK');
    expect(manifest).toContain(
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    );
    expect(manifest).toContain('android:name=".MpcKeepAliveService"');
    expect(manifest).toContain('android:foregroundServiceType="specialUse"');
    expect(manifest).toContain('android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE');
    expect(manifest).toContain('threshold cryptography');
  });

  it('documents Play Console specialUse declaration in Device QA', () => {
    expect(checkPlaySh).toContain(
      'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    );
    expect(checkPlaySh).toContain('Foreground service');
    expect(checkPlaySh).toContain('Special use');
    expect(checkPlaySh).toContain('stopForeground');
    expect(checkPlaySh).toContain('dataSync');
  });
});

describe('androidApiLevel', () => {
  it('parses numeric and string SDK versions', () => {
    expect(androidApiLevel(34)).toBe(34);
    expect(androidApiLevel('33')).toBe(33);
    expect(androidApiLevel('x')).toBe(0);
  });
});

describe('ensureLanDiscoveryPermission', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {value: originalOS});
    Object.defineProperty(Platform, 'Version', {value: originalVersion});
    jest.restoreAllMocks();
  });

  it('does not prompt on iOS', async () => {
    Object.defineProperty(Platform, 'OS', {configurable: true, value: 'ios'});
    await expect(ensureLanDiscoveryPermission()).resolves.toBe(true);
  });

  it('does not prompt on API 32 (existing location-manifest behavior)', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: 32,
    });
    const check = jest.spyOn(PermissionsAndroid, 'check');
    await expect(ensureLanDiscoveryPermission()).resolves.toBe(true);
    expect(check).not.toHaveBeenCalled();
  });

  it('requests NEARBY_WIFI_DEVICES on API 33+', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: 34,
    });
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false as never);
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED as never);
    await expect(ensureLanDiscoveryPermission()).resolves.toBe(true);
    expect(PermissionsAndroid.request).toHaveBeenCalledWith(
      NEARBY_WIFI_DEVICES,
      expect.objectContaining({buttonPositive: 'OK'}),
    );
  });
});
