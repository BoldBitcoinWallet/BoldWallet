/**
 * Validates LAN trio discovery state before DKLS/GG18 keygen starts.
 * Fails fast when roles or peer records are incomplete (common cause of DKG stalls).
 */

const TRIO_PARTY_KEYS = ['KeyShare1', 'KeyShare2', 'KeyShare3'] as const;

export type TrioLanKeygenPreflightInput = {
  peerIP: string | null;
  peerIP2: string | null;
  peerDevice: string | null;
  peerDevice2: string | null;
  localParty: string;
  peerParty: string | null;
  peerParty2: string | null;
  peerPubkey: string | null;
  peerPubkey2: string | null;
};

export function assertTrioLanKeygenReady(
  input: TrioLanKeygenPreflightInput,
): void {
  const missing: string[] = [];
  if (!input.peerIP?.trim()) {
    missing.push('first peer');
  }
  if (!input.peerIP2?.trim()) {
    missing.push('second peer');
  }
  if (!input.peerDevice?.trim()) {
    missing.push('first peer device name');
  }
  if (!input.peerDevice2?.trim()) {
    missing.push('second peer device name');
  }
  if (!input.peerPubkey?.trim()) {
    missing.push('first peer encryption key');
  }
  if (!input.peerPubkey2?.trim()) {
    missing.push('second peer encryption key');
  }

  const local = (input.localParty || '').trim();
  const p1 = (input.peerParty || '').trim();
  const p2 = (input.peerParty2 || '').trim();
  if (!local) {
    missing.push('local party role');
  }
  if (!p1) {
    missing.push('first peer party role');
  }
  if (!p2) {
    missing.push('second peer party role');
  }

  if (missing.length > 0) {
    throw new Error(
      `Trio setup is not ready (${missing.join(', ')}). ` +
        'Keep all three devices on the same Wi‑Fi, wait until every device appears on the pairing screen, then tap Start/Join Setup together.',
    );
  }

  if (!TRIO_PARTY_KEYS.includes(local as (typeof TRIO_PARTY_KEYS)[number])) {
    throw new Error(
      `Invalid local party role "${local}". Re-run pairing on all three devices.`,
    );
  }
  if (!TRIO_PARTY_KEYS.includes(p1 as (typeof TRIO_PARTY_KEYS)[number])) {
    throw new Error(
      `Invalid peer party role "${p1}". Re-run pairing on all three devices.`,
    );
  }
  if (!TRIO_PARTY_KEYS.includes(p2 as (typeof TRIO_PARTY_KEYS)[number])) {
    throw new Error(
      `Invalid peer party role "${p2}". Re-run pairing on all three devices.`,
    );
  }

  const roles = [local, p1, p2];
  const unique = new Set(roles);
  if (unique.size !== 3) {
    throw new Error(
      `Duplicate party roles (${roles.join(', ')}). Re-run pairing on all three devices so each phone gets KeyShare1, KeyShare2, and KeyShare3.`,
    );
  }
}
