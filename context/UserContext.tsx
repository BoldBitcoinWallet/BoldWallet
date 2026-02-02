import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import EncryptedStorage from 'react-native-encrypted-storage';
import LocalCache from '../services/LocalCache';
import {BBMTLibNativeModule} from '../native_modules';
import {getDerivePathForNetwork, isLegacyWallet, dbg} from '../utils';
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
  /** When true, show amounts in sats (₿) for &lt; 1 BTC; when false, show all in BTC (X.XXXX BTC). Toggle in WalletHome; used app-wide. */
  showSats: boolean;
  setShowSats: (value: boolean) => Promise<void>;
  /** When true, use formatted numbers (thousand separators); when false, raw numbers. From Settings > Raw Numbers. */
  balanceFormattingEnabled: boolean;
  setBalanceFormattingEnabled: (value: boolean) => Promise<void>;
}
const UserContext = createContext<UserContextType | undefined>(undefined);
export const UserProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  // Network/API state (moved from NetworkContext)
  const [network, setNetwork] = useState<string>('mainnet');
  const [apiBase, setApiBase] = useState<string>('');
  const [btcPub, setBtcPub] = useState<string>('');
  // Derived addresses for both networks
  const [legacyMainnetAddress, setLegacyMainnetAddress] = useState<string>('');
  const [segwitNativeMainnetAddress, setSegwitNativeMainnetAddress] =
    useState<string>('');
  const [segwitCompatibleMainnetAddress, setSegwitCompatibleMainnetAddress] =
    useState<string>('');
  const [legacyTestnetAddress, setLegacyTestnetAddress] = useState<string>('');
  const [segwitNativeTestnetAddress, setSegwitNativeTestnetAddress] =
    useState<string>('');
  const [segwitCompatibleTestnetAddress, setSegwitCompatibleTestnetAddress] =
    useState<string>('');
  const [activeAddressType, setActiveAddressTypeState] =
    useState<AddressType>('legacy');
  const [showSats, setShowSatsState] = useState<boolean>(false);
  const [balanceFormattingEnabled, setBalanceFormattingEnabledState] =
    useState<boolean>(false);
  // Compute the currently active address based on active network + address type
  const activeAddress = useMemo(() => {
    const isTestnet = network !== 'mainnet';
    let computedAddress = '';
    if (activeAddressType === 'legacy') {
      computedAddress = isTestnet ? legacyTestnetAddress : legacyMainnetAddress;
    } else if (activeAddressType === 'segwit-native') {
      computedAddress = isTestnet
        ? segwitNativeTestnetAddress
        : segwitNativeMainnetAddress;
    } else if (activeAddressType === 'segwit-compatible') {
      computedAddress = isTestnet
        ? segwitCompatibleTestnetAddress
        : segwitCompatibleMainnetAddress;
    }
    // Log address computation for debugging
    dbg(`[UserContext] activeAddress computed:`, {
      timestamp: Date.now(),
      network,
      activeAddressType,
      isTestnet,
      computedAddress: computedAddress
        ? `${computedAddress.substring(0, 8)}...${computedAddress.substring(
            computedAddress.length - 8,
          )}`
        : 'EMPTY',
      legacyMainnet: legacyMainnetAddress
        ? `${legacyMainnetAddress.substring(0, 8)}...`
        : 'EMPTY',
      segwitMainnet: segwitNativeMainnetAddress
        ? `${segwitNativeMainnetAddress.substring(0, 8)}...`
        : 'EMPTY',
      legacyTestnet: legacyTestnetAddress
        ? `${legacyTestnetAddress.substring(0, 8)}...`
        : 'EMPTY',
      segwitTestnet: segwitNativeTestnetAddress
        ? `${segwitNativeTestnetAddress.substring(0, 8)}...`
        : 'EMPTY',
    });
    return computedAddress;
  }, [
    network,
    activeAddressType,
    legacyMainnetAddress,
    segwitNativeMainnetAddress,
    segwitCompatibleMainnetAddress,
    legacyTestnetAddress,
    segwitNativeTestnetAddress,
    segwitCompatibleTestnetAddress,
  ]);
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
  // Load Bitcoin display preference (sats vs BTC)
  useEffect(() => {
    const loadShowSats = async () => {
      try {
        const stored = await EncryptedStorage.getItem('bitcoin_display_sats');
        setShowSatsState(stored === 'true');
      } catch {
        setShowSatsState(false);
      }
    };
    loadShowSats();
  }, []);
  // Load balance formatting preference (Settings: Raw Numbers vs Formatted)
  useEffect(() => {
    const loadBalanceFormatting = async () => {
      try {
        const stored = await EncryptedStorage.getItem('balance_formatting_enabled');
        setBalanceFormattingEnabledState(stored === 'true');
      } catch {
        setBalanceFormattingEnabledState(false);
      }
    };
    loadBalanceFormatting();
  }, []);
  // Initialize network/api from cache (migrated from NetworkContext)
  useEffect(() => {
    const initializeNetwork = async () => {
      try {
        const net = (await LocalCache.getItem('network')) || 'mainnet';
        setNetwork(net);
        let api = await LocalCache.getItem(`api_${net}`);
        if (!api) {
          api =
            (await LocalCache.getItem('api')) ||
            (net === 'testnet3'
              ? 'https://mempool.space/testnet/api'
              : 'https://mempool.space/api');
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
  const deriveAllAddressesForNetwork = useCallback(
    async (pub: string, net: string) => {
      const isTestnet = net !== 'mainnet';
      const startTime = Date.now();
      dbg(`[UserContext] deriveAllAddressesForNetwork START:`, {
        timestamp: startTime,
        network: net,
        isTestnet,
        pubPrefix: pub ? `${pub.substring(0, 16)}...` : 'EMPTY',
      });
      const [legacy, segwitNative, segwitCompatible] = await Promise.all([
        BBMTLibNativeModule.btcAddress(pub, net, 'legacy'),
        BBMTLibNativeModule.btcAddress(pub, net, 'segwit-native'),
        BBMTLibNativeModule.btcAddress(pub, net, 'segwit-compatible'),
      ]);
      const endTime = Date.now();
      dbg(`[UserContext] deriveAllAddressesForNetwork COMPLETE:`, {
        timestamp: endTime,
        duration: endTime - startTime,
        network: net,
        legacy: legacy
          ? `${legacy.substring(0, 8)}...${legacy.substring(legacy.length - 8)}`
          : 'EMPTY',
        segwitNative: segwitNative
          ? `${segwitNative.substring(0, 8)}...${segwitNative.substring(
              segwitNative.length - 8,
            )}`
          : 'EMPTY',
        segwitCompatible: segwitCompatible
          ? `${segwitCompatible.substring(0, 8)}...${segwitCompatible.substring(
              segwitCompatible.length - 8,
            )}`
          : 'EMPTY',
      });
      if (isTestnet) {
        dbg(`[UserContext] Setting TESTNET addresses:`, {
          timestamp: Date.now(),
          legacy: legacy ? `${legacy.substring(0, 8)}...` : 'EMPTY',
          segwitNative: segwitNative
            ? `${segwitNative.substring(0, 8)}...`
            : 'EMPTY',
        });
        setLegacyTestnetAddress(legacy);
        setSegwitNativeTestnetAddress(segwitNative);
        setSegwitCompatibleTestnetAddress(segwitCompatible);
      } else {
        dbg(`[UserContext] Setting MAINNET addresses:`, {
          timestamp: Date.now(),
          legacy: legacy ? `${legacy.substring(0, 8)}...` : 'EMPTY',
          segwitNative: segwitNative
            ? `${segwitNative.substring(0, 8)}...`
            : 'EMPTY',
        });
        setLegacyMainnetAddress(legacy);
        setSegwitNativeMainnetAddress(segwitNative);
        setSegwitCompatibleMainnetAddress(segwitCompatible);
      }
    },
    [],
  );
  const refresh = useCallback(async () => {
    const refreshStartTime = Date.now();
    dbg(`[UserContext] refresh() START:`, {
      timestamp: refreshStartTime,
      network,
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join(' -> '),
    });
    try {
      // Load address type
      const storedType = (await LocalCache.getItem(
        'addressType',
      )) as AddressType | null;
      const currentAddressType = (storedType as AddressType) || 'segwit-native';
      dbg(`[UserContext] refresh() - Address type loaded:`, {
        timestamp: Date.now(),
        storedType,
        currentAddressType,
        network,
      });
      setActiveAddressTypeState(currentAddressType);
      // Always derive btcPub fresh to ensure it matches the current address type
      // This prevents issues where stored btcPub was derived with a different address type
      let pub = '';
      let ks: any = null;
      const jks = await EncryptedStorage.getItem('keyshare');
      if (jks) {
        ks = JSON.parse(jks);
        // Check if this is a legacy wallet (created before migration timestamp)
        const useLegacyPath = isLegacyWallet(ks.created_at);
        // Use derivation path that matches the address type (or legacy path for old wallets)
        const path = getDerivePathForNetwork(
          network,
          currentAddressType,
          useLegacyPath,
        );
        dbg(`[UserContext] refresh() - Deriving btcPub:`, {
          timestamp: Date.now(),
          network,
          currentAddressType,
          useLegacyPath,
          path,
        });
        pub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          path,
        );
        // Store it for future use (though we'll always derive fresh to ensure consistency)
        if (pub) {
          await EncryptedStorage.setItem('btcPub', pub);
          dbg(`[UserContext] refresh() - btcPub derived and stored:`, {
            timestamp: Date.now(),
            pubPrefix: pub.substring(0, 16),
          });
        }
      }
      setBtcPub(pub);
      if (pub && ks) {
        // Ensure native network is set; returns "<net>@<api>"
        const netParams = await BBMTLibNativeModule.setBtcNetwork(network);
        const actualNet = netParams.split('@')[0];
        dbg(`[UserContext] refresh() - Network set, deriving addresses:`, {
          timestamp: Date.now(),
          network,
          actualNet,
        });
        // CRITICAL: btcPub is network-specific (derivation path includes coin type)
        // Only generate addresses for the CURRENT network using the CURRENT network's btcPub
        await deriveAllAddressesForNetwork(pub, actualNet);
        // For the other network, we need to derive a separate btcPub with that network's path
        // because btcPub is network-specific (derivation path includes coin type: 0' for mainnet, 1' for testnet)
        const otherNet = actualNet === 'mainnet' ? 'testnet3' : 'mainnet';
        const useLegacyPathOther = isLegacyWallet(ks.created_at);
        const otherPath = getDerivePathForNetwork(
          otherNet,
          currentAddressType,
          useLegacyPathOther,
        );
        const otherPub = await BBMTLibNativeModule.derivePubkey(
          ks.pub_key,
          ks.chain_code_hex,
          otherPath,
        );
        dbg(`[UserContext] refresh() - Derived btcPub for other network:`, {
          timestamp: Date.now(),
          otherNet,
          otherPath,
          pubPrefix: otherPub ? otherPub.substring(0, 16) : 'EMPTY',
        });
        if (otherPub) {
          await deriveAllAddressesForNetwork(otherPub, otherNet);
        }
      }
      const refreshEndTime = Date.now();
      dbg(`[UserContext] refresh() COMPLETE:`, {
        timestamp: refreshEndTime,
        duration: refreshEndTime - refreshStartTime,
        network,
        currentAddressType,
      });
    } catch (error) {
      dbg(`[UserContext] refresh() ERROR:`, {
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }, [network, deriveAllAddressesForNetwork]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const handleSetActiveNetwork = useCallback(
    async (newNetwork: string) => {
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
          nextApi =
            newNetwork === 'testnet3'
              ? 'https://mempool.space/testnet/api'
              : 'https://mempool.space/api';
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
    },
    [apiBase, network],
  );
  const handleSetActiveAddressType = useCallback(
    async (newType: AddressType) => {
      await LocalCache.setItem('addressType', newType);
      setActiveAddressTypeState(newType);
      // Clear cached btcPub so it will be re-derived with the new address type
      await EncryptedStorage.removeItem('btcPub');
      // Refresh to derive new addresses with the new address type
      await refresh();
      if (activeAddress) {
        await LocalCache.setItem('currentAddress', activeAddress);
      }
    },
    [activeAddress, refresh],
  );
  const handleSetActiveApiProvider = useCallback(
    async (newApi: string) => {
      try {
        await LocalCache.setItem(`api_${network}`, newApi);
        await LocalCache.setItem('api', newApi);
        setApiBase(newApi);
        await BBMTLibNativeModule.setAPI(network, newApi);
      } catch {
        // no-op
      }
    },
    [network],
  );
  const setShowSats = useCallback(async (value: boolean) => {
    setShowSatsState(value);
    try {
      await EncryptedStorage.setItem('bitcoin_display_sats', value ? 'true' : 'false');
    } catch {
      // no-op
    }
  }, []);
  const setBalanceFormattingEnabled = useCallback(async (value: boolean) => {
    setBalanceFormattingEnabledState(value);
    try {
      await EncryptedStorage.setItem('balance_formatting_enabled', value ? 'true' : 'false');
    } catch {
      // no-op
    }
  }, []);
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
    showSats,
    setShowSats,
    balanceFormattingEnabled,
    setBalanceFormattingEnabled,
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
