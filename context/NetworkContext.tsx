import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import appConfigRepository, {CONFIG_KEYS} from '../services/repositories/AppConfigRepository';
import { BBMTLibNativeModule } from '../native_modules';
import {dbg, getMainnetAPIList, getTestnetAPIList} from '../utils';
interface NetworkContextType {
  network: string;
  apiBase: string;
  updateNetwork: (newNetwork: string) => Promise<void>;
  updateAPI: (newAPI: string) => Promise<void>;
  refreshFromCache: () => Promise<void>;
}
const NetworkContext = createContext<NetworkContextType | undefined>(undefined);
export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [network, setNetwork] = useState<string>('mainnet');
  const [apiBase, setApiBase] = useState<string>('');
  // Refresh network and API from cache
  const refreshFromCache = useCallback(async () => {
    try {
      dbg('=== NetworkContext: Refreshing from cache');
      const net = appConfigRepository.get(CONFIG_KEYS.NETWORK);
      dbg('NetworkContext: Network from cache:', net);
      if (net) {
        setNetwork(net);
        let api = appConfigRepository.get(`api_${net}`) || appConfigRepository.get('api');
        dbg('NetworkContext: API from cache:', api);
        if (api) {
          setApiBase(api);
          await BBMTLibNativeModule.setAPI(net, api);
        }
      }
    } catch (error) {
      dbg('NetworkContext: Error refreshing from cache:', error);
    }
  }, []);
  // Update network and handle API switching
  const updateNetwork = useCallback(async (newNetwork: string) => {
    try {
      dbg('=== NetworkContext: Updating network to:', newNetwork);
      if (apiBase) {
        appConfigRepository.set(`api_${network}`, apiBase);
      }
      appConfigRepository.set(CONFIG_KEYS.NETWORK, newNetwork);
      let api = appConfigRepository.get(`api_${newNetwork}`);
      if (!api) {
        api = newNetwork === 'testnet3'
          ? 'https://mempool.space/testnet/api'
          : 'https://mempool.space/api';
      }
      appConfigRepository.set(`api_${newNetwork}`, api);
      appConfigRepository.set('api', api);
      setNetwork(newNetwork);
      setApiBase(api);
      await BBMTLibNativeModule.setAPI(newNetwork, api);
      const networkAPIs = newNetwork === 'mainnet'
        ? await getMainnetAPIList()
        : await getTestnetAPIList();
      await BBMTLibNativeModule.setFeeAPIs(networkAPIs.join(','));
      dbg('NetworkContext: Network update completed', newNetwork, api);
    } catch (error) {
      dbg('NetworkContext: Error updating network:', error);
    }
  }, [network, apiBase]);
  // Update API for current network
  const updateAPI = useCallback(async (newAPI: string) => {
    try {
      appConfigRepository.set(`api_${network}`, newAPI);
      appConfigRepository.set('api', newAPI);
      setApiBase(newAPI);
      await BBMTLibNativeModule.setAPI(network, newAPI);
      dbg('NetworkContext: API updated to:', newAPI);
    } catch (error) {
      dbg('NetworkContext: Error updating API:', error);
    }
  }, [network]);
  // Initialize from SQLite on mount
  useEffect(() => {
    const initializeContext = async () => {
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
        const networkAPIs = net === 'mainnet'
          ? await getMainnetAPIList()
          : await getTestnetAPIList();
        await BBMTLibNativeModule.setFeeAPIs(networkAPIs.join(','));
        dbg('NetworkContext: initialized', net, api);
      } catch (error) {
        dbg('NetworkContext: Error during initialization:', error);
      }
    };
    initializeContext();
  }, []);
  const value: NetworkContextType = {
    network,
    apiBase,
    updateNetwork,
    updateAPI,
    refreshFromCache,
  };
  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
};
export const useNetwork = (): NetworkContextType => {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};
