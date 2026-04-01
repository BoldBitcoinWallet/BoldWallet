import React, {createContext, useContext, useState, useEffect} from 'react';
import {NativeModules} from 'react-native';
import {dbg, getReceivePath, isLegacyWallet, getKeyshareMetadata} from '../utils';
import appConfigRepository, {CONFIG_KEYS} from '../services/repositories/AppConfigRepository';
import {resolveStoredMempoolApiBase} from '../services/mempoolApiBase';
import {getExternalIndex} from '../services/HdIndexService';
const {BBMTLibNativeModule} = NativeModules;
interface WalletContextType {
  address: string;
  baseApi: string;
  network: string;
  addressType: string;
  setAddressType: (type: string) => void;
  refreshWallet: () => Promise<void>;
}
const WalletContext = createContext<WalletContextType | undefined>(undefined);
export const WalletProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [address, setAddress] = useState<string>('');
  const [baseApi, setBaseApi] = useState<string>('');
  const [network, setNetwork] = useState<string>('mainnet');
  const [addressType, setAddressType] = useState<string>('legacy');
  const handleAddressTypeChange = async (type: string) => {
    try {
      dbg('WalletContext: Changing address type to:', type);
      appConfigRepository.set(CONFIG_KEYS.ADDRESS_TYPE, type);
      setAddressType(type);
      await refreshWallet();
    } catch (error) {
      dbg('WalletContext: Error changing address type:', error);
    }
  };
  const refreshWallet = async () => {
    try {
      dbg('WalletContext: Starting wallet refresh');
      const ks = await getKeyshareMetadata();
      if (!ks) {
        dbg('WalletContext: No keyshare found, skipping wallet refresh');
        return;
      }
      let net = appConfigRepository.get(CONFIG_KEYS.NETWORK) || 'mainnet';
      if (!appConfigRepository.get(CONFIG_KEYS.NETWORK)) {
        appConfigRepository.set(CONFIG_KEYS.NETWORK, net);
      }
      dbg('WalletContext: Current network:', net);
      const storedAddressType = appConfigRepository.get(CONFIG_KEYS.ADDRESS_TYPE);
      const currentAddressType = (storedAddressType as string) || 'segwit-native';
      // Check if this is a legacy wallet (created before migration timestamp)
      const useLegacyPath = isLegacyWallet(ks.created_at);
      const externalIndex = await getExternalIndex(net, currentAddressType);
      const path = getReceivePath(net, currentAddressType, useLegacyPath, externalIndex);
      dbg('WalletContext: Using derivation path (external index ' + externalIndex + '):', path);
      // Set network in native module first
      const netParams = await BBMTLibNativeModule.setBtcNetwork(net);
      net = netParams.split('@')[0];
      dbg('WalletContext: Network set in native module:', net);
      // Address type already loaded above, just set it
      setAddressType(currentAddressType);
      dbg('WalletContext: Current address type:', currentAddressType);
      // Derive public key
      const btcPub = await BBMTLibNativeModule.derivePubkey(
        ks.pub_key,
        ks.chain_code_hex,
        path,
      );
      dbg('WalletContext: Derived public key');
      // Generate address based on current type and network
      const btcAddress = await BBMTLibNativeModule.btcAddress(
        btcPub,
        net,
        currentAddressType,
      );
      dbg('WalletContext: Generated address:', btcAddress);
      // Update state
      setAddress(btcAddress);
      setNetwork(net!!);
      const apiRaw = resolveStoredMempoolApiBase(net);
      const api = apiRaw.endsWith('/')
        ? apiRaw.substring(0, apiRaw.length - 1)
        : apiRaw;
      dbg('WalletContext: Resolved Mempool API URL:', api);
      appConfigRepository.set(`api_${net}`, api);
      appConfigRepository.set('api', api);
      await BBMTLibNativeModule.setAPI(net, api);
      setBaseApi(api);
      dbg('WalletContext: Wallet refresh completed');
    } catch (error) {
      dbg('WalletContext: Error refreshing wallet:', error);
    }
  };
  useEffect(() => {
    const initWallet = async () => {
      const meta = await getKeyshareMetadata();
      if (!meta) {
        dbg('WalletContext: No keyshare found, skipping initialization');
        return;
      }
      await refreshWallet();
    };
    initWallet();
  }, []);
  return (
    <WalletContext.Provider
      value={{
        address,
        baseApi,
        network,
        addressType,
        setAddressType: handleAddressTypeChange,
        refreshWallet,
      }}>
      {children}
    </WalletContext.Provider>
  );
};
export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
