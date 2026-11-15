/**
 * BrantaService — Branta.pro address verification SDK wrapper.
 *
 * Supports:
 * - QR scans (ZK-encoded bitcoin: URIs and Lightning invoices)
 * - React Native (provides custom crypto provider via @noble packages)
 *
 * Usage:
 *   initializeBranta(activeNetwork);
 *   const result = await resolveBrantaQr(qrData, activeNetwork);
 */
import {
  BrantaEnvironment,
  BrantaService,
  createNobleCryptoProvider,
} from '@branta-ops/branta';
import {sha256} from '@noble/hashes/sha2';
import {hmac} from '@noble/hashes/hmac';
import {gcm} from '@noble/ciphers/aes';
import {randomBytes} from '@noble/hashes/utils';
import {dbg} from '../utils';
import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';
import {isWalletOnline} from './walletOnlineStore';

export interface BrantaNormalizedPayment {
  address: string;
  platform: string;
  description?: string;
  logoUrl?: string;
  logoLightUrl?: string;
  verifyUrl?: string;
}

export type BrantaResolveResult =
  | {status: 'match'; payment: BrantaNormalizedPayment}
  | {status: 'unknown'}
  | {status: 'tampered'}
  | {status: 'incomplete'};

/** Validates that a URL starts with https:// (security check). */
function isHttpsUrl(val: unknown): boolean {
  return typeof val === 'string' && val.startsWith('https://');
}

/** Matches SDK getDerivedKeyType rails (bolt11 / Ark / silent payment). */
function isDerivedKeyValue(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.startsWith('lnbc') ||
    lower.startsWith('lntb') ||
    lower.startsWith('lnbcrt') ||
    lower.startsWith('ark1') ||
    lower.startsWith('tark1') ||
    lower.startsWith('sp1') ||
    lower.startsWith('tsp1')
  );
}

/**
 * True when offline incomplete should surface: ZK params or a derived-key
 * value the SDK would look up. Plain addresses / Bold pipe QRs are unknown.
 */
export function looksLikeBrantaVerifiableInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes('branta_id') && trimmed.includes('branta_secret')) {
    return true;
  }
  if (isDerivedKeyValue(trimmed)) {
    return true;
  }
  try {
    const url = new URL(trimmed);
    for (const key of ['lightning', 'ark', 'sp', 'silent_payment']) {
      const value = url.searchParams.get(key);
      if (value && isDerivedKeyValue(value)) {
        return true;
      }
    }
  } catch {
    // Not a URL — ignore query-param rails.
  }
  return false;
}

function pickMatchedBitcoinAddress(
  matchedDestinations:
    | Array<{value?: string; type?: string} | undefined>
    | undefined,
): string | undefined {
  if (!matchedDestinations?.length) {
    return undefined;
  }
  const typed = matchedDestinations.find(
    d =>
      d?.type === 'bitcoin_address' && typeof d.value === 'string' && d.value,
  );
  return typed?.value;
}

/** Merchant verify is opt-in; absent preference is off. */
export function isBrantaEnabled(): boolean {
  return appConfigRepository.getBool(CONFIG_KEYS.BRANTA_ENABLED, false);
}

let service: BrantaService | null = null;
let currentNetwork: string = '';

/**
 * Initialize Branta SDK for the given network.
 * Call at app startup and whenever network changes.
 * Normalizes: 'mainnet' → Production, anything else → Staging
 */
export function initializeBranta(network: string): void {
  if (!isBrantaEnabled()) {
    service = null;
    currentNetwork = '';
    return;
  }
  try {
    const environment =
      network === 'mainnet'
        ? BrantaEnvironment.Production
        : BrantaEnvironment.Staging;

    service = new BrantaService({
      environment,
      crypto: createNobleCryptoProvider({
        sha256,
        hmac,
        gcm,
        randomBytes,
      }),
    });
    currentNetwork = network;
    dbg('initializeBranta: network =', network, 'environment =', environment);
  } catch (err) {
    dbg('initializeBranta error', err);
  }
}

/**
 * Resolve a QR code to merchant info.
 *
 * Handles:
 * - ZK-encoded bitcoin: URIs (branta_id + branta_secret)
 * - Lightning invoices (bolt11) and other derived-key rails the SDK supports
 *
 * Returns status:
 * - match — merchant card + bound bitcoin_address
 * - unknown — no Branta record / disabled / empty / no on-chain dest
 * - tampered — destination was altered
 * - incomplete — network/crypto failure (or offline while enabled)
 */
export async function resolveBrantaQr(
  rawQr: string,
  network: string,
): Promise<BrantaResolveResult> {
  if (!isBrantaEnabled()) {
    return {status: 'unknown'};
  }

  const trimmed = rawQr.trim();
  if (!trimmed) {
    return {status: 'unknown'};
  }

  if (!isWalletOnline()) {
    // Plain addresses are unknown offline (no notice). Only Branta-capable
    // inputs surface incomplete so Send can warn verification did not finish.
    return looksLikeBrantaVerifiableInput(trimmed)
      ? {status: 'incomplete'}
      : {status: 'unknown'};
  }

  // Re-initialize if network changed
  if (!service || currentNetwork !== network) {
    initializeBranta(network);
  }

  if (!service) {
    return {status: 'incomplete'};
  }

  try {
    dbg('resolveBrantaQr: calling verify');
    const result = await service.verify(trimmed);

    if (result.status === 'unknown') {
      dbg('resolveBrantaQr: unknown');
      return {status: 'unknown'};
    }
    if (result.status === 'tampered') {
      dbg('resolveBrantaQr: tampered');
      return {status: 'tampered'};
    }
    if (result.status === 'incomplete') {
      dbg('resolveBrantaQr: incomplete');
      return {status: 'incomplete'};
    }

    // match
    const payment = result.payments?.[0];
    if (!payment) {
      dbg('resolveBrantaQr: match without payment');
      return {status: 'unknown'};
    }

    const address = pickMatchedBitcoinAddress(result.matchedDestinations);
    if (!address) {
      // Send form is on-chain only; bolt11-only match is not usable here.
      dbg('resolveBrantaQr: match without bitcoin_address');
      return {status: 'unknown'};
    }

    dbg('resolveBrantaQr: payments', JSON.stringify(result.payments, null, 2));
    dbg('resolveBrantaQr: verifyUrl', JSON.stringify(result.verifyUrl, null, 2));

    const normalized: BrantaNormalizedPayment = {
      address,
      platform: payment.platform || 'Unknown',
      description: payment.description,
      logoUrl: isHttpsUrl(payment.platformLogoUrl)
        ? (payment.platformLogoUrl as string)
        : undefined,
      logoLightUrl: isHttpsUrl(payment.platformLogoLightUrl)
        ? (payment.platformLogoLightUrl as string)
        : undefined,
      verifyUrl: isHttpsUrl(result.verifyUrl)
        ? (result.verifyUrl as string)
        : undefined,
    };
    dbg('resolveBrantaQr: merchant', normalized.platform, normalized.address);
    return {status: 'match', payment: normalized};
  } catch (err) {
    // crypto_unavailable and unexpected throws → incomplete (not unknown)
    dbg('resolveBrantaQr error', err);
    return {status: 'incomplete'};
  }
}
