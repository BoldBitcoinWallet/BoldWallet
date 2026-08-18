import {normalizeNetworkKey, resolveStoredMempoolApiBase} from './mempoolApiBase';
import {WalletService, type UtxoWithPath} from './WalletService';
import utxoRepository from './repositories/UtxoRepository';
import {scriptPubKeyFromAddress} from '../utils/scriptPubKeyFromAddress';

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

function utxoOutpointKey(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

function scriptpubkeyOf(
  u: {scriptpubkey?: string; scriptPubkey?: string | null},
): string {
  return (u.scriptpubkey || u.scriptPubkey || '').trim();
}

function withScriptpubkey(
  u: UtxoWithPath,
  scriptpubkey: string,
): UtxoWithPath & {scriptpubkey: string} {
  return {...u, scriptpubkey};
}

function applyAddressDerivedScriptpubkeys(utxos: UtxoWithPath[]): UtxoWithPath[] {
  return utxos.map(u => {
    if (scriptpubkeyOf(u)) {
      return u;
    }
    const derived = scriptPubKeyFromAddress(u.address);
    return derived ? withScriptpubkey(u, derived) : u;
  });
}

/** Copy scriptpubkey onto QR-selected coins by txid+vout without changing selection order. */
function hydrateScriptpubkeysFrom(
  selected: UtxoWithPath[],
  source: Array<{
    txid: string;
    vout: number;
    scriptpubkey?: string;
    scriptPubkey?: string | null;
  }>,
): UtxoWithPath[] {
  const byOutpoint = new Map<string, string>();
  for (const u of source) {
    const spk = scriptpubkeyOf(u);
    if (spk) {
      byOutpoint.set(utxoOutpointKey(u.txid, u.vout), spk);
    }
  }
  if (byOutpoint.size === 0) {
    return selected;
  }
  return selected.map(u => {
    if (scriptpubkeyOf(u)) {
      return u;
    }
    const spk = byOutpoint.get(utxoOutpointKey(u.txid, u.vout));
    return spk ? withScriptpubkey(u, spk) : u;
  });
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

  if (utxos?.length && utxos.some(u => !scriptpubkeyOf(u))) {
    utxos = hydrateScriptpubkeysFrom(
      utxos,
      utxoRepository.getUtxosForNetwork(network, addressType),
    );
  }

  if (utxos?.length && utxos.some(u => !scriptpubkeyOf(u))) {
    utxos = applyAddressDerivedScriptpubkeys(utxos);
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

  if (utxos.some(u => !scriptpubkeyOf(u))) {
    utxos = applyAddressDerivedScriptpubkeys(utxos);
  }

  const missing = utxos.filter(
    u => !scriptpubkeyOf(u) && !(u.address || '').trim(),
  );
  let enriched: Array<UtxoWithPath & {scriptpubkey?: string}> = utxos;
  if (missing.length > 0) {
    const fetched = await ws.enrichUtxosWithScriptpubkey(missing, apiUrl);
    const byOutpoint = new Map(
      fetched.map(u => [utxoOutpointKey(u.txid, u.vout), u.scriptpubkey || '']),
    );
    enriched = utxos.map(u => {
      if (scriptpubkeyOf(u)) {
        return u;
      }
      return withScriptpubkey(
        u,
        byOutpoint.get(utxoOutpointKey(u.txid, u.vout)) || '',
      );
    });
  }

  return {
    utxosWithPathsJSON: utxosToNativeJson(enriched),
    changeAddress,
    apiUrl,
    network,
  };
}
