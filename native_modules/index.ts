import {NativeModules} from 'react-native';
export const {BBMTLibNativeModule, KeyshareShareModule, IncomingUrlModule, MpcKeepAliveModule} = NativeModules;

/** Device entropy source metadata returned by native modules (iOS/Android). */
export type DeviceEntropyMetadata = {
  platform: 'ios' | 'android';
  os_version: string;
  device_model: string;
  crypto_framework: string; // e.g. "Apple Security Framework (SecRandomCopyBytes)"
  rng_source: string; // e.g. "SecRandomCopyBytes → kernel CSPRNG (/dev/random)"
  hardware_rng: string; // e.g. "Secure Enclave (available)"
  entropy_pool_health: string; // e.g. "Kernel CSPRNG — continuously reseeded"
  rng_assessment: 'Strong' | 'Weak';
};

/**
 * Fetch device entropy metadata from the native layer.
 * Always resolves — the assessment is informational, not gating.
 */
export async function getDeviceEntropyMetadata(): Promise<DeviceEntropyMetadata> {
  const jsonStr = await BBMTLibNativeModule.getDeviceEntropyMetadata();
  return JSON.parse(jsonStr) as DeviceEntropyMetadata;
}
