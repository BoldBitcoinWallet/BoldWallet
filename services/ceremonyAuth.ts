import {BBMTLibNativeModule} from '../native_modules';
import {dbg} from '../utils';

/**
 * 3b-1 ceremony authorization (F10-bridge). Wraps the native
 * ceremony-token bridge: mint requires an OS-visible prompt
 * (BiometricPrompt / LAContext) executed natively — JS cannot
 * mint, forge, or bypass it. Class binding is enforced natively
 * at each Table-B call (token.opClass == call.opClass); the op
 * passed here only selects which mint to request.
 */
export type CeremonyOpClass =
  | 'sign'
  | 'keygen'
  | 'export'
  | 'import'
  | 'transport'
  | 'config';

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
  const code =
    (error as {code?: unknown} | null)?.code ??
    (error instanceof Error ? undefined : undefined);
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

/**
 * Mint a ceremony token. ALWAYS shows the OS prompt (native);
 * resolves the opaque token string on success. Rejects with
 * CeremonyNoLockError (no screen lock — fail closed, Q3) or
 * CeremonyAuthRequiredError (cancel/failure).
 */
export async function requestCeremonyToken(
  op: CeremonyOpClass,
  sessionID: string,
  title: string,
  detail: string,
): Promise<string> {
  try {
    const token = await BBMTLibNativeModule.requestCeremonyToken(
      op,
      sessionID,
      title,
      detail,
    );
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
    dbg('requestCeremonyToken failed', error);
    throw mapCeremonyError(error);
  }
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
