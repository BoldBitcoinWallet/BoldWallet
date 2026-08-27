/**
 * BrantaService — Branta.pro address verification SDK wrapper.
 *
 * Supports:
 * - QR scans (ZK-encoded bitcoin: URIs and Lightning invoices)
 * - Strict privacy mode (plaintext addresses don't resolve)
 * - React Native (provides custom crypto provider via @noble packages)
 *
 * Usage:
 *   initializeBranta(activeNetwork);
 *   const result = await resolveBrantaQr(qrData, activeNetwork);
 */
import {
  BrantaServerBaseUrl,
  createNobleCryptoProvider,
} from '@branta-ops/branta';
import {BrantaService, type Payment} from '@branta-ops/branta/v2';
import {sha256} from '@noble/hashes/sha2';
import {hmac as noblHmac} from '@noble/hashes/hmac';
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

/** Wrapper for noble hmac to match SDK signature */
const hmac = (
  hash: {(msg: Uint8Array): Uint8Array},
  key: Uint8Array,
  message: Uint8Array,
): Uint8Array => {
  return noblHmac(hash as any, key, message);
};

/** Validates that a URL starts with https:// (security check). */
function isHttpsUrl(val: unknown): boolean {
  return typeof val === 'string' && val.startsWith('https://');
}

/** Bech32 HRPs used by this wallet: mainnet, testnet, regtest. */
function isBitcoinBech32(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.startsWith('bc1') ||
    lower.startsWith('tb1') ||
    lower.startsWith('bcrt1')
  );
}

function looksLikeOnChainAddress(value: string): boolean {
  if (!value) {
    return false;
  }
  if (isBitcoinBech32(value)) {
    return true;
  }
  return value.startsWith('1') || value.startsWith('3');
}

/** Bech32 compared case-insensitively; otherwise exact (matches Branta SDK 3.2.1 + testnet). */
export function brantaOnChainAddressesMatch(a: string, b: string): boolean {
  if (isBitcoinBech32(a) && isBitcoinBech32(b)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

function pickOnChainDestination(
  destinations: Array<{value?: string; type?: string} | undefined> | undefined,
): {value: string} | undefined {
  if (!destinations?.length) {
    return undefined;
  }
  const typed = destinations.find(
    d =>
      d?.type === 'bitcoin_address' && typeof d.value === 'string' && d.value,
  );
  if (typed?.value) {
    return {value: typed.value};
  }
  const inferred = destinations.find(
    d => typeof d?.value === 'string' && looksLikeOnChainAddress(d.value),
  );
  if (inferred?.value) {
    return {value: inferred.value};
  }
  return undefined;
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
    // Normalize: only 'mainnet' uses Production, everything else uses Staging
    const baseUrl =
      network === 'mainnet'
        ? BrantaServerBaseUrl.Production
        : BrantaServerBaseUrl.Staging;

    service = new BrantaService(
      {baseUrl, privacy: 'strict'},
      {
        crypto: createNobleCryptoProvider({
          sha256,
          hmac,
          gcm,
          randomBytes,
        }),
      },
    );
    currentNetwork = network;
    dbg('initializeBranta: network =', network, 'baseUrl =', baseUrl);
  } catch (err) {
    dbg('initializeBranta error', err);
  }
}

/**
 * Resolve a QR code to merchant info (strict mode).
 *
 * Handles:
 * - ZK-encoded bitcoin: URIs (branta_id + branta_secret)
 * - Lightning invoices (bolt11, bolt12, ln_url, ln_address)
 *
 * Returns: {platform, description, logoUrl, logoLightUrl, verifyUrl, address} on hit
 * Returns: null on miss, error, disabled, or if SDK returns no payments
 *
 * Errors and empty results are swallowed (per Branta design).
 */
export async function resolveBrantaQr(
  rawQr: string,
  network: string,
): Promise<BrantaNormalizedPayment | null> {
  if (!isBrantaEnabled() || !isWalletOnline()) {
    return null;
  }
  // Re-initialize if network changed
  if (!service || currentNetwork !== network) {
    initializeBranta(network);
  }

  if (!service || !rawQr.trim()) {
    return null;
  }

  try {
    dbg('resolveBrantaQr: calling getPaymentsByQrCode');
    const {payments, verifyUrl} = await service.getPaymentsByQrCode(
      rawQr.trim(),
    );

    // SDK returns empty array if not found or not Branta-verified
    if (!payments || payments.length === 0) {
      dbg('resolveBrantaQr: no payments found');
      return null;
    }

    dbg('resolveBrantaQr: payments', JSON.stringify(payments, null, 2));
    dbg('resolveBrantaQr: verifyUrl', JSON.stringify(verifyUrl, null, 2));

    const payment = payments[0] as Payment;
    if (!payment) {
      return null;
    }

    // SDK 3.2.1 already throws Tampered if the BIP-21 address does not match
    // the decrypted on-chain dest. Do not drop merchant UI here: dest[0] is
    // often Lightning, and this wrapper is shared by iOS and Android Send.
    const onChainDest = pickOnChainDestination(payment.destinations);
    const address =
      onChainDest?.value || payment.destinations?.[0]?.value || '';

    const result = {
      address,
      platform: payment.platform || 'Unknown',
      description: payment.description,
      logoUrl: isHttpsUrl(payment.platformLogoUrl)
        ? (payment.platformLogoUrl as string)
        : undefined,
      logoLightUrl: isHttpsUrl(payment.platformLogoLightUrl)
        ? (payment.platformLogoLightUrl as string)
        : undefined,
      verifyUrl: isHttpsUrl(verifyUrl) ? (verifyUrl as string) : undefined,
    };
    dbg('resolveBrantaQr: merchant', result.platform, result.address);
    return result;
  } catch (err) {
    // Swallow errors — missing record / tamper is not shown as a send failure
    dbg('resolveBrantaQr error', err);
    return null;
  }
}
