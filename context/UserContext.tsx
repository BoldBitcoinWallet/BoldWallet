import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import EncryptedStorage from 'react-native-encrypted-storage';
import LocalCache from '../services/LocalCache';
import {BBMTLibNativeModule} from '../native_modules';
import { getDerivePathForNetwork, isLegacyWallet } from '../utils';

type AddressType = 'legacy' | 'segwit-native' | 'segwit-compatible';

interface UserContextType {
  btcPub: string;
  legacyMainnetAddress: string;
  segwitNativeMainnetAddress: string;
  segwitCompatibleMainnetAddress: string;
  legacyTestnetAddress: string;
  segwitNativeTestnetAddress: string;
  segwitCompatibleTestnetAddress: string;

  activeNetwork: string;
  activeAddressType: AddressType;
  activeAddress: string;
  activeApiProvider: string;

  setActiveNetwork: (newNetwork: string) => Promise<void>;
  setActiveAddressType: (newType: AddressType) => Promise<void>;
  setActiveApiProvider: (newApi: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  // Network/API state (moved from NetworkContext)
  const [network, setNetwork] = useState<string>('mainnet');
  const [apiBase, setApiBase] = useState<string>('');
  const [btcPub, setBtcPub] = useState<string>('');

  // Derived addresses for both networks
  const [legacyMainnetAddress, setLegacyMainnetAddress] = useState<string>('');
  const [segwitNativeMainnetAddress, setSegwitNativeMainnetAddress] = useState<string>('');
  const [segwitCompatibleMainnetAddress, setSegwitCompatibleMainnetAddress] = useState<string>('');
  const [legacyTestnetAddress, setLegacyTestnetAddress] = useState<string>('');
  const [segwitNativeTestnetAddress, setSegwitNativeTestnetAddress] = useState<string>('');
  const [segwitCompatibleTestnetAddress, setSegwitCompatibleTestnetAddress] = useState<string>('');

  const [activeAddressType, setActiveAddressTypeState] = useState<AddressType>('legacy');

  // Compute the currently active address based on active network + address type
  const activeAddress = useMemo(() => {
    const isTestnet = network !== 'mainnet';
    if (activeAddressType === 'legacy') {
      return isTestnet ? legacyTestnetAddress : legacyMainnetAddress;
    }
    if (activeAddressType === 'segwit-native') {
      return isTestnet ? segwitNativeTestnetAddress : segwitNativeMainnetAddress;
    }
    if (activeAddressType === 'segwit-compatible') {
      return isTestnet ? segwitCompatibleTestnetAddress : segwitCompatibleMainnetAddress;
    }
    return '';
  }, [network, activeAddressType, legacyMainnetAddress, segwitNativeMainnetAddress, segwitCompatibleMainnetAddress, legacyTestnetAddress, segwitNativeTestnetAddress, segwitCompatibleTestnetAddress]);

  // Ensure native module knows about network/api when they change
  useEffect(() => {
    const syncApi = async () => {
      try {
        if (!network || !apiBase) return;
        await BBMTLibNativeModule.setAPI(network, apiBase);
      } catch {
        // no-op
      }
    };
    syncApi();
  }, [network, apiBase]);

  // Initialize network/api from cache (migrated from NetworkContext)
  useEffect(() => {
    const initializeNetwork = async () => {
      try {
        const net = (await LocalCache.getItem('network')) || 'mainnet';
        setNetwork(net);

        let api = await LocalCache.getItem(`api_${net}`);
        if (!api) {
          api = (await LocalCache.getItem('api')) || (net === 'testnet3' ? 'https://mempool.space/testnet/api' : 'https://mempool.space/api');
          await LocalCache.setItem('api', api);
          await LocalCache.setItem(`api_${net}`, api);
        }

        setApiBase(api);
        await BBMTLibNativeModule.setAPI(net, api);
      } catch {
        // no-op
      }
    };
    initializeNetwork();
  }, []);

  const deriveAllAddressesForNetwork = useCallback(async (pub: string, net: string) => {
    const isTestnet = net !== 'mainnet';
    const [legacy, segwitNative, segwitCompatible] = await Promise.all([
      BBMTLibNativeModule.btcAddress(pub, net, 'legacy'),
      BBMTLibNativeModule.btcAddress(pub, net, 'segwit-native'),
      BBMTLibNativeModule.btcAddress(pub, net, 'segwit-compatible'),
    ]);
    if (isTestnet) {
      setLegacyTestnetAddress(legacy);
      setSegwitNativeTestnetAddress(segwitNative);
      setSegwitCompatibleTestnetAddress(segwitCompatible);
    } else {
      setLegacyMainnetAddress(legacy);
      setSegwitNativeMainnetAddress(segwitNative);
      setSegwitCompatibleMainnetAddress(segwitCompatible);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      // Load address type
      const storedType = (await LocalCache.getItem('addressType')) as AddressType | null;
      const currentAddressType = (storedType as AddressType) || 'segwit-native';
      setActiveAddressTypeState(currentAddressType);

      // Load/derive btcPub
      let pub = (await EncryptedStorage.getItem('btcPub')) || '';
      if (!pub) {
        const jks = await EncryptedStorage.getItem('keyshare');
        if (jks) {
          const ks = JSON.parse(jks);
          // Check if this is a legacy wallet (created before migration timestamp)
          const useLegacyPath = isLegacyWallet(ks.created_at);
          // Use derivation path that matches the address type (or legacy path for old wallets)
          const path = getDerivePathForNetwork(network, currentAddressType, useLegacyPath);
          pub = await BBMTLibNativeModule.derivePubkey(
            ks.pub_key,
            ks.chain_code_hex,
            path,
          );
          await EncryptedStorage.setItem('btcPub', pub);
        }
      }
      setBtcPub(pub);

      if (pub) {
        // Ensure native network is set; returns "<net>@<api>"
        const netParams = await BBMTLibNativeModule.setBtcNetwork(network);
        const actualNet = netParams.split('@')[0];

        // Derive for current network and the other network for fast switching
        await deriveAllAddressesForNetwork(pub, actualNet);
        const otherNet = actualNet === 'mainnet' ? 'testnet3' : 'mainnet';
        await deriveAllAddressesForNetwork(pub, otherNet);
      }
    } catch {
      // no-op
    }
  }, [network, deriveAllAddressesForNetwork]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSetActiveNetwork = useCallback(async (newNetwork: string) => {
    try {
      // Save current API for the current network before switching
      const currentApi = apiBase;
      if (currentApi) {
        await LocalCache.setItem(`api_${network}`, currentApi);
      }

      // Cache the new network
      await LocalCache.setItem('network', newNetwork);

      // Try to get the previously selected API for this network, fallback to default
      let nextApi = await LocalCache.getItem(`api_${newNetwork}`);
      if (!nextApi) {
        nextApi = newNetwork === 'testnet3' ? 'https://mempool.space/testnet/api' : 'https://mempool.space/api';
      }

      // Cache and update state
      await LocalCache.setItem(`api_${newNetwork}`, nextApi);
      await LocalCache.setItem('api', nextApi);
      setNetwork(newNetwork);
      setApiBase(nextApi);

      // Update native module
      await BBMTLibNativeModule.setAPI(newNetwork, nextApi);
    } catch {
      // no-op
    }
  }, [apiBase, network]);

  const handleSetActiveAddressType = useCallback(async (newType: AddressType) => {
    await LocalCache.setItem('addressType', newType);
    setActiveAddressTypeState(newType);
    if (activeAddress) {
      await LocalCache.setItem('currentAddress', activeAddress);
    }
  }, [activeAddress]);

  const handleSetActiveApiProvider = useCallback(async (newApi: string) => {
    try {
      await LocalCache.setItem(`api_${network}`, newApi);
      await LocalCache.setItem('api', newApi);
      setApiBase(newApi);
      await BBMTLibNativeModule.setAPI(network, newApi);
    } catch {
      // no-op
    }
  }, [network]);

  const value: UserContextType = {
    btcPub,
    legacyMainnetAddress,
    segwitNativeMainnetAddress,
    segwitCompatibleMainnetAddress,
    legacyTestnetAddress,
    segwitNativeTestnetAddress,
    segwitCompatibleTestnetAddress,
    activeNetwork: network,
    activeAddressType,
    activeAddress,
    activeApiProvider: apiBase,
    setActiveNetwork: handleSetActiveNetwork,
    setActiveAddressType: handleSetActiveAddressType,
    setActiveApiProvider: handleSetActiveApiProvider,
    refresh,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export const useUser = (): UserContextType => {
  const ctx = useContext(UserContext);
  if (ctx === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return ctx;
};


