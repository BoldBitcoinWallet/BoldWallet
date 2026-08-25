/**
 * Wallet setup UI copy and status lines — GG18-analog presentation for LAN keygen.
 * DKLS and GG18 share the same user-facing flow; routing stays in TssProvider.
 */

import type {TssBackend} from './tssBackend';

/** Prepare-device modal (preparams / helloDkg). */
export const WALLET_SETUP_PREPARE_COPY = {
  title: 'Preparing Device',
  subtitle: 'Could take a while, given device specs.',
  statusLine: 'Computing cryptographic params',
  successLine: 'Device Preparation Done',
} as const;

export type KeepAliveOs = 'ios' | 'android';
export type MpcKeepAliveKind = 'prepare' | 'keygen' | 'sign';

/** Platform-specific keep-alive hint during prepare / keygen / co-sign. */
export function getMpcKeepAliveSetupHint(
  os: KeepAliveOs,
  opts?: {notificationsGranted?: boolean},
): string {
  if (os === 'ios') {
    return 'Keep Bold Wallet on screen. Locking the phone is OK; switching apps may stop setup.';
  }
  if (opts?.notificationsGranted === false) {
    return 'Notifications are off. Stay on this screen.';
  }
  return 'You can switch apps. Progress stays in a notification. Don’t force-close Bold or swipe it away.';
}

export function getMpcKeepAliveCheckboxLabel(os: KeepAliveOs): string {
  if (os === 'ios') {
    return 'I understand — keep Bold on screen';
  }
  return 'I understand — don’t swipe Bold away';
}

export function getMpcKeepAliveNotificationsOffLine(): string {
  return 'Notifications are off. Stay on this screen.';
}

export function getMpcKeepAliveBatteryCopy(): {
  body: string;
  allow: string;
  dismiss: string;
} {
  return {
    body: 'Some phones stop apps in the background. Allow unrestricted battery use so co-signing can finish if you switch apps.',
    allow: 'Allow',
    dismiss: 'Not now',
  };
}

export function getMpcKeepAliveIosReturnCopy(): {title: string; body: string} {
  return {
    title: 'Return to Bold',
    body: 'Setup may stop if you stay away.',
  };
}

export function getMpcKeepAlivePrepareModalSubtitle(
  os: KeepAliveOs,
  opts?: {notificationsGranted?: boolean},
): string {
  return `${WALLET_SETUP_PREPARE_COPY.subtitle} ${getMpcKeepAliveSetupHint(os, opts)}`;
}

export function getMpcKeepAliveKeygenSubtitle(
  os: KeepAliveOs,
  opts?: {notificationsGranted?: boolean},
): string {
  return `Securing your wallet with advanced cryptography. ${getMpcKeepAliveSetupHint(os, opts)}`;
}

export function getMpcKeepAliveNotificationTitle(
  kind: MpcKeepAliveKind,
  appLabel: string,
  camouflaged: boolean,
): string {
  if (camouflaged) {
    return appLabel;
  }
  if (kind === 'prepare') {
    return 'Preparing device';
  }
  if (kind === 'sign') {
    return 'Co-signing';
  }
  return 'Wallet setup';
}

export function getMpcKeepAliveInitialStatus(kind: MpcKeepAliveKind): string {
  if (kind === 'prepare') {
    return 'Computing cryptographic params';
  }
  if (kind === 'sign') {
    return 'Starting co-signing…';
  }
  return 'Starting wallet setup…';
}

export function getMpcKeepAliveCompleteCopy(
  kind: MpcKeepAliveKind,
  outcome: 'success' | 'failure' | 'abort',
  camouflaged: boolean,
): {title: string; body: string} | null {
  if (outcome === 'abort') {
    return null;
  }
  if (camouflaged) {
    return {
      title: 'Finished',
      body:
        outcome === 'success'
          ? 'Open the app to continue.'
          : 'Interrupted — open the app to retry.',
    };
  }
  if (outcome === 'success') {
    if (kind === 'prepare') {
      return {title: 'Device ready', body: 'Preparation finished.'};
    }
    if (kind === 'sign') {
      return {title: 'Signing finished', body: 'Open Bold to continue.'};
    }
    return {title: 'Wallet ready', body: 'Open Bold to continue.'};
  }
  if (kind === 'sign') {
    return {
      title: 'Signing interrupted',
      body: 'Open Bold to retry. Don’t force-close the app next time.',
    };
  }
  return {
    title: 'Setup interrupted',
    body: 'Open Bold to retry. Don’t force-close the app next time.',
  };
}

/** LAN pre-prep card shown before Prepare Device (task-first, no marketing). */
export const WALLET_SETUP_PREP_CARD = {
  title: 'Prepare this device',
  description: 'Wallet setup uses your local network.',
  securityLinkLabel: 'About multi-device security →',
  securityLinkUrl:
    'https://www.binance.com/en/square/post/17681517589057',
} as const;

/** MPC keygen modal while trio/duo setup runs. */
export const WALLET_SETUP_KEYGEN_MODAL = {
  title: 'Finalizing Your Wallet',
  subtitle:
    'Securing your wallet with advanced cryptography.',
} as const;

/** Status lines during LAN keygen orchestration (mpcTssSetup). */
export const LAN_KEYGEN_STATUS = {
  starting: 'Starting wallet setup…',
  preparingDevice: 'Preparing device…',
  connectingDevices: 'Waiting for all devices…',
  runningKeygen: 'Creating your wallet…',
} as const;

export type PrepareModalCopy = {
  title: string;
  subtitle: string;
  statusLine: string;
  successLine: string;
};

export type WalletSetupPrepCardCopy = {
  title: string;
  description: string;
  securityLinkLabel: string;
  securityLinkUrl: string;
};

/** Same copy for GG18 and DKLS — backend only affects routing under the hood. */
export function getPrepareModalCopy(_backend?: TssBackend): PrepareModalCopy {
  return {...WALLET_SETUP_PREPARE_COPY};
}

/** Same pre-prep card for GG18 and DKLS on LAN setup. */
export function getWalletSetupPrepCardCopy(
  _backend?: TssBackend,
): WalletSetupPrepCardCopy {
  return {...WALLET_SETUP_PREP_CARD};
}

export function getWalletSetupKeygenModalCopy(
  os?: KeepAliveOs,
  opts?: {notificationsGranted?: boolean},
): {title: string; subtitle: string} {
  if (!os) {
    return {...WALLET_SETUP_KEYGEN_MODAL};
  }
  return {
    title: WALLET_SETUP_KEYGEN_MODAL.title,
    subtitle: getMpcKeepAliveKeygenSubtitle(os, opts),
  };
}
