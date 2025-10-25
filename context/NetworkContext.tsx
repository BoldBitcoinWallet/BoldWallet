import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import LocalCache from '../services/LocalCache';
import { BBMTLibNativeModule } from '../native_modules';
import {dbg} from '../utils';

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
      
      // Get current network
      const net = await LocalCache.getItem('network');
      dbg('NetworkContext: Network from cache:', net);
      
      if (net) {
        setNetwork(net);
        dbg('NetworkContext: Network state updated to:', net);
        
        // Try to get network-specific API first, then fallback to general API
        let api = await LocalCache.getItem(`api_${net}`);
        if (!api) {
          api = await LocalCache.getItem('api');
          dbg('NetworkContext: No network-specific API, using general API:', api);
        } else {
          dbg('NetworkContext: Using network-specific API:', api);
        }
        
        if (api) {
          setApiBase(api);
          dbg('NetworkContext: API state updated to:', api);
          
          // Sync with native module
          await BBMTLibNativeModule.setAPI(net, api);
          dbg('NetworkContext: Native module synced with network:', net, 'API:', api);
        } else {
          dbg('NetworkContext: No API found in cache');
        }
      } else {
        dbg('NetworkContext: No network found in cache');
      }
    } catch (error) {
      dbg('NetworkContext: Error refreshing from cache:', error);
    }
  }, []);

  // Update network and handle API switching
  const updateNetwork = useCallback(async (newNetwork: string) => {
    try {
      dbg('=== NetworkContext: Updating network to:', newNetwork);

      // Save current API for the current network before switching
      const currentApi = apiBase;
      if (currentApi) {
        await LocalCache.setItem(`api_${network}`, currentApi);
        dbg(`NetworkContext: Saved current API for ${network}:`, currentApi);
      }

      // Cache the new network
      await LocalCache.setItem('network', newNetwork);
      dbg('NetworkContext: Network cached:', newNetwork);

      // Try to get the previously selected API for this network, fallback to default
      let api = await LocalCache.getItem(`api_${newNetwork}`);
      if (!api) {
        // Use default API for the network if no cached selection
        api = newNetwork === 'testnet3'
          ? 'https://mempool.space/testnet/api'  // TESTNET_APIS[0]
          : 'https://mempool.space/api';         // MAINNET_APIS[0]
        dbg('NetworkContext: No cached API found, using default for', newNetwork, ':', api);
      } else {
        dbg('NetworkContext: Using cached API for', newNetwork, ':', api);
      }

      // Cache the selected API for this network
      await LocalCache.setItem(`api_${newNetwork}`, api);
      await LocalCache.setItem('api', api); // Also update the current API
      dbg('NetworkContext: API cached for network:', newNetwork, 'API:', api);

      // Update local state - this should trigger all dependent effects
      setNetwork(newNetwork);
      setApiBase(api);
      dbg('NetworkContext: Local state updated with network:', newNetwork, 'API:', api);

      // Update native module
      await BBMTLibNativeModule.setAPI(newNetwork, api);
      dbg('NetworkContext: Native module updated with network:', newNetwork, 'API:', api);

      dbg('=== NetworkContext: Network update completed');
    } catch (error) {
      dbg('NetworkContext: Error updating network:', error);
    }
  }, [network, apiBase]);

  // Update API for current network
  const updateAPI = useCallback(async (newAPI: string) => {
    try {
      dbg('=== NetworkContext: Updating API to:', newAPI);
      
      // Cache the API for the current network
      await LocalCache.setItem(`api_${network}`, newAPI);
      await LocalCache.setItem('api', newAPI); // Also update the current API
      dbg('NetworkContext: API cached for network:', network, 'API:', newAPI);
      
      // Update local state
      setApiBase(newAPI);
      dbg('NetworkContext: API state updated to:', newAPI);
      
      // Update native module
      await BBMTLibNativeModule.setAPI(network, newAPI);
      dbg('NetworkContext: Native module updated with network:', network, 'API:', newAPI);
      
      dbg('=== NetworkContext: API update completed');
    } catch (error) {
      dbg('NetworkContext: Error updating API:', error);
    }
  }, [network]);

  // Initialize from cache on mount
  useEffect(() => {
    const initializeContext = async () => {
      try {
        dbg('=== NetworkContext: Initializing context');
        
        // Get current network
        const net = await LocalCache.getItem('network');
        dbg('NetworkContext: Network from cache:', net);
        
        if (net) {
          setNetwork(net);
          dbg('NetworkContext: Network state updated to:', net);
          
          // Try to get network-specific API first, then fallback to general API
          let api = await LocalCache.getItem(`api_${net}`);
          if (!api) {
            api = await LocalCache.getItem('api');
            dbg('NetworkContext: No network-specific API, using general API:', api);
          } else {
            dbg('NetworkContext: Using network-specific API:', api);
          }
          
          if (api) {
            setApiBase(api);
            dbg('NetworkContext: API state updated to:', api);
            
            // Sync with native module
            await BBMTLibNativeModule.setAPI(net, api);
            dbg('NetworkContext: Native module synced with network:', net, 'API:', api);
          } else {
            // Set default API if none found
            const defaultApi = net === 'testnet3'
              ? 'https://mempool.space/testnet/api'
              : 'https://mempool.space/api';
            dbg('NetworkContext: No API found, using default:', defaultApi);
            setApiBase(defaultApi);
            await LocalCache.setItem('api', defaultApi);
            await LocalCache.setItem(`api_${net}`, defaultApi);
            await BBMTLibNativeModule.setAPI(net, defaultApi);
            dbg('NetworkContext: Default API set and cached');
          }
        } else {
          // No network found, set defaults
          dbg('NetworkContext: No network found, setting defaults');
          const defaultNetwork = 'mainnet';
          const defaultApi = 'https://mempool.space/api';
          setNetwork(defaultNetwork);
          setApiBase(defaultApi);
          await LocalCache.setItem('network', defaultNetwork);
          await LocalCache.setItem('api', defaultApi);
          await LocalCache.setItem(`api_${defaultNetwork}`, defaultApi);
          await BBMTLibNativeModule.setAPI(defaultNetwork, defaultApi);
          dbg('NetworkContext: Defaults set - network:', defaultNetwork, 'API:', defaultApi);
        }
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
