import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import EncryptedStorage from 'react-native-encrypted-storage';
import appConfigRepository, {CONFIG_KEYS} from '../services/repositories/AppConfigRepository';
import {BBMTLibNativeModule} from '../native_modules';
import {getReceivePath, isLegacyWallet, dbg, getKeyshareMetadata} from '../utils';
import {getExternalIndex} from '../services/HdIndexService';
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
  /** When true (and on mainnet), show the Play (mempool playground) tab. From Settings. Default off. */
  showMempoolPlayground: boolean;
  setShowMempoolPlayground: (value: boolean) => Promise<void>;
  /** When true, show the UTXOs tab. From Settings. Default off. */
  showUtxosTab: boolean;
  setShowUtxosTab: (value: boolean) => Promise<void>;
  /** When true, show the Addresses tab. From Settings. Default off. */
  showAddressesTab: boolean;
  setShowAddressesTab: (value: boolean) => Promise<void>;
  /** When true, show the PSBT tab. From Settings. Default off. */
  showPsbtTab: boolean;
  setShowPsbtTab: (value: boolean) => Promise<void>;
  /** When true, show the Wallet tab. From Settings. Default on. */
  showWalletTab: boolean;
  setShowWalletTab: (value: boolean) => Promise<void>;
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
  const [showMempoolPlayground, setShowMempoolPlaygroundState] =
    useState<boolean>(false);
  const [showUtxosTab, setShowUtxosTabState] = useState<boolean>(false);
  const [showAddressesTab, setShowAddressesTabState] = useState<boolean>(false);
  const [showPsbtTab, setShowPsbtTabState] = useState<boolean>(false);
  const [showWalletTab, setShowWalletTabState] = useState<boolean>(true);
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
  // Load tab preferences from SQLite (synchronous reads)
  useEffect(() => {
    try {
      setShowMempoolPlaygroundState(appConfigRepository.getBool(CONFIG_KEYS.TAB_MEMPOOL_ENABLED, false));
      setShowUtxosTabState(appConfigRepository.getBool(CONFIG_KEYS.TAB_UTXOS_ENABLED, false));
      setShowAddressesTabState(
        appConfigRepository.getBool(CONFIG_KEYS.TAB_ADDRESSES_ENABLED, false),
      );
      setShowPsbtTabState(appConfigRepository.getBool(CONFIG_KEYS.TAB_PSBT_ENABLED, false));
      const walletEnabled = appConfigRepository.get(CONFIG_KEYS.TAB_WALLET_ENABLED);
      setShowWalletTabState(walletEnabled !== 'false');
    } catch {
      // defaults already set by useState
    }
  }, []);
  // Initialize network/api from SQLite (synchronous reads)
  useEffect(() => {
    const initializeNetwork = async () => {
      try {
        const net = appConfigRepository.get(CONFIG_KEYS.NETWORK) || 'mainnet';
        setNetwork(net);
        let api = appConfigRepository.get(`api_${net}`) || appConfigRepository.get('api');
        if (!api) {
          api = net === 'testnet3'
            ? 'https://mempool.space/testnet/api'
            : 'https://mempool.space/api';
          appConfigRepository.set('api', api);
          appConfigRepository.set(`api_${net}`, api);
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
      const storedType = appConfigRepository.get(CONFIG_KEYS.ADDRESS_TYPE) as AddressType | null;
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
      const ks = await getKeyshareMetadata();
      if (ks) {
        // Check if this is a legacy wallet (created before migration timestamp)
        const useLegacyPath = isLegacyWallet(ks.created_at);
        const externalIndex = await getExternalIndex(network, currentAddressType);
        // Use receive path at current external index (HD: no address reuse)
        const path = getReceivePath(
          network,
          currentAddressType,
          useLegacyPath,
          externalIndex,
        );
        dbg(`[UserContext] refresh() - Deriving btcPub:`, {
          timestamp: Date.now(),
          network,
          currentAddressType,
          useLegacyPath,
          externalIndex,
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
        const otherExternalIndex = await getExternalIndex(otherNet, currentAddressType);
        const otherPath = getReceivePath(
          otherNet,
          currentAddressType,
          useLegacyPathOther,
          otherExternalIndex,
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
        if (apiBase) {
          appConfigRepository.set(`api_${network}`, apiBase);
        }
        appConfigRepository.set(CONFIG_KEYS.NETWORK, newNetwork);
        let nextApi = appConfigRepository.get(`api_${newNetwork}`);
        if (!nextApi) {
          nextApi =
            newNetwork === 'testnet3'
              ? 'https://mempool.space/testnet/api'
              : 'https://mempool.space/api';
        }
        appConfigRepository.set(`api_${newNetwork}`, nextApi);
        appConfigRepository.set('api', nextApi);
        setNetwork(newNetwork);
        setApiBase(nextApi);
        await BBMTLibNativeModule.setAPI(newNetwork, nextApi);
      } catch {
        // no-op
      }
    },
    [apiBase, network],
  );
  const handleSetActiveAddressType = useCallback(
    async (newType: AddressType) => {
      appConfigRepository.set(CONFIG_KEYS.ADDRESS_TYPE, newType);
      setActiveAddressTypeState(newType);
      await EncryptedStorage.removeItem('btcPub');
      await refresh();
      if (activeAddress) {
        appConfigRepository.set(CONFIG_KEYS.CURRENT_ADDRESS, activeAddress);
      }
    },
    [activeAddress, refresh],
  );
  const handleSetActiveApiProvider = useCallback(
    async (newApi: string) => {
      try {
        appConfigRepository.set(`api_${network}`, newApi);
        appConfigRepository.set('api', newApi);
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
  const setShowMempoolPlayground = useCallback(async (value: boolean) => {
    setShowMempoolPlaygroundState(value);
    appConfigRepository.setBool(CONFIG_KEYS.TAB_MEMPOOL_ENABLED, value);
  }, []);
  const setShowUtxosTab = useCallback(async (value: boolean) => {
    setShowUtxosTabState(value);
    appConfigRepository.setBool(CONFIG_KEYS.TAB_UTXOS_ENABLED, value);
  }, []);
  const setShowAddressesTab = useCallback(async (value: boolean) => {
    setShowAddressesTabState(value);
    appConfigRepository.setBool(CONFIG_KEYS.TAB_ADDRESSES_ENABLED, value);
  }, []);
  const setShowPsbtTab = useCallback(async (value: boolean) => {
    setShowPsbtTabState(value);
    appConfigRepository.setBool(CONFIG_KEYS.TAB_PSBT_ENABLED, value);
  }, []);
  const setShowWalletTab = useCallback(async (value: boolean) => {
    setShowWalletTabState(value);
    appConfigRepository.setBool(CONFIG_KEYS.TAB_WALLET_ENABLED, value);
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
    showMempoolPlayground,
    setShowMempoolPlayground,
    showUtxosTab,
    setShowUtxosTab,
    showAddressesTab,
    setShowAddressesTab,
    showPsbtTab,
    setShowPsbtTab,
    showWalletTab,
    setShowWalletTab,
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
