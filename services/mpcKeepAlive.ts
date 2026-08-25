/**
 * Keep the process alive during prepare / keygen / co-sign.
 * Android: foreground service + ongoing progress notification.
 * iOS: idle timer + short background task + local complete/fail notifications.
 */

import EncryptedStorage from 'react-native-encrypted-storage';
import {
  AppState,
  NativeModules,
  PermissionsAndroid,
  Platform,
  type NativeEventSubscription,
} from 'react-native';
import {androidApiLevel} from './lanDiscoveryPermissions';
import {
  camouflagePresetById,
  isCamouflageActive,
  normalizeCamouflagePresetId,
} from './camouflagePresets';
import {
  getMpcKeepAliveCompleteCopy,
  getMpcKeepAliveInitialStatus,
  getMpcKeepAliveNotificationTitle,
  type MpcKeepAliveKind,
} from './walletSetupUi';

export type {MpcKeepAliveKind};
export type MpcKeepAliveTransport = 'lan' | 'nostr';
export type MpcKeepAliveOutcome = 'success' | 'failure' | 'abort';

export type MpcKeepAliveStartOpts = {
  kind: MpcKeepAliveKind;
  transport: MpcKeepAliveTransport;
};

export type MpcKeepAliveBranding = {
  appLabel: string;
  camouflaged: boolean;
};

export type MpcKeepAliveUiState = {
  active: boolean;
  notificationsGranted: boolean;
  showBatteryPrompt: boolean;
  camouflaged: boolean;
};

type NativeKeepAlive = {
  start: (options: {
    kind: string;
    transport: string;
    appLabel: string;
    camouflaged: boolean;
    title: string;
    status: string;
  }) => Promise<boolean>;
  update: (options: {percent: number; status: string}) => Promise<boolean>;
  stop: (options: {
    outcome: string;
    title: string;
    body: string;
  }) => Promise<boolean>;
  warnBackgrounded?: () => Promise<boolean>;
  isIgnoringBatteryOptimizations?: () => Promise<boolean>;
  requestIgnoreBatteryOptimizations?: () => Promise<boolean>;
};

const POST_NOTIFICATIONS = 'android.permission.POST_NOTIFICATIONS';
export const MPC_BATTERY_EXEMPT_DONT_ASK_KEY = 'mpc_battery_exempt_dont_ask';

let sessionGen = 0;
let activeGen = 0;
let activeKind: MpcKeepAliveKind = 'keygen';
let activeBranding: MpcKeepAliveBranding = {
  appLabel: 'Bold Wallet',
  camouflaged: false,
};
let iosBgSub: NativeEventSubscription | null = null;
let iosBgWarned = false;

let uiState: MpcKeepAliveUiState = {
  active: false,
  notificationsGranted: true,
  showBatteryPrompt: false,
  camouflaged: false,
};
const uiListeners = new Set<(state: MpcKeepAliveUiState) => void>();

function nativeModule(): NativeKeepAlive | null {
  const mod = NativeModules.MpcKeepAliveModule as NativeKeepAlive | undefined;
  if (!mod || typeof mod.start !== 'function') {
    return null;
  }
  return mod;
}

function setUiState(partial: Partial<MpcKeepAliveUiState>): void {
  uiState = {...uiState, ...partial};
  uiListeners.forEach(listener => listener(uiState));
}

export function getMpcKeepAliveUiState(): MpcKeepAliveUiState {
  return uiState;
}

export function subscribeMpcKeepAliveUi(
  listener: (state: MpcKeepAliveUiState) => void,
): () => void {
  uiListeners.add(listener);
  listener(uiState);
  return () => {
    uiListeners.delete(listener);
  };
}

export function resetMpcKeepAliveForTests(): void {
  sessionGen = 0;
  activeGen = 0;
  activeKind = 'keygen';
  activeBranding = {appLabel: 'Bold Wallet', camouflaged: false};
  iosBgWarned = false;
  detachIosBackgroundWarning();
  uiState = {
    active: false,
    notificationsGranted: true,
    showBatteryPrompt: false,
    camouflaged: false,
  };
}

export function isMpcKeepAliveActive(): boolean {
  return activeGen !== 0;
}

export async function resolveMpcKeepAliveBranding(): Promise<MpcKeepAliveBranding> {
  if (Platform.OS !== 'android') {
    return {appLabel: 'Bold Wallet', camouflaged: false};
  }
  try {
    const raw = await EncryptedStorage.getItem('app_icon_preference');
    const id = normalizeCamouflagePresetId(raw);
    return {
      appLabel: camouflagePresetById(id).label,
      camouflaged: isCamouflageActive(raw),
    };
  } catch {
    return {appLabel: 'Bold Wallet', camouflaged: false};
  }
}

export function publicKeepAliveStatus(
  status: string,
  percent: number | null | undefined,
  camouflaged: boolean,
): string {
  if (!camouflaged) {
    return status;
  }
  if (percent != null && percent > 0) {
    return `Working… ${Math.round(percent)}%`;
  }
  return 'Working…';
}

/** Android 13+ notification permission. Denial is non-fatal (stay on screen). */
export async function ensureMpcNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  if (androidApiLevel() < 33) {
    return true;
  }
  try {
    const already = await PermissionsAndroid.check(POST_NOTIFICATIONS);
    if (already) {
      return true;
    }
    const result = await PermissionsAndroid.request(POST_NOTIFICATIONS, {
      title: 'Progress notifications',
      message:
        'Bold Wallet can show wallet setup and co-signing progress when you switch apps.',
      buttonPositive: 'OK',
      buttonNegative: 'Not now',
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

function detachIosBackgroundWarning(): void {
  iosBgSub?.remove();
  iosBgSub = null;
}

function attachIosBackgroundWarning(): void {
  detachIosBackgroundWarning();
  iosBgWarned = false;
  if (Platform.OS !== 'ios') {
    return;
  }
  iosBgSub = AppState.addEventListener('change', state => {
    if (activeGen === 0 || iosBgWarned) {
      return;
    }
    // Home → background. Skip inactive (permission sheets / Control Center).
    if (state !== 'background') {
      return;
    }
    iosBgWarned = true;
    const native = nativeModule();
    native?.warnBackgrounded?.().catch(() => undefined);
  });
}

async function maybeShowBatteryPrompt(camouflaged: boolean): Promise<void> {
  if (Platform.OS !== 'android' || camouflaged) {
    setUiState({showBatteryPrompt: false});
    return;
  }
  const native = nativeModule();
  if (!native?.isIgnoringBatteryOptimizations) {
    setUiState({showBatteryPrompt: false});
    return;
  }
  try {
    const ignored = await native.isIgnoringBatteryOptimizations();
    if (ignored) {
      setUiState({showBatteryPrompt: false});
      return;
    }
    const dismissed = await EncryptedStorage.getItem(
      MPC_BATTERY_EXEMPT_DONT_ASK_KEY,
    );
    setUiState({showBatteryPrompt: dismissed !== '1'});
  } catch {
    setUiState({showBatteryPrompt: false});
  }
}

export async function requestMpcBatteryExemption(): Promise<void> {
  const native = nativeModule();
  try {
    await native?.requestIgnoreBatteryOptimizations?.();
  } catch {
    // system sheet may be unavailable
  }
  setUiState({showBatteryPrompt: false});
}

export async function dismissMpcBatteryPrompt(): Promise<void> {
  try {
    await EncryptedStorage.setItem(MPC_BATTERY_EXEMPT_DONT_ASK_KEY, '1');
  } catch {
    // ignore
  }
  setUiState({showBatteryPrompt: false});
}

export async function startMpcKeepAlive(
  opts: MpcKeepAliveStartOpts,
): Promise<{notificationsGranted: boolean}> {
  sessionGen += 1;
  activeGen = sessionGen;
  activeKind = opts.kind;
  const branding = await resolveMpcKeepAliveBranding();
  activeBranding = branding;
  const title = getMpcKeepAliveNotificationTitle(
    opts.kind,
    branding.appLabel,
    branding.camouflaged,
  );
  const status = publicKeepAliveStatus(
    getMpcKeepAliveInitialStatus(opts.kind),
    0,
    branding.camouflaged,
  );
  const notificationsGranted = await ensureMpcNotificationPermission();
  attachIosBackgroundWarning();
  setUiState({
    active: true,
    notificationsGranted,
    camouflaged: branding.camouflaged,
    showBatteryPrompt: false,
  });
  const native = nativeModule();
  if (native) {
    try {
      await native.start({
        kind: opts.kind,
        transport: opts.transport,
        appLabel: branding.appLabel,
        camouflaged: branding.camouflaged,
        title,
        status,
      });
    } catch {
      // Keep-alive is best-effort; ceremony still runs in-process.
    }
  }
  await maybeShowBatteryPrompt(branding.camouflaged);
  return {notificationsGranted};
}

export function updateMpcKeepAlive(opts: {
  percent?: number | null;
  status?: string | null;
}): void {
  if (activeGen === 0) {
    return;
  }
  const native = nativeModule();
  if (!native) {
    return;
  }
  const percent =
    opts.percent == null || !Number.isFinite(opts.percent)
      ? -1
      : Math.max(0, Math.min(99, Math.round(opts.percent)));
  const rawStatus = (opts.status ?? '').trim();
  const status = rawStatus
    ? publicKeepAliveStatus(
        rawStatus,
        percent >= 0 ? percent : null,
        activeBranding.camouflaged,
      )
    : '';
  native.update({percent, status}).catch(() => undefined);
}

export async function stopMpcKeepAlive(
  outcome: MpcKeepAliveOutcome,
): Promise<void> {
  if (activeGen === 0) {
    return;
  }
  activeGen = 0;
  detachIosBackgroundWarning();
  setUiState({
    active: false,
    showBatteryPrompt: false,
    notificationsGranted: true,
  });
  const native = nativeModule();
  if (!native) {
    return;
  }
  try {
    const copy = getMpcKeepAliveCompleteCopy(
      activeKind,
      outcome,
      activeBranding.camouflaged,
    );
    await native.stop({
      outcome,
      title: copy?.title ?? '',
      body: copy?.body ?? '',
    });
  } catch {
    // ignore
  }
}

export async function withMpcKeepAlive<T>(
  opts: MpcKeepAliveStartOpts,
  fn: () => Promise<T>,
): Promise<T> {
  await startMpcKeepAlive(opts);
  try {
    const result = await fn();
    await stopMpcKeepAlive('success');
    return result;
  } catch (err) {
    await stopMpcKeepAlive('failure');
    throw err;
  }
}
