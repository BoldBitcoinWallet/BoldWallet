import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';
import {getKeygenTssBackendPreference} from './tssConfig';

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
  // GG18 LocalState has ecdsa_local_data; DKLs23 has share_b64 — prefer GG18 when both cues exist.
  if (parsed.ecdsa_local_data != null) {
    return 'gg18';
  }
  if (typeof parsed.share_b64 === 'string' && parsed.share_b64.length > 0) {
    return 'dkls23';
  }
  return 'gg18';
}

/**
 * Backend for spend / sign / PSBT — follows the loaded keyshare.
 * Legacy GG18 keyshares without `tss_backend` infer as gg18.
 */
export async function resolveTssBackend(): Promise<TssBackend> {
  // Lazy require avoids circular init with utils.js (which re-exports detectKeyshareTssBackend).
  const {getKeyshareMetadata} = require('../utils') as typeof import('../utils');
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
  return getKeygenTssBackendPreference();
}

/** Sync read of cached keyshare_meta for hook routing before async metadata load. */
export function resolveTssBackendFromCachedMeta(): TssBackend | null {
  try {
    const raw = appConfigRepository.get(CONFIG_KEYS.KEYSHARE_META_JSON);
    if (!raw || String(raw).trim() === '') {
      return null;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return detectKeyshareTssBackend(parsed);
  } catch {
    return null;
  }
}

/** Backend for MPC hook progress bars (keygen vs spend flows). */
export function resolveHookProgressBackend(opts: {
  isSpendFlow: boolean;
  spendBackend: TssBackend | null;
  keygenBackend: TssBackend | null;
}): TssBackend | null {
  if (opts.isSpendFlow) {
    return opts.spendBackend ?? resolveTssBackendFromCachedMeta();
  }
  return opts.keygenBackend ?? getKeygenTssBackendPreference();
}

export {isDkls23OptedOut} from './tssConfig';

/** Human-readable MPC stack label for UI (Devices tab, settings). */
export function getTssBackendDisplayLabel(backend: TssBackend): string {
  if (backend === 'dkls23') {
    return 'DKLs23 (libtss)';
  }
  return 'GG18 (BNB)';
}
