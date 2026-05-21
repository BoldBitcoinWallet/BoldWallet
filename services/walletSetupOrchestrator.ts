/**
 * Shared wallet-setup orchestration for LAN and Nostr (duo/trio).
 * UI screens keep transport-specific pairing; keygen prep/run uses the same contract.
 */

import {Platform} from 'react-native';
import {BBMTLibNativeModule} from '../native_modules';
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
