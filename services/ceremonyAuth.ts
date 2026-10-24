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
  return requestToken('requestSignCeremonyToken', sessionID);
}

/** Mint a KEYGEN token (wallet setup + pairing identity). */
export function requestKeygenCeremonyToken(
  sessionID: string,
): Promise<string> {
  return requestToken('requestKeygenCeremonyToken', sessionID);
}

/** Mint an EXPORT token (backup export). */
export function requestExportCeremonyToken(
  sessionID: string,
): Promise<string> {
  return requestToken('requestExportCeremonyToken', sessionID);
}

/** Mint an IMPORT token (backup import: stage + persist). */
export function requestImportCeremonyToken(
  sessionID: string,
): Promise<string> {
  return requestToken('requestImportCeremonyToken', sessionID);
}

/** Mint a CONFIG token (network settings changes). */
export function requestConfigCeremonyToken(
  sessionID: string,
): Promise<string> {
  return requestToken('requestConfigCeremonyToken', sessionID);
}

/** Retire a token after ceremony success (→ USED). */
export async function completeCeremonyToken(token: string): Promise<void> {
  try {
    await BBMTLibNativeModule.completeCeremonyToken(token);
  } catch (error) {
    dbg('completeCeremonyToken failed (non-fatal)', error);
    throw mapCeremonyError(error);
  }
}

/** Revoke a token on teardown (→ REVOKED). Idempotent. */
export async function releaseCeremonyToken(token: string): Promise<void> {
  try {
    await BBMTLibNativeModule.releaseCeremonyToken(token);
  } catch (error) {
    dbg('releaseCeremonyToken failed (non-fatal)', error);
    throw mapCeremonyError(error);
  }
}
