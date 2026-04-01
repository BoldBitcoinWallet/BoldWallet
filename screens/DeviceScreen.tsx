import React, {useCallback, useState, useEffect} from 'react';
import {NativeModules} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import KeyshareInfoContent from '../components/KeyshareInfoContent';
import {useUser} from '../context/UserContext';
import {dbg, getKeyshareMetadata} from '../utils';
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
};

const DeviceScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const {activeNetwork: network, activeAddressType: addressType} = useUser();
  const [keyshareInfo, setKeyshareInfo] = useState<KeyshareInfo | null>(null);

  const openSettingsSection = useCallback(
    (section: string) => {
      navigation.navigate('Settings', {expandSection: section});
    },
    [navigation],
  );

  const loadKeyshareInfo = useCallback(async () => {
    try {
      const keyshare = await getKeyshareMetadata();
      if (!keyshare) {
        setKeyshareInfo(null);
        return;
      }
      const pubKey = keyshare.pub_key || '';
      const chainCode = keyshare.chain_code_hex || '';
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
      let label = 'KeyShare1';
      if (
        supportsNostr &&
        keyshare.local_party_key &&
        committeeKeys.length > 0
      ) {
        const sortedKeys = [...committeeKeys].sort();
        const localIndex = sortedKeys.findIndex(
          (key: string) => key === keyshare.local_party_key,
        );
        if (localIndex >= 0) {
          label = `KeyShare${localIndex + 1}`;
        }
      }
      const descriptors = await generateAllOutputDescriptors(
        BBMTLibNativeModule,
        pubKey,
        chainCode,
        network || 'mainnet',
        keyshare.created_at,
        addressType || 'segwit-native',
      );
      const outputDescriptors = {
        legacy: descriptors.legacy,
        segwitNative: descriptors.segwitNative,
        segwitCompatible: descriptors.segwitCompatible,
      };
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
      onOpenSettingsSection={openSettingsSection}
    />
  );
};

export default DeviceScreen;
