/**
 * LAN MPC setup orchestration shared by GG18 and DKLS keygen.
 * Single source of truth for host normalization, trio role assignment,
 * master relay URL, and pre-join reachability checks.
 */

import appConfigRepository from './repositories/AppConfigRepository';
import {getCommitteeKeyshareLabel, getKeyshareLabel} from '../utils';

export const TRIO_PARTIES_CSV = 'KeyShare1,KeyShare2,KeyShare3';

export function lastIPv4Octet(host: string): number {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return 0;
  }
  const n = Number(parts[3]);
  return Number.isFinite(n) ? n : 0;
}

/** Strip scheme/port; map 0.0.0.0 to null (invalid as client target). */
export function normalizeLanHost(raw: string | null | undefined): string | null {
  if (raw == null) {
    return null;
  }
  let s = String(raw).trim();
  if (!s) {
    return null;
  }
  s = s.replace(/^https?:\/\//i, '');
  const slash = s.indexOf('/');
  if (slash >= 0) {
    s = s.slice(0, slash);
  }
  const host = (s.split(':')[0] || '').trim();
  if (!host || host === '0.0.0.0') {
    return null;
  }
  return host;
}

export type TrioLanRoleAssignment = {
  localParty: string;
  peerParty: string;
  peerParty2: string;
  isMaster: boolean;
  /** IP of the device holding KeyShare1 (runs the HTTP relay). */
  masterHost: string;
  ipByRole: Record<string, string>;
};

/**
 * Deterministic trio roles: highest IPv4 last-octet → KeyShare1 (master relay).
 * Same algorithm on every device so all three agree on roles and master host.
 */
export function resolveTrioLanRoles(input: {
  localIP: string;
  peerIP: string;
  peerIP2: string;
}): TrioLanRoleAssignment {
  const local = normalizeLanHost(input.localIP);
  const peer1 = normalizeLanHost(input.peerIP);
  const peer2 = normalizeLanHost(input.peerIP2);
  if (!local || !peer1 || !peer2) {
    throw new Error(
      'Trio LAN setup needs three valid device IPs. Re-run pairing on the same Wi‑Fi.',
    );
  }

  const entries = [
    {label: 'local' as const, ip: local, octet: lastIPv4Octet(local)},
    {label: 'peer1' as const, ip: peer1, octet: lastIPv4Octet(peer1)},
    {label: 'peer2' as const, ip: peer2, octet: lastIPv4Octet(peer2)},
  ].sort((a, b) => b.octet - a.octet);

  const rankToParty = ['KeyShare1', 'KeyShare2', 'KeyShare3'] as const;
  const labelToParty: Record<string, string> = {};
  const ipByRole: Record<string, string> = {};
  entries.forEach((entry, idx) => {
    const party = rankToParty[idx];
    labelToParty[entry.label] = party;
    ipByRole[party] = entry.ip;
  });

  return {
    localParty: labelToParty.local,
    peerParty: labelToParty.peer1,
    peerParty2: labelToParty.peer2,
    isMaster: labelToParty.local === 'KeyShare1',
    masterHost: ipByRole.KeyShare1,
    ipByRole,
  };
}

export type DuoLanRoleAssignment = {
  isMaster: boolean;
  masterHost: string;
  localParty: string;
  peerParty: string;
};

export function resolveDuoLanRoles(
  localIP: string,
  peerIP: string,
): DuoLanRoleAssignment {
  const local = normalizeLanHost(localIP);
  const peer = normalizeLanHost(peerIP);
  if (!local || !peer) {
    throw new Error(
      'Duo LAN setup needs two valid device IPs. Re-run pairing on the same Wi‑Fi.',
    );
  }
  const isMaster = lastIPv4Octet(local) > lastIPv4Octet(peer);
  return {
    isMaster,
    masterHost: isMaster ? local : peer,
    localParty: isMaster ? 'KeyShare1' : 'KeyShare2',
    peerParty: isMaster ? 'KeyShare2' : 'KeyShare1',
  };
}

export function buildLanRelayServerUrl(
  host: string,
  port: number | string,
): string {
  const h = normalizeLanHost(host);
  if (!h) {
    throw new Error('Invalid LAN relay host');
  }
  return `http://${h}:${port}`;
}

/** True when stored keyshare metadata represents a 2-of-3 (trio) wallet. */
export function isTrioWalletKeyshare(
  meta: {keygen_committee_keys?: string[] | null} | null | undefined,
): boolean {
  const committee = meta?.keygen_committee_keys;
  return Array.isArray(committee) && committee.length >= 3;
}

/**
 * LAN keysign party ids for native MPC (KeyShareN monikers).
 * DKLs maps these to libtss ids via share.Identifier(); do not pass npubs here.
 *
 * Spend/sign always uses exactly two signers:
 * - Duo wallet (2-of-2): local + peer
 * - Trio wallet (2-of-3 DKG): local + one co-signer only — never all three KeyShares
 *
 * Keygen is different: trio LAN keygen uses all three (`TRIO_PARTIES_CSV`).
 */
export function resolveLanSigningParties(input: {
  localParty: string;
  /** The other device co-signing this spend (duo peer, or selected trio peer). */
  peerParty: string;
  /** Third role from LAN pairing; not included in keysign CSV. */
  peerParty2?: string;
}): {partyID: string; partiesCSV: string} {
  const localParty = input.localParty.trim();
  if (!localParty) {
    throw new Error(
      'LAN party role is missing on this device. Re-run device pairing on the same Wi‑Fi, then retry co-signing.',
    );
  }
  const peerParty = input.peerParty.trim();
  if (!peerParty) {
    throw new Error(
      'LAN peer role is missing. Re-run device pairing on the same Wi‑Fi, then retry co-signing.',
    );
  }
  if (localParty === peerParty) {
    throw new Error('Please use two different key shares on each device.');
  }
  void input.peerParty2;
  const parties = [localParty, peerParty].sort();
  return {partyID: localParty, partiesCSV: parties.join(',')};
}

/**
 * DKLS LAN spend: party ids must match libtss ids from keygen committee order,
 * not Wi‑Fi IP ranking (KeyShare1/2/3). Use npubs from discovery + keyshare metadata.
 */
export function resolveDklsLanSigningPartiesFromKeyshare(
  meta: {
    local_party_key?: string;
    keygen_committee_keys?: string[] | null;
  } | null,
  peerCommitteeKey: string,
): {partyID: string; partiesCSV: string} {
  const localLabel = getKeyshareLabel(meta);
  if (!localLabel) {
    throw new Error(
      'Could not map this device to a KeyShare role from your wallet committee. Re-import the keyshare or use Nostr co-signing.',
    );
  }
  const peerKey = peerCommitteeKey.trim();
  if (!peerKey) {
    throw new Error(
      'Peer identity missing from LAN pairing. Re-run device pairing, then retry co-signing.',
    );
  }
  const peerLabel = getCommitteeKeyshareLabel(meta, peerKey);
  if (!peerLabel) {
    throw new Error(
      'Could not map the paired device to your wallet committee. Ensure both devices use the same trio wallet, then re-pair on LAN.',
    );
  }
  return resolveLanSigningParties({
    localParty: localLabel,
    peerParty: peerLabel,
  });
}

export function resolveLanKeygenParties(opts: {
  isTrio: boolean;
  isMaster: boolean;
  localParty: string;
}): {partyID: string; partiesCSV: string} {
  if (opts.isTrio) {
    const partyID = opts.localParty?.trim() || '';
    if (!partyID) {
      throw new Error(
        'Trio party role is missing on this device. Re-run pairing on all three phones, then tap Start/Join Setup together.',
      );
    }
    return {partyID, partiesCSV: TRIO_PARTIES_CSV};
  }
  const partyID = opts.isMaster ? 'KeyShare1' : 'KeyShare2';
  const peerID = partyID === 'KeyShare1' ? 'KeyShare2' : 'KeyShare1';
  return {partyID, partiesCSV: `${partyID},${peerID}`};
}

/** True when GET hits the MPC relay (session missing), not the publish handshake server (401). */
export function isLanMpcRelayProbeResponse(status: number): boolean {
  return status === 404;
}

/**
 * Probe that the master's MPC relay (not the publish handshake server) is listening.
 */
export async function probeLanRelayReachable(
  serverUrl: string,
  opts?: {retries?: number; intervalMs?: number},
): Promise<void> {
  const retries = opts?.retries ?? 12;
  const intervalMs = opts?.intervalMs ?? 400;
  const base = serverUrl.replace(/\/$/, '');
  const probeUrl = `${base}/bbmt-mpc-relay-probe`;
  let lastErr = 'unknown';

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(probeUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (isLanMpcRelayProbeResponse(res.status)) {
        return;
      }
      if (res.status === 401) {
        lastErr =
          'session publish server still active (wait for KeyShare1 to finish setup handshake)';
      } else {
        lastErr = `HTTP ${res.status}`;
      }
    } catch (e: unknown) {
      const err = e as {message?: string};
      lastErr = err?.message || String(e);
    }
    if (attempt < retries - 1) {
      await new Promise<void>(r => setTimeout(r, intervalMs));
    }
  }

  throw new Error(
    `Master LAN relay unreachable at ${base} (${lastErr}). ` +
      'KeyShare1 must tap Start Setup first; keep all three devices on the same Wi‑Fi, then retry.',
  );
}

export type PersistedLanRoles = {
  localParty: string;
  peerParty: string;
  peerParty2: string;
  masterHost: string | null;
  isMaster: boolean;
  isTrio: boolean;
};

const LAN_ROLE_KEYS = [
  'lan_local_party',
  'lan_peer_party',
  'lan_peer_party2',
  'lan_master_host',
  'lan_is_master',
  'lan_is_trio',
] as const;

/** Persist trio/duo role assignment after LAN pairing (survives navigation / re-entry). */
export function persistLanPairingRoles(roles: PersistedLanRoles): void {
  const entries: Record<string, string> = {
    lan_local_party: roles.localParty,
    lan_peer_party: roles.peerParty,
    lan_peer_party2: roles.peerParty2,
    lan_master_host: roles.masterHost ?? '',
    lan_is_master: roles.isMaster ? 'true' : 'false',
    lan_is_trio: roles.isTrio ? 'true' : 'false',
  };
  appConfigRepository.setMany(entries);
}

/** Load persisted roles for keygen when React state may be empty. */
export function loadPersistedLanRoles(): PersistedLanRoles {
  const get = (key: string) => appConfigRepository.get(key)?.trim() ?? '';
  return {
    localParty: get('lan_local_party'),
    peerParty: get('lan_peer_party'),
    peerParty2: get('lan_peer_party2'),
    masterHost: normalizeLanHost(get('lan_master_host')),
    isMaster: appConfigRepository.getBool('lan_is_master', false),
    isTrio: appConfigRepository.getBool('lan_is_trio', false),
  };
}

export function resolveEffectiveLanKeygenContext(input: {
  setupMode: 'duo' | 'trio';
  state: {
    isMaster: boolean;
    masterHost: string | null;
    localParty: string;
    peerParty: string | null;
    peerParty2: string | null;
  };
}): {
  isTrio: boolean;
  isMaster: boolean;
  masterHost: string | null;
  localParty: string;
  peerParty: string;
  peerParty2: string;
} {
  const persisted = loadPersistedLanRoles();
  const isTrio = input.setupMode === 'trio' || persisted.isTrio;
  const isMaster = input.state.isMaster || persisted.isMaster;
  const masterHost =
    normalizeLanHost(input.state.masterHost) || persisted.masterHost;
  const localParty =
    (input.state.localParty || persisted.localParty).trim() ||
    (isTrio
      ? isMaster
        ? 'KeyShare1'
        : persisted.localParty || 'KeyShare2'
      : persisted.localParty || (isMaster ? 'KeyShare1' : 'KeyShare2'));
  const peerParty = (input.state.peerParty || persisted.peerParty).trim();
  const peerParty2 = (input.state.peerParty2 || persisted.peerParty2).trim();

  if (!localParty) {
    throw new Error(
      'LAN party role is missing on this device. Re-run pairing on all devices, then tap Start/Join Setup together.',
    );
  }
  if (isTrio && (!peerParty || !peerParty2)) {
    throw new Error(
      'Trio LAN roles are incomplete. Re-run pairing on all three devices on the same Wi‑Fi.',
    );
  }
  if (!masterHost) {
    throw new Error(
      'Master device IP is unknown. Re-run pairing on the same Wi‑Fi.',
    );
  }

  return {
    isTrio,
    isMaster,
    masterHost,
    localParty,
    peerParty: peerParty || 'KeyShare2',
    peerParty2: peerParty2 || 'KeyShare3',
  };
}
