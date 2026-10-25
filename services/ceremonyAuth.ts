import {BBMTLibNativeModule} from '../native_modules';
import {dbg} from '../utils';

/**
 * 3b-1 ceremony authorization (F10-bridge). Per-ceremony mint
 * functions ONLY — there is deliberately NO generic
 * "request token for class X" wrapper, mirroring the native
 * bridge (each native entry hardcodes its op class and prompt
 * copy). Mint requires an OS-visible prompt executed natively;
 * JS cannot mint, forge, or bypass it. Class binding is
 * enforced natively at each Table-B call.
 */
export type CeremonyOpClass = 'sign' | 'keygen' | 'export' | 'import' | 'config';

export class CeremonyAuthRequiredError extends Error {
  constructor(message?: string) {
    super(message ?? 'Confirm to continue — authenticate in the prompt.');
    this.name = 'CeremonyAuthRequiredError';
  }
}

export class CeremonyNoLockError extends Error {
  constructor() {
    super('Set a device screen lock to continue.');
    this.name = 'CeremonyNoLockError';
  }
}

/**
 * Live ceremony tokens by sessionID. Populated at every mint
 * (wrapper- or owner-initiated), evicted on complete/release.
 * Lets cancel paths retrieve the ceremony token without the
 * screens threading it through every abort branch. Same-context
 * JS can read this map — disclosed piggyback residual (§6.4):
 * it grants nothing beyond calling the bridge directly.
 */
const sessionTokens = new Map<string, {token: string; op: CeremonyOpClass}>();

export function registerSessionToken(
  sessionID: string,
  op: CeremonyOpClass,
  token: string,
): void {
  sessionTokens.set(sessionID, {token, op});
}

export function getSessionToken(
  sessionID: string,
): {token: string; op: CeremonyOpClass} | undefined {
  return sessionTokens.get(sessionID);
}

/**
 * 3b-4 B19: first live (sign|keygen) ceremony for session-less
 * cancels (nostr). Single-live-session keeps ≤1 non-terminal
 * entry; a stale entry fails natively and the cancel path
 * falls back to a fresh mint (B19 stuck-cancel).
 */
export function findLiveCeremonyToken():
  | {sessionID: string; token: string; op: CeremonyOpClass}
  | undefined {
  for (const [sessionID, entry] of sessionTokens) {
    if (entry.op === 'sign' || entry.op === 'keygen') {
      return {sessionID, token: entry.token, op: entry.op};
    }
  }
  return undefined;
}

function evictSessionTokenByValue(token: string): void {
  for (const [sessionID, entry] of sessionTokens) {
    if (entry.token === token) {
      sessionTokens.delete(sessionID);
    }
  }
}

/**
 * Fresh ceremony session ID. Uniqueness (not secrecy) is the
 * requirement — the token is the secret; LAN precedent derives
 * session IDs from public data the same way.
 */
export async function newCeremonySessionID(purpose: string): Promise<string> {
  return BBMTLibNativeModule.sha256(
    `ceremony/${purpose}/${Date.now()}/${Math.random()}`,
  );
}

/** True when a native call was rejected for missing/invalid ceremony auth. */
export function isCeremonyAuthRejection(error: unknown): boolean {
  return (
    (error as {code?: unknown} | null)?.code === 'CEREMONY_AUTH_REQUIRED'
  );
}

function mapCeremonyError(error: unknown): Error {
  const code = (error as {code?: unknown} | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (code === 'CEREMONY_AUTH_NO_LOCK' || /screen lock/i.test(message)) {
    return new CeremonyNoLockError();
  }
  if (
    code === 'CEREMONY_AUTH_REQUIRED' ||
    /authenticate in the prompt/i.test(message)
  ) {
    return new CeremonyAuthRequiredError(message || undefined);
  }
  return error instanceof Error ? error : new Error(message);
}

async function requestToken(
  method: string,
  op: CeremonyOpClass,
  sessionID: string,
): Promise<string> {
  try {
    const fn = BBMTLibNativeModule[method] as
      | ((sessionID: string) => Promise<unknown>)
      | undefined;
    if (typeof fn !== 'function') {
      throw new CeremonyAuthRequiredError();
    }
    const token = await fn(sessionID);
    if (!token || typeof token !== 'string') {
      throw new CeremonyAuthRequiredError();
    }
    registerSessionToken(sessionID, op, token);
    return token;
  } catch (error) {
    if (
      error instanceof CeremonyNoLockError ||
      error instanceof CeremonyAuthRequiredError
    ) {
      throw error;
    }
    dbg(`${method} failed`, error);
    throw mapCeremonyError(error);
  }
}

/**
 * Mint a SIGN token. ALWAYS shows the OS prompt (native, fixed
 * copy "Authenticate to sign"); resolves the opaque token on
 * success. Rejects CeremonyNoLockError (Q3 fail-closed) or
 * CeremonyAuthRequiredError (cancel/failure).
 */
export function requestSignCeremonyToken(sessionID: string): Promise<string> {
  return requestToken('requestSignCeremonyToken', 'sign', sessionID);
}

/**
 * F20: mint a SIGN token bound to one PSBT artifact. Native
 * parses the PSBT (Go), shows the outputs/fee/network on a
 * native confirmation sheet, and mints only after Confirm +
 * OS auth. The token carries the confirmed artifact digest;
 * native keysign rejects any different PSBT. Cancel/decline
 * rejects CeremonyAuthRequiredError (nothing minted);
 * unparsable PSBT rejects with the native CEREMONY_PSBT_INVALID
 * message.
 */
export async function requestPsbtSignCeremonyToken(
  sessionID: string,
  psbtBase64: string,
): Promise<string> {
  try {
    const fn = BBMTLibNativeModule.requestPsbtSignCeremonyToken as
      | ((sessionID: string, psbtBase64: string) => Promise<unknown>)
      | undefined;
    if (typeof fn !== 'function') {
      throw new CeremonyAuthRequiredError();
    }
    const token = await fn(sessionID, psbtBase64);
    if (!token || typeof token !== 'string') {
      throw new CeremonyAuthRequiredError();
    }
    registerSessionToken(sessionID, 'sign', token);
    return token;
  } catch (error) {
    if (
      error instanceof CeremonyNoLockError ||
      error instanceof CeremonyAuthRequiredError
    ) {
      throw error;
    }
    dbg('requestPsbtSignCeremonyToken failed', error);
    throw mapCeremonyError(error);
  }
}

/**
 * F20 Phase 1b: mint a SIGN token bound to one send payment.
 * Native shows the payment on a native sheet and mints only
 * after Confirm + OS auth; the token binds the canonical
 * payment string and native send keysign rejects any different
 * address/amount/fee/change. This is the ONLY minter the send
 * wrappers use.
 */
export async function requestSendSignCeremonyToken(
  sessionID: string,
  payment: {
    toAddress: string;
    amountSatoshi: string;
    feeSatoshi: string;
    changeAddress: string;
  },
): Promise<string> {
  try {
    const fn = BBMTLibNativeModule.requestSendSignCeremonyToken as
      | ((
          sessionID: string,
          toAddress: string,
          amountSatoshi: string,
          feeSatoshi: string,
          changeAddress: string,
        ) => Promise<unknown>)
      | undefined;
    if (typeof fn !== 'function') {
      throw new CeremonyAuthRequiredError();
    }
    const token = await fn(
      sessionID,
      payment.toAddress,
      payment.amountSatoshi,
      payment.feeSatoshi,
      payment.changeAddress,
    );
    if (!token || typeof token !== 'string') {
      throw new CeremonyAuthRequiredError();
    }
    registerSessionToken(sessionID, 'sign', token);
    return token;
  } catch (error) {
    if (
      error instanceof CeremonyNoLockError ||
      error instanceof CeremonyAuthRequiredError
    ) {
      throw error;
    }
    dbg('requestSendSignCeremonyToken failed', error);
    throw mapCeremonyError(error);
  }
}

/** Mint a KEYGEN token (wallet setup + pairing identity). */
export function requestKeygenCeremonyToken(
  sessionID: string,
): Promise<string> {
  return requestToken('requestKeygenCeremonyToken', 'keygen', sessionID);
}

/** Mint an EXPORT token (backup export). */
export function requestExportCeremonyToken(
  sessionID: string,
): Promise<string> {
  return requestToken('requestExportCeremonyToken', 'export', sessionID);
}

/** Mint an IMPORT token (backup import: stage + persist). */
export function requestImportCeremonyToken(
  sessionID: string,
): Promise<string> {
  return requestToken('requestImportCeremonyToken', 'import', sessionID);
}

/** Mint a CONFIG token (network settings changes). */
export function requestConfigCeremonyToken(
  sessionID: string,
): Promise<string> {
  return requestToken('requestConfigCeremonyToken', 'config', sessionID);
}

/** Retire a token after ceremony success (→ USED). */
export async function completeCeremonyToken(token: string): Promise<void> {
  try {
    await BBMTLibNativeModule.completeCeremonyToken(token);
  } catch (error) {
    dbg('completeCeremonyToken failed (non-fatal)', error);
    throw mapCeremonyError(error);
  } finally {
    evictSessionTokenByValue(token);
  }
}

/** Revoke a token on teardown (→ REVOKED). Idempotent. */
export async function releaseCeremonyToken(token: string): Promise<void> {
  try {
    await BBMTLibNativeModule.releaseCeremonyToken(token);
  } catch (error) {
    dbg('releaseCeremonyToken failed (non-fatal)', error);
    throw mapCeremonyError(error);
  } finally {
    evictSessionTokenByValue(token);
  }
}
