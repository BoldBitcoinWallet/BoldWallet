/**
 * LAN MPC wire encryption — same rules as GG18 (BBMTLib/tss MessengerImp):
 * - Duo: ECIES with peer public key + local private key
 * - Trio: AES with a ceremony session key from the SAS-authenticated ECDH
 *   exchange (F32, Option A). The old sha256(sessionID + masterHost)
 *   derivation is retired — Go fails it closed (TRIO_LEGACY_KEY_REFUSED).
 */
import {BBMTLibNativeModule} from '../native_modules';
import {confirmAppPrompt} from './appPrompt';
import {dbg} from '../utils';
export type EciesKeypair = {publicKey: string; privateKey: string};

export type LanMpcTransportKeys = {
  sessionKey: string;
  encKey: string;
  decKey: string;
};

export function parseEciesKeypairJson(jkp: string): EciesKeypair {
  if (typeof jkp !== 'string' || jkp.startsWith('error:')) {
    throw new Error(
      jkp?.startsWith('error:')
        ? jkp.slice('error:'.length)
        : 'Invalid device keypair',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jkp);
  } catch {
    throw new Error('Invalid encryption key response from native module');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as EciesKeypair).publicKey !== 'string' ||
    typeof (parsed as EciesKeypair).privateKey !== 'string'
  ) {
    throw new Error('Could not parse device encryption keys');
  }
  const kp = parsed as EciesKeypair;
  if (!kp.publicKey.trim() || !kp.privateKey.trim()) {
    throw new Error('Device encryption keys are incomplete');
  }
  return {
    publicKey: kp.publicKey.trim(),
    privateKey: kp.privateKey.trim(),
  };
}

export type TrioECDHBeginResult = {
  handle: string;
  /** 6-digit compare code, identical on all honest devices. */
  sas: string;
};

export type TrioECDHBridge = {
  trioECDHPhase1: (
    server: string,
    session: string,
    selfParty: string,
    parties: string,
  ) => Promise<string>;
  trioECDHConfirm: (handle: string, session: string) => Promise<string>;
  trioECDHAbort: (handle: string) => Promise<string>;
};

/**
 * F32 step 1: run the ECDH exchange (both relay rounds) and return the
 * SAS compare code. The caller shows `sas` on this device's pairing
 * screen; the ceremony proceeds only after the user confirms the codes
 * match on every device, via confirmTrioECDHTransport below.
 * TRIO_PEER_OUTDATED (outdated peer app) maps to a user-facing error —
 * fail closed, no legacy fallback.
 */
export async function beginTrioECDHTransport(opts: {
  server: string;
  sessionID: string;
  partyID: string;
  partiesCSV: string;
  bridge?: TrioECDHBridge;
}): Promise<TrioECDHBeginResult> {
  const bridge = opts.bridge ?? (BBMTLibNativeModule as TrioECDHBridge);
  let raw: string;
  try {
    raw = await bridge.trioECDHPhase1(
      opts.server,
      opts.sessionID,
      opts.partyID,
      opts.partiesCSV,
    );
  } catch (error: any) {
    throw mapTrioECDHError(error);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Trio pairing exchange returned an unreadable reply');
  }
  const obj = parsed as {handle?: unknown; sas?: unknown};
  if (
    !obj ||
    typeof obj.handle !== 'string' ||
    !obj.handle ||
    typeof obj.sas !== 'string' ||
    !/^\d{6}$/.test(obj.sas)
  ) {
    throw new Error('Trio pairing exchange returned an invalid reply');
  }
  return {handle: obj.handle, sas: obj.sas};
}

/**
 * F32 step 2: after the user confirms matching SAS codes, derive the
 * ceremony session key (64-hex, drop-in for the retired derivation).
 */
export async function confirmTrioECDHTransport(
  handle: string,
  sessionID: string,
  bridge?: TrioECDHBridge,
): Promise<string> {
  const mod = bridge ?? (BBMTLibNativeModule as TrioECDHBridge);
  let sessionKey: string;
  try {
    sessionKey = (await mod.trioECDHConfirm(handle, sessionID)).trim();
  } catch (error: any) {
    throw mapTrioECDHError(error);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(sessionKey)) {
    throw new Error('Trio pairing exchange returned an invalid session key');
  }
  return sessionKey.toLowerCase();
}

/** F32: wipe a phase-1 handle (SAS mismatch / user cancel). Best-effort. */
export async function abortTrioECDHTransport(
  handle: string,
  bridge?: TrioECDHBridge,
): Promise<void> {
  const mod = bridge ?? (BBMTLibNativeModule as TrioECDHBridge);
  try {
    await mod.trioECDHAbort(handle);
  } catch (error) {
    dbg('abortTrioECDHTransport: ignored', error);
  }
}

function mapTrioECDHError(error: any): Error {
  const msg = error?.message ?? String(error);
  if (msg.includes('TRIO_PEER_OUTDATED')) {
    return new Error(
      'A paired device runs an outdated app version — update the app on all devices and pair again. Pairing cannot fall back to the old encryption.',
    );
  }
  return new Error(`Trio pairing exchange failed: ${msg}`);
}

/**
 * F32 SAS compare dialog. Shown on every device with that device's SAS
 * (identical across honest devices); Continue only when the user sees
 * the same code everywhere. Returns true on explicit Continue.
 */
export function confirmTrioSasWithUser(sas: string): Promise<boolean> {
  return confirmAppPrompt({
    icon: 'security',
    title: 'Match the codes',
    code: sas,
    hint: 'Every phone should show this same code.',
    cancelLabel: 'They differ',
    confirmLabel: 'They match',
  });
}

export async function resolveLanKeygenTransportKeys(opts: {
  isTrio: boolean;
  keypairJson: string;
  peerPubkey: string;
  sessionID: string;
  masterHost: string;
  sha256: (message: string) => Promise<string>;
}): Promise<LanMpcTransportKeys> {
  const kp = parseEciesKeypairJson(opts.keypairJson);
  if (opts.isTrio) {
    // F32: the public derivation is retired (Go fails it closed).
    // Trio callers run beginTrioECDHTransport + user SAS compare +
    // confirmTrioECDHTransport instead.
    throw new Error(
      'trio LAN now uses the ECDH exchange; public derivation retired (F32)',
    );
  }
  const encKey = opts.peerPubkey.trim();
  const decKey = kp.privateKey;
  if (!encKey || !decKey) {
    throw new Error(
      'LAN pairing keys missing — complete device pairing (both devices must show matching security codes), then start wallet setup again.',
    );
  }
  return {sessionKey: '', encKey, decKey};
}

/** Duo spend/sign paths (same ECIES material as GG18 duo keygen). */
export function resolveLanKeysignTransportKeys(opts: {
  keypairJson: string;
  peerPubkey: string;
}): LanMpcTransportKeys {
  const kp = parseEciesKeypairJson(opts.keypairJson);
  const encKey = opts.peerPubkey.trim();
  const decKey = kp.privateKey;
  if (!encKey || !decKey) {
    throw new Error(
      'LAN pairing keys missing — pair devices again before co-signing.',
    );
  }
  return {sessionKey: '', encKey, decKey};
}
