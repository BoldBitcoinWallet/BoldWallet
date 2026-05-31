/** LAN wallet setup uses trio (3 devices) for keygen only; spend/sign sessions are always duo. */
import {isValidMpcAttemptId} from './mpcAttemptId';

const LAN_SESSION_HEX64 = /^[0-9a-f]{64}$/i;
const LAN_SEND_BTC_SATOSHIS = /^\d+$/;

/** Native fetchData resolves transport failures as `error:...` strings. */
export function isNativeFetchErrorPayload(
  raw: string | null | undefined,
): boolean {
  return (
    typeof raw === 'string' && raw.trim().toLowerCase().startsWith('error:')
  );
}

/** True when payload looks like `{attemptId64}:{seed64}` (duo/trio keygen handshake). */
export function isValidLanKeygenSessionPayload(data: string): boolean {
  const trimmed = data.trim();
  if (!trimmed || isNativeFetchErrorPayload(trimmed)) {
    return false;
  }
  const parts = trimmed.split(':');
  if (parts.length < 2) {
    return false;
  }
  return (
    isValidMpcAttemptId(parts[0]) && LAN_SESSION_HEX64.test(parts[1])
  );
}

/** Parse LAN keygen handshake: `{attemptId64}:{seed64}`. Seed is the 32-byte chain code hex. */
export function parseLanKeygenSessionPayload(data: string): {
  attemptId: string;
  seed: string;
} {
  if (!isValidLanKeygenSessionPayload(data)) {
    throw new Error('Invalid LAN keygen session payload');
  }
  const parts = data.trim().split(':');
  return {
    attemptId: parts[0],
    seed: parts[1],
  };
}

/** True when payload looks like `{attemptId64}:{seed64}:{psbtHash64}:{partyKey}`. */
export function isValidLanPsbtSessionPayload(data: string): boolean {
  const trimmed = data.trim();
  if (!trimmed) {
    return false;
  }
  const parts = trimmed.split(':');
  if (parts.length < 4 || !parts[3]) {
    return false;
  }
  return (
    isValidMpcAttemptId(parts[0]) &&
    LAN_SESSION_HEX64.test(parts[1]) &&
    LAN_SESSION_HEX64.test(parts[2])
  );
}

/** Join device: accept only a published PSBT session that matches this device. */
export function lanPsbtSessionPayloadMatchesHash(
  data: string,
  localPsbtHash: string,
): boolean {
  if (!isValidLanPsbtSessionPayload(data)) {
    return false;
  }
  const {psbtHash} = parseLanPsbtSessionPayload(data);
  return psbtHash.toLowerCase() === localPsbtHash.toLowerCase();
}

/** Join device: require exact attempt id for the active co-sign round. */
export function lanPsbtSessionPayloadMatchesAttempt(
  data: string,
  expectedAttemptId: string,
  localPsbtHash: string,
): boolean {
  if (!expectedAttemptId || !isValidMpcAttemptId(expectedAttemptId)) {
    return false;
  }
  if (!lanPsbtSessionPayloadMatchesHash(data, localPsbtHash)) {
    return false;
  }
  const {attemptId} = parseLanPsbtSessionPayload(data);
  return attemptId.toLowerCase() === expectedAttemptId.toLowerCase();
}

/** Parse master PSBT session payload: `{attemptId64}:{seed64}:{psbtHash}:{partyKey}`. */
export function parseLanPsbtSessionPayload(data: string): {
  attemptId: string;
  psbtHash: string;
  peerShare: string;
} {
  const parts = data.split(':');
  if (parts.length < 4) {
    throw new Error('Invalid PSBT session payload');
  }
  if (!isValidLanPsbtSessionPayload(data)) {
    throw new Error('Invalid PSBT session payload');
  }
  return {
    attemptId: parts[0],
    psbtHash: parts[2],
    peerShare: parts.slice(3).join(':'),
  };
}

/** True when payload looks like `{attemptId64}:{seed64}:{amount}:{fees}:{partyKey}`. */
export function isValidLanSendBtcSessionPayload(data: string): boolean {
  const trimmed = data.trim();
  if (!trimmed) {
    return false;
  }
  const parts = trimmed.split(':');
  if (parts.length < 5 || !parts[4]) {
    return false;
  }
  return (
    isValidMpcAttemptId(parts[0]) &&
    LAN_SESSION_HEX64.test(parts[1]) &&
    LAN_SEND_BTC_SATOSHIS.test(parts[2]) &&
    LAN_SEND_BTC_SATOSHIS.test(parts[3])
  );
}

/** Parse master send-BTC session payload: `{attemptId64}:{seed64}:{amount}:{fees}:{partyKey}`. */
export function parseLanSendBtcSessionPayload(data: string): {
  attemptId: string;
  satoshiAmount: string;
  satoshiFees: string;
  peerShare: string;
} {
  if (!isValidLanSendBtcSessionPayload(data)) {
    throw new Error('Invalid send-BTC session payload');
  }
  const parts = data.split(':');
  return {
    attemptId: parts[0],
    satoshiAmount: parts[2],
    satoshiFees: parts[3],
    peerShare: parts.slice(4).join(':'),
  };
}

/** Join device: accept only a published send session matching local amount and fees. */
export function lanSendBtcSessionPayloadMatches(
  data: string,
  localAmount: string,
  localFees: string,
): boolean {
  if (!isValidLanSendBtcSessionPayload(data)) {
    return false;
  }
  const {satoshiAmount, satoshiFees} = parseLanSendBtcSessionPayload(data);
  const amount = localAmount.trim();
  const fees = localFees.trim();
  return satoshiAmount === amount && satoshiFees === fees;
}

/** Join device: require exact attempt id for the active co-sign round. */
export function lanSendBtcSessionPayloadMatchesAttempt(
  data: string,
  expectedAttemptId: string,
  localAmount: string,
  localFees: string,
): boolean {
  if (!expectedAttemptId || !isValidMpcAttemptId(expectedAttemptId)) {
    return false;
  }
  if (!lanSendBtcSessionPayloadMatches(data, localAmount, localFees)) {
    return false;
  }
  const {attemptId} = parseLanSendBtcSessionPayload(data);
  return attemptId.toLowerCase() === expectedAttemptId.toLowerCase();
}
