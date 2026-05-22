/** LAN wallet setup uses trio (3 devices) for keygen only; spend/sign sessions are always duo. */
const LAN_SESSION_HEX64 = /^[0-9a-f]{64}$/i;
const LAN_SEND_BTC_SATOSHIS = /^\d+$/;

/** True when payload looks like `{seed64}:{psbtHash64}:{partyKey}`. */
export function isValidLanPsbtSessionPayload(data: string): boolean {
  const trimmed = data.trim();
  if (!trimmed) {
    return false;
  }
  const parts = trimmed.split(':');
  if (parts.length < 3 || !parts[2]) {
    return false;
  }
  return (
    LAN_SESSION_HEX64.test(parts[0]) && LAN_SESSION_HEX64.test(parts[1])
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

/** Parse master PSBT session payload: `{seed64}:{psbtHash}:{partyKey}`. */
export function parseLanPsbtSessionPayload(data: string): {
  psbtHash: string;
  peerShare: string;
} {
  const parts = data.split(':');
  if (parts.length < 3) {
    throw new Error('Invalid PSBT session payload');
  }
  if (!isValidLanPsbtSessionPayload(data)) {
    throw new Error('Invalid PSBT session payload');
  }
  return {
    psbtHash: parts[1],
    peerShare: parts.slice(2).join(':'),
  };
}

/** True when payload looks like `{seed64}:{amount}:{fees}:{partyKey}`. */
export function isValidLanSendBtcSessionPayload(data: string): boolean {
  const trimmed = data.trim();
  if (!trimmed) {
    return false;
  }
  const parts = trimmed.split(':');
  if (parts.length < 4 || !parts[3]) {
    return false;
  }
  return (
    LAN_SESSION_HEX64.test(parts[0]) &&
    LAN_SEND_BTC_SATOSHIS.test(parts[1]) &&
    LAN_SEND_BTC_SATOSHIS.test(parts[2])
  );
}

/** Parse master send-BTC session payload: `{seed64}:{amount}:{fees}:{partyKey}`. */
export function parseLanSendBtcSessionPayload(data: string): {
  satoshiAmount: string;
  satoshiFees: string;
  peerShare: string;
} {
  if (!isValidLanSendBtcSessionPayload(data)) {
    throw new Error('Invalid send-BTC session payload');
  }
  const parts = data.split(':');
  return {
    satoshiAmount: parts[1],
    satoshiFees: parts[2],
    peerShare: parts.slice(3).join(':'),
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
