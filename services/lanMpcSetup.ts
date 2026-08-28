/**
 * LAN MPC setup orchestration shared by GG18 and DKLS keygen.
 * Single source of truth for host normalization, trio role assignment,
 * master relay URL, and pre-join reachability checks.
 */

import appConfigRepository from './repositories/AppConfigRepository';
import {getCommitteeKeyshareLabel, getKeyshareLabel} from '../utils';
import {
  firstValidLanPeerPayload,
  isIPv4LanHost,
  isLanPeerDiscoveryPayload,
  isNativeDiscoveryError,
  normalizeLanHost,
  pollPeerFoundUntilValid,
  raceLanPeerDiscovery,
  shouldWritePeerFoundCache,
} from './lanPeerDiscovery';

export {
  firstValidLanPeerPayload,
  isIPv4LanHost,
  isLanPeerDiscoveryPayload,
  isNativeDiscoveryError,
  normalizeLanHost,
  pollPeerFoundUntilValid,
  raceLanPeerDiscovery,
  shouldWritePeerFoundCache,
};

export const TRIO_PARTIES_CSV = 'KeyShare1,KeyShare2,KeyShare3';

export function lastIPv4Octet(host: string): number {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return 0;
  }
  const n = Number(parts[3]);
  return Number.isFinite(n) ? n : 0;
}

/** First normalized LAN host among candidates (e.g. discovery payload, then getLanIp). */
export function coalesceLanHost(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const raw of candidates) {
    const host = normalizeLanHost(raw);
    if (host) {
      return host;
    }
  }
  return null;
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
  const parties = [localParty, peerParty].sort();
  return {partyID: localParty, partiesCSV: parties.join(',')};
}

/** Prefer keyshare local_party_key when it is already a committee member (LAN KeyShareN or npub). */
function resolveDklsLocalSigningLabel(
  meta: {
    local_party_key?: string;
    keygen_committee_keys?: string[] | null;
  } | null,
): string {
  const localKey = (meta?.local_party_key ?? '').trim();
  const committee = meta?.keygen_committee_keys;
  if (localKey && Array.isArray(committee) && committee.length >= 2) {
    const inCommittee = committee.some(
      k => String(k ?? '').trim() === localKey,
    );
    if (inCommittee) {
      const label = getCommitteeKeyshareLabel(meta, localKey);
      if (label) {
        return label;
      }
      if (localKey.startsWith('KeyShare')) {
        return localKey;
      }
    }
  }
  return getKeyshareLabel(meta);
}

/**
 * DKLS LAN spend: party ids must match libtss ids from keygen committee order,
 * not Wi‑Fi IP ranking (KeyShare1/2/3). Use npubs from discovery + keyshare metadata.
 * Do not pass IP-derived KeyShare roles as peerCommitteeKey — use discovery npub/KeyShare id.
 */
export function resolveDklsLanSigningPartiesFromKeyshare(
  meta: {
    local_party_key?: string;
    keygen_committee_keys?: string[] | null;
  } | null,
  peerCommitteeKey: string,
): {partyID: string; peerParty: string; partiesCSV: string} {
  const localLabel = resolveDklsLocalSigningLabel(meta);
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
  const peerLabel = getCommitteeKeyshareLabel(meta, peerKey) || peerKey;
  if (!peerLabel) {
    throw new Error(
      'Could not map the paired device to your wallet committee. Ensure both devices use the same trio wallet, then re-pair on LAN.',
    );
  }
  if (localLabel === peerLabel) {
    throw new Error(
      'LAN co-signing needs two different key shares. Re-pair devices and ensure each phone holds a distinct share.',
    );
  }
  const {partyID, partiesCSV} = resolveLanSigningParties({
    localParty: localLabel,
    peerParty: peerLabel,
  });
  const unique = partiesCSV.split(',').map(s => s.trim()).filter(Boolean);
  if (unique.length !== 2 || new Set(unique).size !== 2) {
    throw new Error(
      `Invalid LAN signing party set (${partiesCSV}). Re-pair on the same Wi‑Fi and retry.`,
    );
  }
  return {partyID, peerParty: peerLabel, partiesCSV};
}

/**
 * DKLS Nostr spend/sign: build sorted 2-npub CSV for native keysign (duo or trio subset).
 */
export function resolveDklsNostrSigningParties(
  localNpub: string,
  peerNpub: string,
  meta?: {
    keygen_committee_keys?: string[] | null;
  } | null,
): {partiesNpubsCSV: string; localNpub: string; peerNpub: string} {
  const local = localNpub.trim();
  const peer = peerNpub.trim();
  if (!local.startsWith('npub1')) {
    throw new Error(
      'Local Nostr identity is missing. Re-open the wallet or re-pair before co-signing.',
    );
  }
  if (!peer.startsWith('npub1')) {
    throw new Error(
      'Peer Nostr identity is missing. Re-connect the co-signing device, then retry.',
    );
  }
  if (local === peer) {
    throw new Error(
      'Nostr co-signing needs two different devices. Select another peer and retry.',
    );
  }
  const committee = meta?.keygen_committee_keys;
  if (Array.isArray(committee) && committee.length >= 2) {
    const committeeNpubs = committee
      .map(k => String(k ?? '').trim())
      .filter(k => k.startsWith('npub1'));
    if (committeeNpubs.length >= 2) {
      const inCommittee = (npub: string) =>
        committeeNpubs.some(c => c === npub);
      if (!inCommittee(local) || !inCommittee(peer)) {
        throw new Error(
          'Selected peer is not in this wallet committee. Pick a device that holds a different key share from the same wallet.',
        );
      }
    }
  }
  const parties = [local, peer].sort();
  if (new Set(parties).size !== 2) {
    throw new Error('Invalid Nostr signing party set (duplicate npubs).');
  }
  return {
    partiesNpubsCSV: parties.join(','),
    localNpub: local,
    peerNpub: peer,
  };
}

/**
 * GG18 LAN spend/sign: use party ids stored in the keyshare (`local_party_key` and
 * committee peers), not Wi‑Fi IP slot labels assigned during pairing UI.
 * DKLS uses {@link resolveDklsLanSigningPartiesFromKeyshare} instead.
 */
export function resolveGg18LanSigningPartiesFromKeyshare(
  meta: {
    local_party_key?: string;
    keygen_committee_keys?: string[] | null;
  } | null,
  input: {
    peerParty?: string | null;
    peerCommitteeKey?: string | null;
    persistedPeerParty?: string | null;
  },
): {partyID: string; partiesCSV: string} {
  const localKey = (meta?.local_party_key ?? '').trim();
  if (!localKey) {
    throw new Error(
      'LAN party identity missing from keyshare. Re-import your keyshare, then retry co-signing.',
    );
  }

  const committee = meta?.keygen_committee_keys;
  const committeeUsesNpubs =
    localKey.startsWith('npub1') ||
    (Array.isArray(committee) &&
      committee.some(k => String(k ?? '').trim().startsWith('npub1')));

  let peerKey = '';
  if (committeeUsesNpubs) {
    peerKey =
      (input.peerCommitteeKey ?? '').trim() ||
      (input.peerParty?.trim().startsWith('npub1') ? input.peerParty.trim() : '') ||
      (input.persistedPeerParty?.trim().startsWith('npub1')
        ? input.persistedPeerParty.trim()
        : '') ||
      (input.peerParty ?? '').trim() ||
      (input.persistedPeerParty ?? '').trim();
  } else {
    peerKey =
      (input.peerParty ?? '').trim() || (input.persistedPeerParty ?? '').trim();
    if (peerKey.startsWith('npub1') && meta) {
      const label = getCommitteeKeyshareLabel(meta, peerKey);
      if (label) {
        peerKey = label;
      }
    }
  }

  if (!peerKey) {
    throw new Error(
      'LAN peer role is missing. Re-run device pairing on the same Wi‑Fi, then retry co-signing.',
    );
  }

  return resolveLanSigningParties({
    localParty: localKey,
    peerParty: peerKey,
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
  // Always KeyShare1,KeyShare2 so both devices persist the same committee order.
  return {partyID, partiesCSV: 'KeyShare1,KeyShare2'};
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
  // Trust live pairing state; stale persisted isMaster caused both phones to register KeyShare1.
  const isMaster = input.state.isMaster;
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
