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

function canonicalizeUtxos(
  utxos: Array<UtxoWithPath & {scriptpubkey?: string}>,
): Array<UtxoWithPath & {scriptpubkey?: string}> {
  const byOutpoint = new Map<string, UtxoWithPath & {scriptpubkey?: string}>();

  for (const raw of utxos) {
    const txid = String(raw.txid || '').trim().toLowerCase();
    const vout = Number(raw.vout);
    const value = Number(raw.value);
    if (!txid || !Number.isInteger(vout) || vout < 0 || !Number.isFinite(value) || value <= 0) {
      continue;
    }

    const normalized: UtxoWithPath & {scriptpubkey?: string} = {
      ...raw,
      txid,
      vout,
      value,
      derivationPath: String(raw.derivationPath || '').trim(),
      address: String(raw.address || '').trim(),
      scriptpubkey: String((raw as {scriptpubkey?: string}).scriptpubkey || '').trim().toLowerCase(),
    };

    const outpointKey = `${txid}:${vout}`;
    const current = byOutpoint.get(outpointKey);
    if (!current) {
      byOutpoint.set(outpointKey, normalized);
      continue;
    }

    const chooseNormalized =
      (!current.scriptpubkey && !!normalized.scriptpubkey) ||
      (!current.derivationPath && !!normalized.derivationPath);
    if (chooseNormalized) {
      byOutpoint.set(outpointKey, normalized);
    }
  }

  return Array.from(byOutpoint.values()).sort((a, b) => {
    if (a.value !== b.value) {
      return a.value - b.value;
    }
    if (a.txid !== b.txid) {
      return a.txid < b.txid ? -1 : 1;
    }
    if (a.vout !== b.vout) {
      return a.vout - b.vout;
    }
    if (a.derivationPath !== b.derivationPath) {
      return a.derivationPath < b.derivationPath ? -1 : 1;
    }
    return 0;
  });
}

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
  const canonical = canonicalizeUtxos(utxos);
  const forNative = canonical.map(u => ({
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
