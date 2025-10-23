// App.tsx
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { enableScreens } from 'react-native-screens';
import ShowcaseScreen from './screens/ShowcaseScreen';
import WalletHome from './screens/WalletHome';
import EncryptedStorage from 'react-native-encrypted-storage';
import LoadingScreen from './screens/LoadingScreen';
import Zeroconf, { ImplType } from 'react-native-zeroconf';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import DeviceInfo from 'react-native-device-info';
import { ThemeProvider } from './theme';
import { WalletProvider } from './context/WalletContext';
import { NetworkProvider } from './context/NetworkContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initializeHaptics } from './utils';
import {
  Alert,
  EmitterSubscription,
  NativeEventEmitter,
  Platform,
  DeviceEventEmitter,
} from 'react-native';
import WalletSettings from './screens/WalletSettings';
import { NativeModules } from 'react-native';
import { dbg, pinRemoteIP } from './utils';
import MobilesPairing from './screens/MobilesPairing';

// Initialize react-native-screens for Fabric compatibility
enableScreens(true);

const { BBMTLibNativeModule } = NativeModules;
const Stack = createNativeStackNavigator();
const rnBiometrics = new ReactNativeBiometrics({ allowDeviceCredentials: true });
const zeroconf = new Zeroconf();
const zeroOut = new Zeroconf();

const App = () => {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('app:reload', () => {
      console.log('App: Received app:reload event');
      setIsAuthenticated(false);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    initializeHaptics();
    const checkWallet = async () => {
      try {
        const keyshare = await EncryptedStorage.getItem('keyshare');
        dbg('initializeApp keyshare found', !!keyshare);
        const route = keyshare ? 'Bold Home' : 'Welcome';
        dbg('Setting initial route to:', route);
        setInitialRoute(route);

        // Auto-trigger authentication after setting initial route
        setTimeout(() => {
          authenticateUser();
        }, 100);
      } catch (error) {
        console.error('Error in initializeApp:', error);
        setInitialRoute('Welcome');
        // Auto-trigger authentication even on error
        setTimeout(() => {
          authenticateUser();
        }, 100);
      }
    };
    checkWallet();
  }, []);

  useEffect(() => {
    try {
      const deviceID = DeviceInfo.getUniqueIdSync();
      zeroOut.publishService(
        'http',
        'tcp',
        'local.',
        'bold_bitcoin_wallet',
        55056,
        { txt: 'bold_bitcoin_wallet', id: deviceID },
        ImplType.NSD,
      );
      return () => {
        try {
          zeroOut.unpublishService('bold_bitcoin_wallet', ImplType.NSD);
          zeroOut.stop();
          dbg('service publish stopped');
        } catch (e: any) {
          console.error('error stopping service', e);
        }
      };
    } catch (e: any) {
      console.error('error publishing service', e);
    }
  }, []);

  useEffect(() => {
    try {
      dbg('scanning for mDNS Services');
      const deviceID = DeviceInfo.getUniqueIdSync();
      zeroconf.scan('http', 'tcp', 'local.');
      zeroconf.on('resolved', service => {
        dbg('Service Found:', service.fullName);
        if (
          service.txt &&
          service.txt.txt === 'bold_bitcoin_wallet' &&
          service.txt.id &&
          service.txt.id !== deviceID
        ) {
          let addresses = service.addresses;
          for (const address of addresses) {
            if (address.split('.').length === 4) {
              dbg('Service Pinned:', service);
              pinRemoteIP(address);
            }
          }
        }
      });
      zeroconf.on('error', err => {
        console.error('Zeroconf error:', err);
      });
      return () => {
        try {
          dbg('service scanning stopped');
          zeroconf.removeAllListeners();
          zeroconf.stop();
        } catch (e: any) {
          console.error('error stopping mDNS scan', e);
        }
      };
    } catch (e: any) {
      console.error('error scanning mDNS', e);
    }
  }, []);

  useEffect(() => {
    let subscription: EmitterSubscription | undefined;
    if (!__DEV__) {
      BBMTLibNativeModule.disableLogging('ok')
        .then((feedback: any) => {
          if (feedback === 'ok') {
            console.log = () => {};
            console.warn = () => {};
            console.error = () => {};
            console.debug = () => {};
            console.info = () => {};
          } else {
            console.warn('could not disable logging');
          }
        })
        .catch((e: Error) => {
          console.error('error while disabling logging', e);
        });
    } else {
      const logEmitter = new NativeEventEmitter(BBMTLibNativeModule);
      if (Platform.OS === 'android') {
        logEmitter.removeAllListeners('BBMT_DROID');
        subscription = logEmitter.addListener('BBMT_DROID', async log => {
          dbg('BBMT_DROID', log.tag, log.message);
        });
      }
      if (Platform.OS === 'ios') {
        logEmitter.removeAllListeners('BBMT_APPLE');
        subscription = logEmitter.addListener('BBMT_APPLE', async log => {
          dbg('BBMT_APPLE', log);
        });
      }
    }
    return () => {
      subscription?.remove();
    };
  }, []);

  const authenticateUser = async () => {
    try {
      dbg('Starting authentication...');
      const { available, biometryType } = await rnBiometrics.isSensorAvailable();
      dbg('Biometric available:', available, 'Type:', biometryType);

      if (!available) {
        dbg('No biometric available, skipping authentication');
        setIsAuthenticated(true);
        return;
      }

      if (
        available &&
        (biometryType === BiometryTypes.TouchID ||
          biometryType === BiometryTypes.FaceID ||
          biometryType === BiometryTypes.Biometrics)
      ) {
        dbg('Using biometric authentication');
        const { success } = await rnBiometrics.simplePrompt({
          promptMessage: 'Authenticate to access your wallet',
          fallbackPromptMessage: 'Use your device passcode to unlock',
        });

        if (success) {
          dbg('Biometric authentication successful');
          setIsAuthenticated(true);
        } else {
          dbg('Biometric authentication failed');
          Alert.alert(
            'Authentication Failed',
            'Unable to authenticate. Please try again.',
            [
              {
                text: 'Retry',
                onPress: () => {
                  authenticateUser();
                },
              },
            ],
            { cancelable: false },
          );
        }
      } else {
        dbg('Using device passcode authentication');
        const { success } = await rnBiometrics.simplePrompt({
          promptMessage: 'Enter your device passcode to unlock',
        });

        if (success) {
          dbg('Device passcode authentication successful');
          setIsAuthenticated(true);
        } else {
          dbg('Device passcode authentication failed');
          Alert.alert(
            'Authentication Failed',
            'Unable to authenticate. Please try again.',
            [
              {
                text: 'Retry',
                onPress: () => {
                  authenticateUser();
                },
              },
            ],
            { cancelable: false },
          );
        }
      }
    } catch (error) {
      console.error('Authentication Error:', error);
      if (__DEV__) {
        dbg('Development mode: skipping authentication due to error');
        setIsAuthenticated(true);
      } else {
        Alert.alert('Error', 'Authentication failed. Please try again.');
      }
    }
  };

  const handleRetryAuthentication = async () => {
    setIsAuthenticated(false);
    await authenticateUser();
  };

  if (initialRoute === null || !isAuthenticated) {
    dbg('Rendering LoadingScreen - initialRoute:', initialRoute, 'isAuthenticated:', isAuthenticated);
    return (
      <ThemeProvider>
        <LoadingScreen onRetry={handleRetryAuthentication} />
      </ThemeProvider>
    );
  }

  dbg('Rendering main navigation with initialRoute:', initialRoute);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <NetworkProvider>
          <WalletProvider>
            <NavigationContainer>
            <Stack.Navigator
              initialRouteName={initialRoute}
              screenOptions={{
                headerShown: false,
              }}
            >
              <Stack.Screen
                name="Bold Home"
                component={WalletHome}
                options={{
                  headerShown: true,
                  headerLeft: () => null,
                }}
              />
              <Stack.Screen
                name="Welcome"
                component={ShowcaseScreen}
                options={{
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="Settings"
                component={WalletSettings}
                options={{
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="📱📱 Pairing"
                component={MobilesPairing}
                options={{
                  headerShown: true,
                }}
              />
            </Stack.Navigator>
            </NavigationContainer>
          </WalletProvider>
        </NetworkProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
};

export default App;