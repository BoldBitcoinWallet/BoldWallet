import {getKeyshareMetadata} from '../utils';
import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';

export type TssBackend = 'gg18' | 'dkls23';

/** Detect MPC backend from a parsed keyshare object (full JSON or metadata). */
export function detectKeyshareTssBackend(
  parsed: Record<string, unknown> | null | undefined,
): TssBackend {
  if (!parsed || typeof parsed !== 'object') {
    return 'gg18';
  }
  const backend = parsed.tss_backend;
  if (backend === 'dkls23') {
    return 'dkls23';
  }
  if (backend === 'gg18') {
    return 'gg18';
  }
  // DKLs23 export format (libtss handle); GG18 uses ecdsa_local_data inside LocalState.
  if (
    typeof parsed.share_b64 === 'string' &&
    parsed.share_b64.length > 0 &&
    parsed.ecdsa_local_data == null
  ) {
    return 'dkls23';
  }
  if (parsed.ecdsa_local_data != null) {
    return 'gg18';
  }
  return 'gg18';
}

/** True when user explicitly disabled DKLs23 for new wallets (rare opt-out). */
export function isDkls23OptedOut(): boolean {
  return appConfigRepository.getBool(CONFIG_KEYS.DKLS23_OPTED_OUT, false);
}

/**
 * Backend for spend / sign / PSBT — follows the loaded keyshare.
 * Legacy GG18 keyshares without `tss_backend` infer as gg18.
 */
export async function resolveTssBackend(): Promise<TssBackend> {
  const meta = await getKeyshareMetadata();
  if (meta) {
    return detectKeyshareTssBackend(meta as Record<string, unknown>);
  }
  return 'gg18';
}

export type SetupMode = 'duo' | 'trio';

/**
 * Backend for new keygen — DKLs23 by default unless opted out (duo and trio).
 */
export async function resolveTssBackendForKeygen(
  _setupMode?: SetupMode,
): Promise<TssBackend> {
  if (isDkls23OptedOut()) {
    return 'gg18';
  }
  return 'dkls23';
}

/** Human-readable MPC stack label for UI (Devices tab, settings). */
export function getTssBackendDisplayLabel(backend: TssBackend): string {
  if (backend === 'dkls23') {
    return 'DKLs23 (libtss)';
  }
  return 'GG18 (BNB)';
}
