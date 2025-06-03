import React, {createContext, useContext, useState, useEffect} from 'react';
import EncryptedStorage from 'react-native-encrypted-storage';
import {NativeModules} from 'react-native';
import {dbg} from '../utils';

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
      await EncryptedStorage.setItem('addressType', type);
      setAddressType(type);
      // Refresh wallet to generate new address
      await refreshWallet();
    } catch (error) {
      dbg('WalletContext: Error changing address type:', error);
      console.error('Error changing address type:', error);
    }
  };

  const refreshWallet = async () => {
    try {
      dbg('WalletContext: Starting wallet refresh');
      const jks = await EncryptedStorage.getItem('keyshare');
      const ks = JSON.parse(jks || '{}');
      const path = "m/44'/0'/0'/0/0";

      // Get current network
      let net = await EncryptedStorage.getItem('network');
      if (!net) {
        net = 'mainnet';
        await EncryptedStorage.setItem('network', net);
      }
      dbg('WalletContext: Current network:', net);

      // Set network in native module first
      const netParams = await BBMTLibNativeModule.setBtcNetwork(net);
      net = netParams.split('@')[0];
      dbg('WalletContext: Network set in native module:', net);

      // Get current address type
      const storedAddressType = await EncryptedStorage.getItem('addressType');
      const currentAddressType = (storedAddressType as string) || 'legacy';
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

      // Handle API URL
      let base = netParams.split('@')[1];
      // Ensure base URL doesn't end with a slash
      if (base.endsWith('/')) {
        base = base.substring(0, base.length - 1);
      }

      let api = await EncryptedStorage.getItem('api');
      if (api) {
        // Ensure API URL doesn't end with a slash
        if (api.endsWith('/')) {
          api = api.substring(0, api.length - 1);
        }
        dbg('WalletContext: Using custom API URL:', api);
        await BBMTLibNativeModule.setAPI(net, api);
        setBaseApi(api);
      } else {
        dbg('WalletContext: Using default API URL:', base);
        await EncryptedStorage.setItem('api', base);
        setBaseApi(base);
      }

      dbg('WalletContext: Wallet refresh completed');
    } catch (error) {
      dbg('WalletContext: Error refreshing wallet:', error);
      console.error('Error refreshing wallet:', error);
    }
  };

  useEffect(() => {
    refreshWallet();
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
