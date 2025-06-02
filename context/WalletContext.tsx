import React, {createContext, useContext, useState, useEffect} from 'react';
import EncryptedStorage from 'react-native-encrypted-storage';
import {NativeModules} from 'react-native';

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

  const refreshWallet = async () => {
    try {
      const jks = await EncryptedStorage.getItem('keyshare');
      const ks = JSON.parse(jks || '{}');
      const path = "m/44'/0'/0'/0/0";
      const btcPub = await BBMTLibNativeModule.derivePubkey(
        ks.pub_key,
        ks.chain_code_hex,
        path,
      );

      let net = await EncryptedStorage.getItem('network');
      if (!net) {
        net = 'mainnet';
        await EncryptedStorage.setItem('network', net);
      }

      const netParams = await BBMTLibNativeModule.setBtcNetwork(net);
      net = netParams.split('@')[0];

      // Get current address type
      const storedAddressType = await EncryptedStorage.getItem('addressType');
      setAddressType((storedAddressType as string) || 'legacy');

      // Generate address based on current type
      const btcAddress = await BBMTLibNativeModule.btcAddress(
        btcPub,
        net,
        (storedAddressType as string) || 'legacy',
      );

      setAddress(btcAddress);
      setNetwork(net || 'mainnet');

      // Override APIs if set
      let base = netParams.split('@')[1];
      // Ensure base URL ends with a slash
      if (base.endsWith('/')) {
        base = base.substring(0, base.length - 1);
      }
      let api = await EncryptedStorage.getItem('api');
      if (api) {
        // Ensure API URL ends with a slash
        if (api.endsWith('/')) {
          api = api.substring(0, api.length - 1);
        }
        BBMTLibNativeModule.setAPI(net, api);
        setBaseApi(api);
      } else {
        await EncryptedStorage.setItem('api', base);
        setBaseApi(base);
      }
    } catch (error) {
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
        setAddressType,
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
