/**
 * Shared wallet-setup orchestration for LAN and Nostr (duo/trio).
 * UI screens keep transport-specific pairing; keygen prep/run uses the same contract.
 */

import {Platform} from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import {BBMTLibNativeModule} from '../native_modules';
import {KEYSHARE_STORAGE_KEY, saveKeyshareMetadata} from '../utils';
import {waitMS} from './WalletService';
import {
  buildLanRelayServerUrl,
  normalizeLanHost,
  persistLanPairingRoles,
  probeLanRelayReachable,
  resolveLanKeygenParties,
  resolveEffectiveLanKeygenContext,
} from './lanMpcSetup';
import {
  resolveLanKeygenTransportKeys,
  type LanMpcTransportKeys,
} from './lanMpcTransport';
import {assertTrioLanKeygenReady} from './trioLanKeygenPreflight';
import {LAN_KEYGEN_STATUS} from './walletSetupUi';
import {TssProvider} from './TssProvider';
import type {SetupMode, TssBackend} from './tssBackend';
import {resolveTssBackendForKeygen} from './tssBackend';
import {prepareDeviceForKeygen} from './tssKeygenPrepare';
export type SetupTransport = 'lan' | 'nostr';

export type WalletSetupRouteParams = {
  mode: SetupMode;
  transport?: SetupTransport;
  backend?: TssBackend;
};

export const WALLET_SETUP_PREPARE_TIMEOUT_MIN = {
  lan: 2,
  nostr: 20,
} as const;

/** Resolve backend: explicit route param → user preference. */
export async function resolveWalletSetupBackend(
  explicit?: TssBackend | null,
  setupMode?: SetupMode,
): Promise<TssBackend> {
  if (explicit === 'gg18' || explicit === 'dkls23') {
    return explicit;
  }
  return resolveTssBackendForKeygen(setupMode);
}

/** Prepare device (GG18 preparams or DKLS helloDkg) — same UX, backend-specific native work. */
export async function runWalletSetupPrepare(opts: {
  ppmFile: string;
  transport: SetupTransport;
  setupMode?: SetupMode;
  backend?: TssBackend | null;
  skipDeletePpm?: boolean;
}): Promise<TssBackend> {
  const timeout =
    opts.transport === 'nostr'
      ? WALLET_SETUP_PREPARE_TIMEOUT_MIN.nostr
      : WALLET_SETUP_PREPARE_TIMEOUT_MIN.lan;
  return prepareDeviceForKeygen(
    opts.ppmFile,
    timeout,
    opts.setupMode,
    opts.skipDeletePpm,
    opts.backend,
  );
}

/** Android: load libbbmtmobile DKLS path before LAN keygen. */
export async function ensureDklsRuntimeIfNeeded(backend: TssBackend): Promise<void> {
  if (
    Platform.OS === 'android' &&
    backend === 'dkls23' &&
    BBMTLibNativeModule.ensureDklsLanRuntime
  ) {
    await Promise.race([
      BBMTLibNativeModule.ensureDklsLanRuntime(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('DKLS runtime load timed out')),
          15000,
        ),
      ),
    ]);
  }
}

export type LanKeygenOrchestrationInput = {
  setupMode: SetupMode;
  backend?: TssBackend | null;
  isMaster: boolean;
  masterHost: string | null;
  localParty: string;
  peerParty: string | null;
  peerParty2: string | null;
  discoveryPort: number;
  ppmFile: string;
  /** Master-only: publish handshake and start MPC relay. */
  initSession: () => Promise<string>;
  /** Trio peer discovery fields for preflight. */
  trioPreflight?: {
    peerIP: string | null;
    peerIP2: string | null;
    peerDevice: string | null;
    peerDevice2: string | null;
    peerPubkey: string | null;
    peerPubkey2: string | null;
  };
  keypairJson: string;
  peerPubkey: string;
  relayWaitMs?: number;
  postRelayWaitMs?: number;
};

export type LanKeygenOrchestrationResult = {
  backend: TssBackend;
  server: string;
  partyID: string;
  partiesCSV: string;
  sessionID: string;
  transport: LanMpcTransportKeys;
  chaincode: string;
  statusLines: typeof LAN_KEYGEN_STATUS;
};

/**
 * LAN keygen orchestration aligned with main-branch GG18:
 * preflight (trio) → initSession → master relay → probe → sessionID → native keygen.
 */
export async function runLanWalletKeygen(
  input: LanKeygenOrchestrationInput,
): Promise<LanKeygenOrchestrationResult> {
  const ctx = resolveEffectiveLanKeygenContext({
    setupMode: input.setupMode,
    state: {
      isMaster: input.isMaster,
      masterHost: input.masterHost,
      localParty: input.localParty,
      peerParty: input.peerParty,
      peerParty2: input.peerParty2,
    },
  });
  const isTrio = ctx.isTrio;
  const relayHost = normalizeLanHost(ctx.masterHost);
  if (!relayHost) {
    throw new Error(
      'Master device IP is unknown. Pair devices again, then retry setup.',
    );
  }

  const backend = await resolveWalletSetupBackend(
    input.backend,
    input.setupMode,
  );

  if (isTrio && input.trioPreflight) {
    assertTrioLanKeygenReady({
      ...input.trioPreflight,
      localParty: ctx.localParty,
      peerParty: ctx.peerParty,
      peerParty2: ctx.peerParty2,
    });
  }

  await ensureDklsRuntimeIfNeeded(backend);

  const data = (await input.initSession()).trim();
  if (ctx.isMaster) {
    await BBMTLibNativeModule.stopRelay('stop');
    await BBMTLibNativeModule.runRelay(String(input.discoveryPort));
  }

  const relayWait = input.relayWaitMs ?? (isTrio ? 4000 : 2000);
  await waitMS(relayWait);

  const server = buildLanRelayServerUrl(relayHost, input.discoveryPort);
  if (!ctx.isMaster) {
    await probeLanRelayReachable(server, {
      retries: isTrio ? 18 : 12,
      intervalMs: 400,
    });
  }

  await waitMS(input.postRelayWaitMs ?? 2000);

  const {partyID, partiesCSV} = resolveLanKeygenParties({
    isTrio,
    isMaster: ctx.isMaster,
    localParty: ctx.localParty,
  });

  const sessionID = (
    await BBMTLibNativeModule.sha256(`${data}/${server}`)
  ).trim();

  const transport = await resolveLanKeygenTransportKeys({
    isTrio,
    keypairJson: input.keypairJson,
    peerPubkey: input.peerPubkey,
    sessionID,
    masterHost: relayHost,
    sha256: (msg: string) => BBMTLibNativeModule.sha256(msg),
  });

  return {
    backend,
    server,
    partyID,
    partiesCSV,
    sessionID,
    transport,
    chaincode: data,
    statusLines: LAN_KEYGEN_STATUS,
  };
}

/** Invoke native LAN keygen for the resolved backend. */
export async function invokeLanWalletKeygen(
  orch: LanKeygenOrchestrationResult,
  ppmFile: string,
  setupMode?: SetupMode,
): Promise<string> {
  return TssProvider.mpcTssSetup(
    orch.server,
    orch.partyID,
    ppmFile,
    orch.partiesCSV,
    orch.sessionID,
    orch.transport.sessionKey,
    orch.transport.encKey,
    orch.transport.decKey,
    orch.chaincode,
    setupMode,
    orch.backend,
  );
}

/** Persist LAN roles after pairing (survives navigation). */
export function persistLanRolesFromContext(
  setupMode: SetupMode,
  ctx: ReturnType<typeof resolveEffectiveLanKeygenContext>,
): void {
  persistLanPairingRoles({
    localParty: ctx.localParty,
    peerParty: ctx.peerParty,
    peerParty2: ctx.peerParty2,
    masterHost: ctx.masterHost,
    isMaster: ctx.isMaster,
    isTrio: setupMode === 'trio',
  });
}

export type NostrKeygenInvokeInput = {
  relaysCSV: string;
  partyNsec: string;
  partiesNpubsCSV: string;
  sessionID: string;
  sessionKey: string;
  chaincode: string;
  ppmPath: string;
  setupMode?: SetupMode;
  backend?: TssBackend | null;
};

export async function invokeNostrWalletKeygen(
  input: NostrKeygenInvokeInput,
): Promise<string> {
  const backend = await resolveWalletSetupBackend(
    input.backend,
    input.setupMode,
  );
  await ensureDklsRuntimeIfNeeded(backend);
  return TssProvider.nostrMpcTssSetup(
    input.relaysCSV,
    input.partyNsec,
    input.partiesNpubsCSV,
    input.sessionID,
    input.sessionKey,
    input.chaincode,
    input.ppmPath,
    input.setupMode,
    backend,
  );
}

/** GG18-compatible hex encoding of bech32 nsec for the keyshare `nsec` field. */
export function nsecFieldForKeyshareJson(bech32Nsec: string): string {
  if (!bech32Nsec || bech32Nsec.trim() === '') {
    throw new Error('nsec cannot be empty');
  }
  const bytes = new TextEncoder().encode(bech32Nsec);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export type FinalizeKeyshareOpts = {
  partyNsec?: string;
  nostrNpub?: string;
};

/**
 * Ensure full keyshare JSON has Nostr credentials before EncryptedStorage persist.
 * Does not alter MPC fields (share_b64, committee, etc.).
 */
export function finalizeKeyshareForStorage(
  keyshareJson: string,
  opts?: FinalizeKeyshareOpts,
): string {
  const parsed = JSON.parse(keyshareJson) as Record<string, unknown>;
  if (opts?.partyNsec && (!parsed.nsec || String(parsed.nsec).trim() === '')) {
    parsed.nsec = nsecFieldForKeyshareJson(opts.partyNsec);
  }
  if (opts?.nostrNpub && (!parsed.nostr_npub || String(parsed.nostr_npub).trim() === '')) {
    parsed.nostr_npub = opts.nostrNpub;
  }
  return JSON.stringify(parsed);
}

/** Shown while native keygen reports done but secure storage write is still in flight. */
export const KEYGEN_FINALIZING_STORAGE_STATUS =
  'Finalizing secure wallet storage…';

/** Read-back check that the full keyshare blob exists in RNES. */
export async function verifyWalletKeysharePersisted(): Promise<boolean> {
  try {
    const raw = await EncryptedStorage.getItem(KEYSHARE_STORAGE_KEY);
    return !!(raw && String(raw).trim());
  } catch {
    return false;
  }
}

/**
 * Persist full keyshare + metadata mirror atomically for setup success.
 * Throws if blob write or read-back verification fails (metadata write must succeed).
 */
export async function persistWalletKeyshare(
  keyshareJson: string,
  opts?: FinalizeKeyshareOpts,
): Promise<string> {
  const finalized = opts
    ? finalizeKeyshareForStorage(keyshareJson, opts)
    : keyshareJson;
  if (!finalized || String(finalized).trim() === '') {
    throw new Error('Invalid keyshare: empty payload');
  }
  await EncryptedStorage.setItem(KEYSHARE_STORAGE_KEY, finalized);
  const verified = await verifyWalletKeysharePersisted();
  if (!verified) {
    throw new Error(
      'Could not save your key share securely. Keep the app open and retry setup.',
    );
  }
  await saveKeyshareMetadata(finalized, {throwOnError: true});
  const verifiedAfterMeta = await verifyWalletKeysharePersisted();
  if (!verifiedAfterMeta) {
    throw new Error(
      'Key share was lost during setup. Please run wallet setup again.',
    );
  }
  return finalized;
}
