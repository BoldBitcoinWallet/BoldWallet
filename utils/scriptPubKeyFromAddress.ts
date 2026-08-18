import {Buffer} from 'buffer';
import {sha256} from '@noble/hashes/sha256';

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;
const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function polymod(values: number[]): number {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= gen[i];
      }
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >> 5);
  }
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31);
  }
  return ret;
}

function convertBits(
  data: number[],
  from: number,
  to: number,
  pad: boolean,
): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from) {
      return null;
    }
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) {
      ret.push((acc << (to - bits)) & maxv);
    }
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    return null;
  }
  return ret;
}

function decodeBech32(
  address: string,
): {version: number; program: Buffer} | null {
  const lower = address.toLowerCase();
  if (lower !== address && address.toUpperCase() !== address) {
    return null;
  }
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length || lower.length > 90) {
    return null;
  }
  const hrp = lower.slice(0, pos);
  if (hrp !== 'bc' && hrp !== 'tb' && hrp !== 'bcrt') {
    return null;
  }
  const data: number[] = [];
  for (let i = pos + 1; i < lower.length; i++) {
    const v = BECH32_CHARSET.indexOf(lower[i]!);
    if (v === -1) {
      return null;
    }
    data.push(v);
  }
  const values = hrpExpand(hrp).concat(data);
  const checksum = polymod(values);
  if (checksum !== 1 && checksum !== BECH32M_CONST) {
    return null;
  }
  const version = data[0];
  if (version === undefined || version > 16) {
    return null;
  }
  if (version === 0 && checksum !== 1) {
    return null;
  }
  if (version !== 0 && checksum !== BECH32M_CONST) {
    return null;
  }
  const converted = convertBits(data.slice(1, -6), 5, 8, false);
  if (!converted || converted.length < 2 || converted.length > 40) {
    return null;
  }
  if (version === 0 && converted.length !== 20 && converted.length !== 32) {
    return null;
  }
  return {version, program: Buffer.from(converted)};
}

function decodeBase58Check(address: string): Buffer | null {
  let num = BigInt(0);
  for (const ch of address) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) {
      return null;
    }
    num = num * 58n + BigInt(idx);
  }
  const hex = num.toString(16).padStart(50, '0');
  const raw = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
  let leadingZeros = 0;
  for (const ch of address) {
    if (ch !== '1') {
      break;
    }
    leadingZeros += 1;
  }
  const payload = Buffer.concat([Buffer.alloc(leadingZeros), raw]).slice(-25);
  if (payload.length !== 25) {
    return null;
  }
  const body = payload.subarray(0, 21);
  const checksum = payload.subarray(21);
  const hash = sha256(sha256(body));
  if (!checksum.equals(Buffer.from(hash.subarray(0, 4)))) {
    return null;
  }
  return body;
}

/**
 * Derive the locking script hex from a Bitcoin address (no network).
 * Used so compact send-QR UTXOs can skip per-txid HTTP before MPC join.
 */
export function scriptPubKeyFromAddress(address: string): string | null {
  const trimmed = address?.trim();
  if (!trimmed) {
    return null;
  }
  const bech32 = decodeBech32(trimmed);
  if (bech32) {
    const {version, program} = bech32;
    const push = Buffer.concat([
      Buffer.from([version === 0 ? 0x00 : 0x50 + version, program.length]),
      program,
    ]);
    return push.toString('hex');
  }
  const base58 = decodeBase58Check(trimmed);
  if (base58) {
    const version = base58[0];
    const hash = base58.subarray(1);
    if (version === 0x00 || version === 0x6f) {
      return Buffer.concat([
        Buffer.from([0x76, 0xa9, 0x14]),
        hash,
        Buffer.from([0x88, 0xac]),
      ]).toString('hex');
    }
    if (version === 0x05 || version === 0xc4) {
      return Buffer.concat([
        Buffer.from([0xa9, 0x14]),
        hash,
        Buffer.from([0x87]),
      ]).toString('hex');
    }
  }
  return null;
}
