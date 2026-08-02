/**
 * Unified Bold extension binding logic (swimlanes.io spec).
 * Used by: Devices tab (KeyshareInfoContent "Bind Extension") and WalletHome (scan auto-detect).
 *
 * Response generation:
 * - payload = pub_key + chain_code (hex, 130 chars = 65 bytes)
 * - hash = sha256(payload + pairing_code), checksum = hash[0:4]
 * - pairing_key = sha256(pairing_code) -> 32 bytes
 * - cipher = payload XOR pairing_key (key repeated to 65 bytes)
 * - response = cipher + checksum (67 bytes), base64
 */
import {BBMTLibNativeModule} from '../native_modules';
import {getReceivePath, resolveUseLegacyDerivationPaths} from '../utils';

const Buffer = (global as any).Buffer;

export type PairingPayloadNetwork = 'mainnet' | 'testnet' | 'testnet4';

export interface PairingPayload {
  version: string;
  network: PairingPayloadNetwork;
  addresses: {
    mainnet?: string;
    testnet?: string;
  };
  pubKeys: {
    mainnet?: string;
    testnet?: string;
  };
  fingerprint: string;
}

type PairingResponseEnvelope = {
  type: 'pairing_response';
  data: PairingPayload & {
    // Compatibility fields consumed by legacy extension pairing handlers.
    publicKey?: string;
    chainCode?: string;
    deviceId?: string;
  };
  timestamp: number;
  id: string;
};

/** Parse pairing_code from extension QR data (e.g. "data: pairing_code=abc" or "pairing_code=abc") */
export function parsePairingCodeFromScannedData(raw: string): string | null {
  const s = raw.trim();
  const prefix = 'pairing_code=';
  const i = s.indexOf(prefix);
  if (i === -1) return null;
  const after = s.slice(i + prefix.length);
  const end = after.indexOf('&');
  const code = end === -1 ? after.trim() : after.slice(0, end).trim();
  return code || null;
}

/** XOR two buffers (key repeated if shorter). */
function xorBytes(data: Buffer, key: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    // eslint-disable-next-line no-bitwise -- required for cipher (payload XOR pairing_key)
    out[i] = data[i] ^ key[i % key.length];
  }
  return out;
}

/**
 * Compute the response QR payload (base64) for Bold extension binding.
 * Pairing code is not shared back; payload is XOR'd with sha256(pairing_code).
 * Extension validates integrity with checksum = sha256(pub_key+chain_code+pairing_code)[0:4].
 */
export async function computeExtensionBindResponseQr(
  pairingCode: string,
  pubKey: string,
  chainCode: string,
): Promise<string> {
  const payloadHex = `${pubKey}${chainCode}`;
  if (payloadHex.length !== 130) {
    throw new Error('pub_key (66 hex) + chain_code (64 hex) must be 130 chars');
  }

  // Integrity checksum (extension validates: sha256(pub_key+chain_code+pairing_code), sig = hash[0:4])
  const integrityHash = await BBMTLibNativeModule.sha256(
    `${pubKey}${chainCode}${pairingCode}`,
  );
  const checksumHex = integrityHash.substring(0, 4);
  const checksumBytes = Buffer.from(checksumHex, 'hex');

  // pairing_key = sha256(pairing_code), cipher = payload XOR pairing_key
  const pairingKeyHex = await BBMTLibNativeModule.sha256(pairingCode);
  const pairingKeyBytes = Buffer.from(pairingKeyHex, 'hex');
  const payloadBytes = Buffer.from(payloadHex, 'hex');
  const cipherBytes = xorBytes(payloadBytes, pairingKeyBytes);

  const response = Buffer.concat([cipherBytes, checksumBytes]);
  return response.toString('base64');
}

function normalizePayloadNetwork(network: string): PairingPayloadNetwork {
  if (network === 'testnet4') return 'testnet4';
  if (network === 'testnet' || network === 'testnet3') return 'testnet';
  return 'mainnet';
}

/**
 * Build standardized pairing payload JSON for Bold extension.
 * Includes active network, network-specific addresses/pubkeys, and fingerprint.
 */
export async function computeExtensionPairingPayloadQr(params: {
  pairingCode: string;
  pubKey: string;
  chainCode: string;
  keyshareMeta?: Record<string, any> | null;
  activeNetwork: string;
}): Promise<string> {
  const {pairingCode, pubKey, chainCode, keyshareMeta, activeNetwork} = params;

  if (!pubKey || !chainCode) {
    throw new Error('pubKey and chainCode are required for pairing payload');
  }

  const useLegacyPath = resolveUseLegacyDerivationPaths(keyshareMeta || null);
  const deriveNet = async (net: 'mainnet' | 'testnet3') => {
    const path = getReceivePath(net, 'segwit-native', useLegacyPath, 0);
    const derivedPub = await BBMTLibNativeModule.derivePubkey(pubKey, chainCode, path);
    const addr = await BBMTLibNativeModule.btcAddress(
      derivedPub,
      net,
      'segwit-native',
    );
    return {address: addr, pub: derivedPub};
  };

  const [mainnet, testnet] = await Promise.all([
    deriveNet('mainnet'),
    deriveNet('testnet3'),
  ]);

  const payloadNetwork = normalizePayloadNetwork(activeNetwork);
  const normalizedActive = payloadNetwork === 'mainnet' ? 'mainnet' : 'testnet';
  const activePub = normalizedActive === 'mainnet' ? mainnet.pub : testnet.pub;

  const fingerprintHash = await BBMTLibNativeModule.sha256(pubKey);
  const fingerprint = (fingerprintHash || '').substring(0, 8).toLowerCase();

  const payload: PairingResponseEnvelope = {
    type: 'pairing_response',
    data: {
      version: '1.0',
      network: payloadNetwork,
      addresses: {
        mainnet: mainnet.address,
        testnet: testnet.address,
      },
      pubKeys: {
        mainnet: mainnet.pub,
        testnet: testnet.pub,
      },
      fingerprint,
      publicKey: activePub,
      chainCode,
      deviceId: 'mobile-wallet',
    },
    timestamp: Date.now(),
    id: `pairing-${pairingCode}-${Date.now()}`,
  };

  return JSON.stringify(payload);
}

export type ParseExtensionResponseResult = {
  pubKey: string;
  chainCode: string;
  valid: boolean;
};

/**
 * Extension-side: decipher response QR, extract pub_key/chain_code, validate checksum.
 * Use this in the Bold extension (or tests) with your sha256 (e.g. Web Crypto / Node crypto).
 * If sha256Fn is omitted, uses BBMTLibNativeModule.sha256 (React Native app only).
 *
 * Steps (swimlanes.io):
 * - cipher = response[0:65], checksum = response[65:67]
 * - pairing_key = sha256(pairing_code)
 * - payload = cipher XOR pairing_key
 * - pub_key = payload_hex[0:66], chain_code = payload_hex[66:130]
 * - valid = (sha256(pub_key+chain_code+pairing_code)[0:4] === checksum)
 */
export async function parseExtensionResponse(
  responseBase64: string,
  pairingCode: string,
  sha256Fn?: (data: string) => Promise<string>,
): Promise<ParseExtensionResponseResult> {
  const sha256Async =
    sha256Fn ?? ((data: string) => BBMTLibNativeModule.sha256(data) as Promise<string>);

  const responseBytes = Buffer.from(responseBase64, 'base64');
  if (responseBytes.length !== 67) {
    throw new Error(`Invalid response length: expected 67 bytes, got ${responseBytes.length}`);
  }
  const cipherBytes = responseBytes.subarray(0, 65);
  const checksumBytes = responseBytes.subarray(65, 67);

  const pairingKeyHex = await sha256Async(pairingCode);
  const pairingKeyBytes = Buffer.from(pairingKeyHex, 'hex');
  const payloadBytes = xorBytes(cipherBytes, pairingKeyBytes);
  const payloadHex = payloadBytes.toString('hex');
  if (payloadHex.length !== 130) {
    throw new Error(`Invalid payload hex length: expected 130, got ${payloadHex.length}`);
  }
  const pubKey = payloadHex.slice(0, 66);
  const chainCode = payloadHex.slice(66, 130);

  const integrityHash = await sha256Async(`${pubKey}${chainCode}${pairingCode}`);
  const expectedChecksumHex = integrityHash.slice(0, 4);
  const expectedChecksumBytes = Buffer.from(expectedChecksumHex, 'hex');
  const valid =
    expectedChecksumBytes.length === checksumBytes.length &&
    expectedChecksumBytes.equals(checksumBytes);

  return { pubKey, chainCode, valid };
}
