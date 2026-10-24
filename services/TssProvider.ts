import {BBMTLibNativeModule} from '../native_modules';
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
  ): Promise<SetupResult> {
    const resolved = await resolveTssBackendForKeygen(setupMode, backend);
    if (resolved === 'dkls23') {
      const raw = await BBMTLibNativeModule.dklsMpcTssSetup(
        server,
        partyID,
        partiesCSV,
        sessionID,
        sessionKey,
        encKey,
        decKey,
        chaincode,
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
  ): Promise<SetupResult> {
    const resolved = await resolveTssBackendForKeygen(setupMode, backend);
    if (resolved === 'dkls23') {
      const raw = await BBMTLibNativeModule.dklsNostrMpcTssSetup(
        relaysCSV,
        partyNsec,
        partiesNpubsCSV,
        sessionID,
        sessionKey,
        chaincode,
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
  ): Promise<string> {
    const backend = await resolveTssBackend();
    if (backend === 'dkls23') {
      return BBMTLibNativeModule.dklsMpcSignPSBT(
        server,
        partyID,
        partiesCSV,
        sessionID,
        sessionKey,
        encKey,
        decKey,
        psbtBase64,
      );
    }
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
  ): Promise<string> {
    const backend = await resolveTssBackend();
    if (backend === 'dkls23') {
      return BBMTLibNativeModule.dklsMpcSendBTCWithUTXOs(
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
    }
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
  ): Promise<string> {
    const backend = await resolveTssBackend();
    if (backend === 'dkls23') {
      return BBMTLibNativeModule.dklsNostrMpcSendBTC(
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
    }
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
  ): Promise<string> {
    const backend = await resolveTssBackend();
    if (backend === 'dkls23') {
      return BBMTLibNativeModule.dklsNostrMpcSignPSBT(
        relaysCSV,
        partiesNpubsCSV,
        npubsSorted,
        psbtBase64,
      );
    }
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
