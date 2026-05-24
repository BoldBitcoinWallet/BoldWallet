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

/** LAN pre-prep card shown before Prepare Device (task-first, no marketing). */
export const WALLET_SETUP_PREP_CARD = {
  title: 'Prepare this device',
  description:
    'Wallet setup uses your local network. Keep the app open until preparation completes.',
  securityLinkLabel: 'About multi-device security →',
  securityLinkUrl:
    'https://www.binance.com/en/square/post/17681517589057',
} as const;

/** MPC keygen modal while trio/duo setup runs. */
export const WALLET_SETUP_KEYGEN_MODAL = {
  title: 'Finalizing Your Wallet',
  subtitle:
    'Securing your wallet with advanced cryptography. Please stay in the app...',
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

export function getWalletSetupKeygenModalCopy(): typeof WALLET_SETUP_KEYGEN_MODAL {
  return WALLET_SETUP_KEYGEN_MODAL;
}
