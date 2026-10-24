import {BBMTLibNativeModule} from '../native_modules';
import {
  completeCeremonyToken,
  newCeremonySessionID,
  releaseCeremonyToken,
  requestImportCeremonyToken,
  requestKeygenCeremonyToken,
  requestSignCeremonyToken,
} from './ceremonyAuth';
import {
  markMpcInProgress,
  resetMpcCancelState,
  safeCancelMpc,
} from './mpcCancel';
import type {MpcCancelResult} from './mpcCancel';

export type {MpcCancelResult};
import {
  resolveTssBackend,
  resolveTssBackendForKeygen,
  type SetupMode,
  type TssBackend,
} from './tssBackend';

export type {TssBackend};

/**
 * 3b-2: ceremony-token scope. Owner-provided tokens pass through
 * untouched (owner owns lifecycle); otherwise mint here (OS
 * prompt), complete on success, release on throw. Calls without
 * an MPC session (sends, nostr, keypair generators) get a fresh
 * single-call ceremony ID; session equality then binds the token
 * to this call only (opClass + TTL + revocation still enforced).
 * The mint fn is pinned per call site (sign vs keygen) — there
 * is no generic minter; the class is chosen by the wrapper, and
 * enforced natively by the gated method.
 */
async function withCeremonyToken<T>(
  sessionID: string | undefined,
  ceremonyToken: string | undefined,
  mint: (sessionID: string) => Promise<string>,
  purpose: string,
  // 3b-2e: fn also receives the ceremony session (native strict
  // verify needs token + session; minted sessions originate here).
  fn: (token: string, ceremonyID: string) => Promise<T>,
): Promise<T> {
  const ceremonyID = sessionID ?? (await newCeremonySessionID(purpose));
  const token = ceremonyToken ?? (await mint(ceremonyID));
  const owned = ceremonyToken === undefined;
  try {
    const out = await fn(token, ceremonyID);
    if (owned) {
      try {
        await completeCeremonyToken(token);
      } catch {
        /* logged in ceremonyAuth; success stands */
      }
    }
    return out;
  } catch (error) {
    if (owned) {
      try {
        await releaseCeremonyToken(token);
      } catch {
        /* logged in ceremonyAuth */
      }
    }
    throw error;
  }
}

export {
  detectKeyshareTssBackend,
  resolveTssBackend,
  resolveTssBackendForKeygen,
} from './tssBackend';

/**
 * F15b-1: DKG setup result. DKLs setup stages the keyshare in Go and
 * returns a handle + allowlisted metadata only — share bytes never
 * cross the bridge. GG18 (F19 legacy branch) still returns full JSON;
 * that branch stays plaintext by explicit protocol-variant deferral.
 */
export type SetupResult =
  | {kind: 'staged'; handle: string; metadata: Record<string, any>}
  | {kind: 'legacy-gg18'; json: string};

/**
 * Parse + validate the staged-setup envelope returned by the native
 * DKLs keygen methods. Throws on malformed input — callers fail
 * closed, never treat raw output as a keyshare.
 */
export function parseStagedSetupResult(raw: string): SetupResult {
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid staged setup result');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.handle !== 'string' ||
    parsed.handle.trim() === '' ||
    !parsed.metadata ||
    typeof parsed.metadata !== 'object'
  ) {
    throw new Error('Invalid staged setup result');
  }
  return {kind: 'staged', handle: parsed.handle, metadata: parsed.metadata};
}

export const TssProvider = {
  resolveTssBackend,
  resolveTssBackendForKeygen,

  async helloDkg(
    setupMode?: SetupMode,
    backend?: TssBackend | null,
  ): Promise<string> {
    const resolved = await resolveTssBackendForKeygen(setupMode, backend);
    if (resolved === 'dkls23') {
      return BBMTLibNativeModule.dklsHelloDkg();
    }
    return BBMTLibNativeModule.preparams('spike', '1');
  },

  async mpcTssSetup(
    server: string,
    partyID: string,
    ppmFile: string,
    partiesCSV: string,
    sessionID: string,
    sessionKey: string,
    encKey: string,
    decKey: string,
    chaincode: string,
    setupMode?: SetupMode,
    backend?: TssBackend | null,
    ceremonyToken?: string,
  ): Promise<SetupResult> {
    const resolved = await resolveTssBackendForKeygen(setupMode, backend);
    if (resolved === 'dkls23') {
      const raw = await withCeremonyToken<string>(
        sessionID,
        ceremonyToken,
        requestKeygenCeremonyToken,
        'keygen',
        token =>
          BBMTLibNativeModule.dklsMpcTssSetup(
            server,
            partyID,
            partiesCSV,
            sessionID,
            sessionKey,
            encKey,
            decKey,
            chaincode,
            token,
          ),
      );
      return parseStagedSetupResult(raw);
    }
    // F19: GG18 legacy branch — full JSON through JS by explicit deferral.
    const json = await BBMTLibNativeModule.mpcTssSetup(
      server,
      partyID,
      ppmFile,
      partiesCSV,
      sessionID,
      sessionKey,
      encKey,
      decKey,
      chaincode,
    );
    return {kind: 'legacy-gg18', json};
  },

  async nostrMpcTssSetup(
    relaysCSV: string,
    partyNsec: string,
    partiesNpubsCSV: string,
    sessionID: string,
    sessionKey: string,
    chaincode: string,
    ppmPath: string,
    setupMode?: SetupMode,
    backend?: TssBackend | null,
    ceremonyToken?: string,
  ): Promise<SetupResult> {
    const resolved = await resolveTssBackendForKeygen(setupMode, backend);
    if (resolved === 'dkls23') {
      const raw = await withCeremonyToken<string>(
        sessionID,
        ceremonyToken,
        requestKeygenCeremonyToken,
        'keygen',
        token =>
          BBMTLibNativeModule.dklsNostrMpcTssSetup(
            relaysCSV,
            partyNsec,
            partiesNpubsCSV,
            sessionID,
            sessionKey,
            chaincode,
            token,
          ),
      );
      return parseStagedSetupResult(raw);
    }
    // F19: GG18 legacy branch — full JSON through JS by explicit deferral.
    const json = await BBMTLibNativeModule.nostrMpcTssSetup(
      relaysCSV,
      partyNsec,
      partiesNpubsCSV,
      sessionID,
      sessionKey,
      chaincode,
      ppmPath,
    );
    return {kind: 'legacy-gg18', json};
  },

  /**
   * 3b-2b B20: pairing-identity keypair. Gated by a single-call
   * `keygen` ceremony — generation precedes any DKG session (the
   * pairing phase runs first), so no DKG token can be shared;
   * each mint carries its own OS-visible prompt.
   */
  async nostrKeypair(ceremonyToken?: string): Promise<string> {
    return withCeremonyToken(
      undefined,
      ceremonyToken,
      requestKeygenCeremonyToken,
      'keygen',
      token => BBMTLibNativeModule.nostrKeypair(token),
    );
  },

  /**
   * 3b-2b B21: LAN ECIES device keypair. Same single-call
   * `keygen` ceremony as nostrKeypair.
   */
  async eciesKeypair(ceremonyToken?: string): Promise<string> {
    return withCeremonyToken(
      undefined,
      ceremonyToken,
      requestKeygenCeremonyToken,
      'keygen',
      token => BBMTLibNativeModule.eciesKeypair(token),
    );
  },

  /**
   * 3b-2c B13: LAN handshake publish. Rides the handshake
   * ceremony token (sign|keygen) — the token is REQUIRED:
   * transport never mints (a mint fallback inside poll/retry
   * loops would prompt-spam). The phase owner (initSession)
   * mints, passes, and completes.
   */
  async publishData(
    port: string,
    timeout: string,
    encKey: string,
    raw: string,
    mode: string,
    ceremonyToken: string,
    ceremonySessionID: string,
  ): Promise<string> {
    return BBMTLibNativeModule.publishData(
      port,
      timeout,
      encKey,
      raw,
      mode,
      ceremonyToken,
      ceremonySessionID,
    );
  },

  /**
   * 3b-2d B15: mempool API base. Allowlist-or-token: omit the
   * token for allowlisted (built-in or previously approved)
   * URLs; pass a `config` token to approve + persist a new URL.
   * Prefer ensureMempoolApiApplied (approval UX included).
   */
  async setAPI(
    network: string,
    baseAPI: string,
    ceremonyToken?: string,
    ceremonySessionID?: string,
  ): Promise<string> {
    return BBMTLibNativeModule.setAPI(
      network,
      baseAPI,
      ceremonyToken ?? '',
      ceremonySessionID ?? '',
    );
  },

  /**
   * 3b-2d B16: fee API bases (CSV). Same allowlist-or-token
   * rule as setAPI. Prefer ensureFeeApisApplied.
   */
  async setFeeAPIs(
    urlsCSV: string,
    ceremonyToken?: string,
    ceremonySessionID?: string,
  ): Promise<string> {
    return BBMTLibNativeModule.setFeeAPIs(
      urlsCSV,
      ceremonyToken ?? '',
      ceremonySessionID ?? '',
    );
  },

  /**
   * 3b-2e B17: backup stage. Owner token+session pass through
   * untouched (import flow shares one `import` ceremony across
   * stage+persist); otherwise mint a single-call import ceremony
   * here. Half pairs (token xor session) throw — a caller bug,
   * never silently downgraded to a second mint.
   */
  async importBackupToStagedHandle(
    blob: string,
    password: string,
    ceremonyToken?: string,
    ceremonySessionID?: string,
  ): Promise<string> {
    if (
      (ceremonyToken === undefined) !== (ceremonySessionID === undefined)
    ) {
      throw new Error(
        'importBackupToStagedHandle: ceremonyToken and ceremonySessionID are both-or-neither',
      );
    }
    if (ceremonyToken !== undefined && ceremonySessionID !== undefined) {
      return BBMTLibNativeModule.importBackupToStagedHandle(
        blob,
        password,
        ceremonyToken,
        ceremonySessionID,
      );
    }
    return withCeremonyToken(
      undefined,
      undefined,
      requestImportCeremonyToken,
      'import',
      (token, ceremonyID) =>
        BBMTLibNativeModule.importBackupToStagedHandle(
          blob,
          password,
          token,
          ceremonyID,
        ),
    );
  },

  /**
   * 3b-2e B18: staged-handle persist. Same owner-or-mint `import`
   * rule as B17. Setup-commit flows (decoupled from setup by the
   * backup-check UI) mint their own save ceremony — one prompt
   * per explicit user action.
   */
  async persistStoredKeyshare(
    handle: string,
    nsec: string,
    npub: string,
    ceremonyToken?: string,
    ceremonySessionID?: string,
  ): Promise<string> {
    if (
      (ceremonyToken === undefined) !== (ceremonySessionID === undefined)
    ) {
      throw new Error(
        'persistStoredKeyshare: ceremonyToken and ceremonySessionID are both-or-neither',
      );
    }
    if (ceremonyToken !== undefined && ceremonySessionID !== undefined) {
      return BBMTLibNativeModule.persistStoredKeyshare(
        handle,
        nsec,
        npub,
        ceremonyToken,
        ceremonySessionID,
      );
    }
    return withCeremonyToken(
      undefined,
      undefined,
      requestImportCeremonyToken,
      'import',
      (token, ceremonyID) =>
        BBMTLibNativeModule.persistStoredKeyshare(
          handle,
          nsec,
          npub,
          token,
          ceremonyID,
        ),
    );
  },

  /**
   * 3b-2c B14: LAN handshake fetch. Same required-token rule
   * as publishData.
   */
  async fetchData(
    url: string,
    decKey: string,
    payload: string,
    ceremonyToken: string,
    ceremonySessionID: string,
  ): Promise<string> {
    return BBMTLibNativeModule.fetchData(
      url,
      decKey,
      payload,
      ceremonyToken,
      ceremonySessionID,
    );
  },

  /** Human-readable backend id for logs (gg18 | dkls23). */
  normalizeBackendLabel(backend: string): 'gg18' | 'dkls23' {
    return backend === 'dkls23' || backend === 'dkls' ? 'dkls23' : 'gg18';
  },

  async mpcSignPSBT(
    server: string,
    partyID: string,
    partiesCSV: string,
    sessionID: string,
    sessionKey: string,
    encKey: string,
    decKey: string,
    psbtBase64: string,
    ceremonyToken?: string,
  ): Promise<string> {
    const backend = await resolveTssBackend();
    if (backend === 'dkls23') {
      return withCeremonyToken(sessionID, ceremonyToken, requestSignCeremonyToken, 'sign', token =>
        BBMTLibNativeModule.dklsMpcSignPSBT(
          server,
          partyID,
          partiesCSV,
          sessionID,
          sessionKey,
          encKey,
          decKey,
          psbtBase64,
          token,
        ),
      );
    }
    // F19: GG18 branch stays untokenized (disclosed gap).
    return BBMTLibNativeModule.mpcSignPSBT(
      server,
      partyID,
      partiesCSV,
      sessionID,
      sessionKey,
      encKey,
      decKey,
      psbtBase64,
    );
  },

  async mpcSendBTCWithUTXOs(
    server: string,
    partyID: string,
    partiesCSV: string,
    sessionID: string,
    sessionKey: string,
    encKey: string,
    decKey: string,
    btcPub: string,
    toAddress: string,
    satoshiAmount: string,
    satoshiFees: string,
    utxosWithPathsJSON: string,
    changeAddress: string,
    ceremonyToken?: string,
  ): Promise<string> {
    const backend = await resolveTssBackend();
    if (backend === 'dkls23') {
      return withCeremonyToken(sessionID, ceremonyToken, requestSignCeremonyToken, 'sign', token =>
        BBMTLibNativeModule.dklsMpcSendBTCWithUTXOs(
          server,
          partyID,
          partiesCSV,
          sessionID,
          sessionKey,
          encKey,
          decKey,
          btcPub,
          toAddress,
          satoshiAmount,
          satoshiFees,
          utxosWithPathsJSON,
          changeAddress,
          token,
        ),
      );
    }
    // F19: GG18 branch stays untokenized (disclosed gap).
    return BBMTLibNativeModule.mpcSendBTCWithUTXOs(
      server,
      partyID,
      partiesCSV,
      sessionID,
      sessionKey,
      encKey,
      decKey,
      btcPub,
      toAddress,
      satoshiAmount,
      satoshiFees,
      utxosWithPathsJSON,
      changeAddress,
    );
  },

  async nostrMpcSendBTC(
    relaysCSV: string,
    partiesNpubsCSV: string,
    npubsSorted: string,
    balanceSats: string,
    toAddress: string,
    satoshiAmount: string,
    satoshiFees: string,
    utxosWithPathsJSON: string,
    changeAddress: string,
    ceremonyToken?: string,
  ): Promise<string> {
    const backend = await resolveTssBackend();
    if (backend === 'dkls23') {
      return withCeremonyToken(undefined, ceremonyToken, requestSignCeremonyToken, 'sign', token =>
        BBMTLibNativeModule.dklsNostrMpcSendBTC(
          relaysCSV,
          partiesNpubsCSV,
          npubsSorted,
          balanceSats,
          toAddress,
          satoshiAmount,
          satoshiFees,
          utxosWithPathsJSON,
          changeAddress,
          token,
        ),
      );
    }
    // F19: GG18 branch stays untokenized (disclosed gap).
    return BBMTLibNativeModule.nostrMpcSendBTC(
      relaysCSV,
      partiesNpubsCSV,
      npubsSorted,
      balanceSats,
      toAddress,
      satoshiAmount,
      satoshiFees,
      utxosWithPathsJSON,
      changeAddress,
    );
  },

  async nostrMpcSignPSBT(
    relaysCSV: string,
    partiesNpubsCSV: string,
    npubsSorted: string,
    psbtBase64: string,
    ceremonyToken?: string,
  ): Promise<string> {
    const backend = await resolveTssBackend();
    if (backend === 'dkls23') {
      return withCeremonyToken(undefined, ceremonyToken, requestSignCeremonyToken, 'sign', token =>
        BBMTLibNativeModule.dklsNostrMpcSignPSBT(
          relaysCSV,
          partiesNpubsCSV,
          npubsSorted,
          psbtBase64,
          token,
        ),
      );
    }
    // F19: GG18 branch stays untokenized (disclosed gap).
    return BBMTLibNativeModule.nostrMpcSignPSBT(
      relaysCSV,
      partiesNpubsCSV,
      npubsSorted,
      psbtBase64,
    );
  },

  async cancelMpcSession(sessionID: string): Promise<MpcCancelResult> {
    return safeCancelMpc('session', async () => {
      const backend = await resolveTssBackend();
      if (backend === 'dkls23') {
        await BBMTLibNativeModule.dklsCancelMpcSession(sessionID);
        return;
      }
      await BBMTLibNativeModule.cancelMpcSession(sessionID);
    });
  },

  async cancelNostrMpc(): Promise<MpcCancelResult> {
    return safeCancelMpc('nostr', async () => {
      const backend = await resolveTssBackend();
      if (backend === 'dkls23') {
        await BBMTLibNativeModule.dklsCancelNostrMpc();
        return;
      }
      await BBMTLibNativeModule.cancelNostrMpc();
    });
  },

  resetMpcCancelState,
  markMpcInProgress,
};
