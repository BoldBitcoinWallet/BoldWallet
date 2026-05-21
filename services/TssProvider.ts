import {BBMTLibNativeModule} from '../native_modules';
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
  ): Promise<string> {
    const resolved = await resolveTssBackendForKeygen(setupMode, backend);
    if (resolved === 'dkls23') {
      return BBMTLibNativeModule.dklsMpcTssSetup(
        server,
        partyID,
        partiesCSV,
        sessionID,
        sessionKey,
        encKey,
        decKey,
        chaincode,
      );
    }
    return BBMTLibNativeModule.mpcTssSetup(
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
  ): Promise<string> {
    const resolved = await resolveTssBackendForKeygen(setupMode, backend);
    if (resolved === 'dkls23') {
      return BBMTLibNativeModule.dklsNostrMpcTssSetup(
        relaysCSV,
        partyNsec,
        partiesNpubsCSV,
        sessionID,
        sessionKey,
        chaincode,
      );
    }
    return BBMTLibNativeModule.nostrMpcTssSetup(
      relaysCSV,
      partyNsec,
      partiesNpubsCSV,
      sessionID,
      sessionKey,
      chaincode,
      ppmPath,
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

  async cancelMpcSession(sessionID: string): Promise<void> {
    const backend = await resolveTssBackend();
    if (backend === 'dkls23') {
      await BBMTLibNativeModule.dklsCancelMpcSession(sessionID);
      return;
    }
    await BBMTLibNativeModule.cancelMpcSession(sessionID);
  },

  async cancelNostrMpc(): Promise<void> {
    const backend = await resolveTssBackend();
    if (backend === 'dkls23') {
      await BBMTLibNativeModule.dklsCancelNostrMpc();
      return;
    }
    await BBMTLibNativeModule.cancelNostrMpc();
  },
};
