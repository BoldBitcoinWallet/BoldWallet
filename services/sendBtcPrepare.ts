import {normalizeNetworkKey, resolveStoredMempoolApiBase} from './mempoolApiBase';
import {WalletService, type UtxoWithPath} from './WalletService';

export type SendBtcPrepareParams = {
  network: string;
  addressType: string;
  utxosJsonFromRoute?: string | null;
  changeAddressFromRoute?: string | null;
  /** Sender receive path from route (fallback UTXO fetch). */
  senderDerivationPath?: string | null;
};

export type SendBtcPrepareResult = {
  utxosWithPathsJSON: string;
  changeAddress: string;
  apiUrl: string;
  network: string;
};

type RawUtxoEntry = {
  txid?: string;
  vout?: number;
  value?: number;
  derivation_path?: string;
  derivationPath?: string;
  address?: string;
  scriptpubkey?: string;
};

function parseRouteUtxosJson(raw: string): UtxoWithPath[] | null {
  try {
    const parsed = JSON.parse(raw) as RawUtxoEntry[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    const first = parsed[0];
    if (
      !first ||
      typeof first.txid !== 'string' ||
      typeof first.vout !== 'number' ||
      typeof first.value !== 'number'
    ) {
      return null;
    }
    return parsed.map(u => ({
      txid: u.txid!,
      vout: u.vout!,
      value: u.value!,
      address: u.address ?? '',
      derivationPath: u.derivation_path ?? u.derivationPath ?? '',
      chain: 'receive' as const,
      chainIndex: 0,
      scriptpubkey: u.scriptpubkey,
    }));
  } catch {
    return null;
  }
}

function utxosToNativeJson(
  utxos: Array<UtxoWithPath & {scriptpubkey?: string}>,
): string {
  const forNative = utxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    value: u.value,
    derivation_path: u.derivationPath,
    address: u.address,
    scriptpubkey: u.scriptpubkey ?? '',
  }));
  return JSON.stringify(forNative);
}

/**
 * Resolve UTXOs + change address for multi-path Send BTC (LAN / Nostr co-sign).
 */
export async function prepareSendBtcMultiPathInputs(
  params: SendBtcPrepareParams,
): Promise<SendBtcPrepareResult> {
  const network = normalizeNetworkKey(params.network?.trim() || 'mainnet');
  const addressType = params.addressType?.trim() || 'segwit-native';
  const apiUrl = resolveStoredMempoolApiBase(network);
  const ws = WalletService.getInstance();

  let changeAddress = params.changeAddressFromRoute?.trim() ?? '';
  if (!changeAddress) {
    try {
      changeAddress = await ws.getNextChangeAddress(network, addressType);
    } catch (e) {
      throw new Error(
        `Could not derive change address: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  if (!changeAddress) {
    throw new Error(
      'Could not derive change address. Ensure your keyshare is loaded on this device.',
    );
  }

  const skipEmptyCache = {skipEmptyCache: true};
  let utxos: UtxoWithPath[] | null = null;

  const fromRoute = params.utxosJsonFromRoute?.trim();
  if (fromRoute) {
    utxos = parseRouteUtxosJson(fromRoute);
  }

  if (!utxos?.length) {
    utxos = await ws.fetchUtxosWithPaths(
      network,
      addressType,
      apiUrl,
      undefined,
      skipEmptyCache,
    );
  }

  const senderPath = params.senderDerivationPath?.trim();
  if (!utxos?.length && senderPath) {
    utxos = await ws.fetchUtxosAtPath(
      network,
      addressType,
      senderPath,
      apiUrl,
      'receive',
      0,
      skipEmptyCache,
    );
  }

  if (!utxos?.length) {
    throw new Error(
      'No spendable UTXOs found. Pull to refresh on Wallet home, wait for sync to finish, then try Send again.',
    );
  }

  const needsEnrichment = utxos.some(u => !(u as {scriptpubkey?: string}).scriptpubkey);
  const enriched = needsEnrichment
    ? await ws.enrichUtxosWithScriptpubkey(utxos, apiUrl)
    : utxos;

  return {
    utxosWithPathsJSON: utxosToNativeJson(enriched),
    changeAddress,
    apiUrl,
    network,
  };
}
