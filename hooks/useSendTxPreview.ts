import {useEffect, useState} from 'react';
import {WalletService} from '../services/WalletService';
import {
  normalizeNetworkKey,
  resolveStoredMempoolApiBase,
} from '../services/mempoolApiBase';
import type {TxPreview} from '../types/transactionFlow';

export type SendTxPreviewRouteParams = {
  network?: string;
  addressType?: string;
  utxosJson?: string;
  changeAddress?: string;
};

/** Path for a QR/route change address, not this device's next unused change index. */
export async function resolveChangeAddressDisplayPath(
  network: string,
  addressType: string,
  changeAddress: string,
): Promise<string> {
  const trimmed = changeAddress.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const addrs = await WalletService.getInstance().getHdAddressesWithPaths(
      network,
      addressType,
    );
    const match = addrs.find(
      a => a.chain === 'change' && a.address === trimmed,
    );
    return match?.derivationPath ?? '';
  } catch {
    return '';
  }
}

export function useSendTxPreview(
  enabled: boolean,
  routeParams: SendTxPreviewRouteParams | undefined,
): {
  preview: TxPreview | null;
  loading: boolean;
  error: string | null;
} {
  const [preview, setPreview] = useState<TxPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPreview(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const net = normalizeNetworkKey(
        (routeParams?.network || 'mainnet').trim(),
      );
      const addrType = (routeParams?.addressType || 'segwit-native').trim();
      try {
        const utxosFromQR = routeParams?.utxosJson;
        if (
          utxosFromQR &&
          typeof utxosFromQR === 'string' &&
          utxosFromQR.trim() !== ''
        ) {
          const parsed = JSON.parse(utxosFromQR) as Array<{
            txid: string;
            vout: number;
            value: number;
            derivation_path?: string;
            derivationPath?: string;
            address: string;
          }>;
          if (Array.isArray(parsed) && parsed.length > 0) {
            const totalInputSats = parsed.reduce(
              (s, u) => s + (u.value || 0),
              0,
            );
            const chgFromParams = routeParams?.changeAddress;
            let chgAddress = '';
            let chgPath = '';
            if (chgFromParams && chgFromParams.trim() !== '') {
              chgAddress = chgFromParams.trim();
              chgPath = await resolveChangeAddressDisplayPath(
                net,
                addrType,
                chgAddress,
              );
            } else {
              const r =
                await WalletService.getInstance().getNextChangeAddressWithPath(
                  net,
                  addrType,
                );
              chgAddress = r.address;
              chgPath = r.path;
            }
            if (!cancelled) {
              setPreview({
                utxos: parsed.map(u => ({
                  address: u.address,
                  value: u.value,
                  derivationPath: u.derivation_path ?? u.derivationPath ?? '',
                })),
                changeAddress: chgAddress,
                changeAddressPath: chgPath,
                totalInputSats,
              });
            }
            return;
          }
        }
        const apiUrl = resolveStoredMempoolApiBase(net);
        const [utxos, chgResult] = await Promise.all([
          WalletService.getInstance().fetchUtxosWithPaths(
            net,
            addrType,
            apiUrl,
          ),
          WalletService.getInstance().getNextChangeAddressWithPath(
            net,
            addrType,
          ),
        ]);
        if (!cancelled) {
          const totalInputSats = utxos.reduce((s, u) => s + u.value, 0);
          setPreview({
            utxos: utxos.map(u => ({
              address: u.address,
              value: u.value,
              derivationPath: u.derivationPath,
            })),
            changeAddress: chgResult?.address || '',
            changeAddressPath: chgResult?.path || '',
            totalInputSats,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load inputs');
          setPreview(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    routeParams?.network,
    routeParams?.addressType,
    routeParams?.utxosJson,
    routeParams?.changeAddress,
  ]);

  return {preview, loading, error};
}
