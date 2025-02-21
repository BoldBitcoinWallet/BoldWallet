// App.tsx
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import ShowcaseScreen from './screens/ShowcaseScreen';
import WalletHome from './screens/WalletHome';
import MobilesPairing from './screens/MobilesPairing';
import EncryptedStorage from 'react-native-encrypted-storage';
import LoadingScreen from './screens/LoadingScreen';
import Zeroconf, { ImplType } from 'react-native-zeroconf';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import DeviceInfo from 'react-native-device-info';

import {
  Alert,
  EmitterSubscription,
  NativeEventEmitter,
  Platform,
} from 'react-native';
import WalletSettings from './screens/WalletSettings';
import { NativeModules } from 'react-native';
import { dbg, pinRemoteIP } from './utils';
const { BBMTLibNativeModule } = NativeModules;

const Stack = createStackNavigator();
const rnBiometrics = new ReactNativeBiometrics({ allowDeviceCredentials: true });

const App = () => {
  const zeroconf = new Zeroconf();
  const zeroOut = new Zeroconf();

  useEffect(() => {
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
      dbg('service publish stopped');
      zeroOut.unpublishService('bold_bitcoin_wallet', ImplType.NSD);
      zeroOut.stop();
    };
  }, []);

  useEffect(() => {
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
      dbg('Zeroconf error:', err);
    });
    return () => {
      dbg('service scanning stopped');
      zeroconf.removeAllListeners();
      zeroconf.stop();
    };
  }, []);

  useEffect(() => {
    let subscription: EmitterSubscription | undefined;
    if (!__DEV__) {
      BBMTLibNativeModule.disableLogging('ok')
        .then((feedback: any) => {
          if (feedback === 'ok') {
            console.log = () => { };
            console.warn = () => { };
            console.error = () => { };
            console.debug = () => { };
            console.info = () => { };
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

  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const authenticateUser = async () => {
    try {
      const { available, biometryType } = await rnBiometrics.isSensorAvailable();

      if (!available) {
        setIsAuthenticated(true);
        return;
      }

      if (
        available &&
        (biometryType === BiometryTypes.TouchID ||
          biometryType === BiometryTypes.FaceID ||
          biometryType === BiometryTypes.Biometrics)
      ) {
        const { success } = await rnBiometrics.simplePrompt({
          promptMessage: 'Authenticate to access your wallet',
          fallbackPromptMessage: 'Use your device passcode to unlock',
        });

        if (success) {
          setIsAuthenticated(true);
        } else {
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
        const { success } = await rnBiometrics.simplePrompt({
          promptMessage: 'Enter your device passcode to unlock',
        });

        if (success) {
          setIsAuthenticated(true);
        } else {
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
      Alert.alert('Error', 'Authentication failed. Please try again.');
    }
  };

  const initializeApp = async () => {
    EncryptedStorage.getItem('keyshare').then(ks => {
      setInitialRoute(ks ? 'Bold Home' : 'Bold BTC Wallet');
    });
  };

  useEffect(() => {
    initializeApp();
  }, []);

  const handleRetryAuthentication = async () => {
    setIsAuthenticated(false);
    await authenticateUser(); // Retry authentication
  };

  if (initialRoute === null || !isAuthenticated) {
    return <LoadingScreen onRetry={handleRetryAuthentication} />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName={initialRoute}>
        <Stack.Screen name="Bold BTC Wallet" component={ShowcaseScreen} />
        <Stack.Screen name="Bold Home" component={WalletHome} />
        <Stack.Screen
          name="📱📱 Pairing"
          component={MobilesPairing}
          initialParams={{ mode: 'setup' }}
        />
        <Stack.Screen name="Wallet Settings" component={WalletSettings} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;
