import React, {useCallback, useState, useEffect} from 'react';
import {NativeModules} from 'react-native';
import KeyshareInfoContent from '../components/KeyshareInfoContent';
import {useUser} from '../context/UserContext';
import {
  detectKeyshareTssBackend,
  getTssBackendDisplayLabel,
  type TssBackend,
} from '../services/tssBackend';
import {dbg, getKeyshareDisplayLabel, getKeyshare, getKeyshareMetadata} from '../utils';
import {generateAllOutputDescriptors} from '../utils';

const {BBMTLibNativeModule} = NativeModules;

type KeyshareInfo = {
  label: string;
  supportsLocal: boolean;
  supportsNostr: boolean;
  type: 'duo' | 'trio';
  pubKey: string;
  chainCode: string;
  fingerprint: string;
  outputDescriptors?: {
    legacy: string;
    segwitNative: string;
    segwitCompatible: string;
  };
  npub: string | null;
  createdAt?: number | null;
  tssBackend: TssBackend;
  tssBackendLabel: string;
};

const DeviceScreen: React.FC = () => {
  const {activeNetwork: network, activeAddressType: addressType} = useUser();
  const [keyshareInfo, setKeyshareInfo] = useState<KeyshareInfo | null>(null);

  const loadKeyshareInfo = useCallback(async () => {
    try {
      const blob: any = await (async () => {
        try {
          const full = await getKeyshare();
          if (full) {
            return full;
          }
        } catch {}
        return null;
      })();
      const keyshare = (blob as any) ?? (await getKeyshareMetadata());
      if (!keyshare) {
        setKeyshareInfo(null);
        return;
      }
      const pubKey = keyshare.pub_key || '';
      // Spec v2.1: chaincode from encrypted blob only, never SQLite metadata.
      // Metadata chain_code_hex is blanked (leak hardening); dice + skip wallets
      // both derive via the encrypted keyshare blob.
      const chainCode = String(
        (blob as any)?.chain_code_hex || (blob as any)?.chaincode || '',
      )
        .trim()
        .toLowerCase();
      const nostrNpub = keyshare.nostr_npub || null;
      const supportsNostr = !!(nostrNpub && nostrNpub.trim() !== '');
      const supportsLocal = true;
      let fingerprint = 'N/A';
      if (pubKey) {
        try {
          const pubKeyHash = await BBMTLibNativeModule.sha256(pubKey);
          fingerprint = pubKeyHash.substring(0, 8).toLowerCase();
        } catch (error) {
          dbg('Error calculating fingerprint:', error);
        }
      }
      const committeeKeys = keyshare.keygen_committee_keys || [];
      const type = committeeKeys.length === 3 ? 'trio' : 'duo';
      // Same label as Settings / backup filename: index from sorted committee keys (not Nostr-only).
      const label = getKeyshareDisplayLabel(keyshare) || 'KeyShare1';
      const descriptors = await generateAllOutputDescriptors(
        BBMTLibNativeModule,
        pubKey,
        chainCode,
        network || 'mainnet',
        keyshare,
        addressType || 'segwit-native',
      );
      const outputDescriptors = {
        legacy: descriptors.legacy,
        segwitNative: descriptors.segwitNative,
        segwitCompatible: descriptors.segwitCompatible,
      };
      const tssBackend = detectKeyshareTssBackend(
        keyshare as Record<string, unknown>,
      );
      setKeyshareInfo({
        label,
        supportsLocal,
        supportsNostr,
        type,
        pubKey,
        chainCode,
        fingerprint,
        outputDescriptors,
        npub: nostrNpub,
        createdAt: keyshare.created_at || null,
        tssBackend,
        tssBackendLabel: getTssBackendDisplayLabel(tssBackend),
      });
    } catch (error) {
      dbg('Error loading keyshare info:', error);
      setKeyshareInfo(null);
    }
  }, [network, addressType]);

  useEffect(() => {
    loadKeyshareInfo();
  }, [loadKeyshareInfo]);

  return (
    <KeyshareInfoContent
      keyshareInfo={keyshareInfo}
      network={(network as 'mainnet' | 'testnet') || 'mainnet'}
    />
  );
};

export default DeviceScreen;
