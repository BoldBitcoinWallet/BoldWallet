// App.tsx
import React, {useEffect, useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {enableScreens} from 'react-native-screens';
import ShowcaseScreen from './screens/ShowcaseScreen';
import WalletHome from './screens/WalletHome';
import PSBTScreen from './screens/PSBTScreen';
import EncryptedStorage from 'react-native-encrypted-storage';
import LoadingScreen from './screens/LoadingScreen';
import Zeroconf, {ImplType} from 'react-native-zeroconf';
import ReactNativeBiometrics, {BiometryTypes} from 'react-native-biometrics';
import DeviceInfo from 'react-native-device-info';
import {ThemeProvider, useTheme} from './theme';
import {WalletProvider} from './context/WalletContext';
import {UserProvider} from './context/UserContext';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {initializeHaptics} from './utils';
import ErrorBoundary from './components/ErrorBoundary';
import {
  Alert,
  EmitterSubscription,
  NativeEventEmitter,
  Platform,
  DeviceEventEmitter,
  View,
  StyleSheet,
} from 'react-native';
import WalletSettings from './screens/WalletSettings';
import {NativeModules} from 'react-native';
import {dbg, pinRemoteIP, getPinnedRemoteIPs} from './utils';
import MobilesPairing from './screens/MobilesPairing';
import MobileNostrPairing from './screens/MobileNostrPairing';
import UserPreferenceScreen from './screens/UserPreferenceScreen';
import {CustomHeader} from './components/Header';
import Toast from 'react-native-toast-message';
import {createToastConfig} from './utils/toastConfig';
// Initialize react-native-screens for Fabric compatibility
enableScreens(true);
const {BBMTLibNativeModule} = NativeModules;
const Stack = createNativeStackNavigator();
const rnBiometrics = new ReactNativeBiometrics({allowDeviceCredentials: true});
const zeroconf = new Zeroconf();
const zeroOut = new Zeroconf();
// Custom header components with configurable height
const HomeHeader = (props: any) => <CustomHeader {...props} height={60} />;
const PSBTHeader = (props: any) => <CustomHeader {...props} height={60} />;
const SettingsHeader = (props: any) => <CustomHeader {...props} height={60} />;
const WelcomeHeader = (props: any) => <CustomHeader {...props} height={60} />;
const DevicesPairingHeader = (props: any) => <CustomHeader {...props} height={60} />;
const NostrConnectHeader = (props: any) => <CustomHeader {...props} height={60} />;
const App = () => {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('app:reload', async () => {
      //dbg('App: Received app:reload event');
      setIsAuthenticated(false);
      // Re-check wallet state after reload to ensure correct initial route
      try {
        const keyshare = await EncryptedStorage.getItem('keyshare');
        let route: string = 'Welcome';
        if (keyshare && keyshare.length > 0) {
          const walletMode =
            (await EncryptedStorage.getItem('wallet_mode')) || 'full';
          route = walletMode === 'psbt' ? 'PSBT' : 'Home';
        }
        setInitialRoute(route);
      } catch {
        setInitialRoute('Welcome');
      }
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    initializeHaptics();
    const checkWallet = async () => {
      try {
        const keyshare = await EncryptedStorage.getItem('keyshare');
        dbg('initializeApp keyshare found', !!keyshare);
        let route: string = 'Welcome';
        if (keyshare && keyshare.length > 0) {
          // Default to Home unless user explicitly chose PSBT mode
          const walletMode =
            (await EncryptedStorage.getItem('wallet_mode')) || 'full';
          route = walletMode === 'psbt' ? 'PSBT' : 'Home';
        }
        dbg('Setting initial route to:', route);
        setInitialRoute(route);
      } catch (error) {
        dbg('Error in initializeApp:', error);
        setInitialRoute('Welcome');
      }
    };
    checkWallet();
  }, []);
  useEffect(() => {
    try {
      dbg('publishing service...');
      const deviceID = DeviceInfo.getUniqueIdSync();
      if (!deviceID || deviceID.trim() === '') {
        dbg('Warning: deviceID is empty, skipping service publication');
        return;
      }
      dbg('deviceID:', deviceID);
      zeroOut.publishService(
        'http', // Fixed with underscore
        'tcp',
        'local.',
        'bbw_scan',
        55056,
        {txt: 'bbw_scan', id: deviceID},
        ImplType.NSD,
      );
      dbg('service bbw_scan published');
      return () => {
        try {
          zeroOut.unpublishService('bbw_scan', ImplType.NSD);
          zeroOut.stop();
          dbg('service publish stopped');
        } catch (e: any) {
          dbg('error stopping service', e);
        }
      };
    } catch (e: any) {
      dbg('error publishing service', e);
    }
  }, []);
  useEffect(() => {
    try {
      dbg('scanning for mDNS Services');
      const deviceID = DeviceInfo.getUniqueIdSync();
      // Validate deviceID before scanning
      if (!deviceID || deviceID.trim() === '') {
        dbg('Warning: deviceID is empty, skipping mDNS scan');
        return;
      }
      zeroconf.scan('http', 'tcp', 'local.');
      zeroconf.on('resolved', service => {
        dbg('Service Found:', service.fullName);
        if (
          service.txt &&
          service.txt.txt === 'bbw_scan' &&
          service.txt.id &&
          service.txt.id !== deviceID
        ) {
          let addresses = service.addresses || [];
          for (const address of addresses) {
            if (address && address.split('.').length === 4) {
              pinRemoteIP(address);
            }
          }
          const pinned = getPinnedRemoteIPs();
          if (pinned.length) {
            dbg('Pinned remote IPv4 addresses:', pinned.join(', '));
          }
        }
      });
      zeroconf.on('error', err => {
        dbg('Zeroconf error:', String(err));
      });
      return () => {
        try {
          dbg('service scanning stopped');
          zeroconf.removeAllListeners();
          zeroconf.stop();
        } catch (e: any) {
          dbg('error stopping mDNS scan', e);
        }
      };
    } catch (e: any) {
      dbg('error scanning mDNS', e);
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
            console.trace = () => {};
          } else {
            console.warn('could not disable logging');
          }
        })
        .catch((e: Error) => {
          dbg('error while disabling logging', e);
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
      const {available, biometryType} = await rnBiometrics.isSensorAvailable();
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
        const {success} = await rnBiometrics.simplePrompt({
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
            {cancelable: false},
          );
        }
      } else {
        dbg('Using device passcode authentication');
        const {success} = await rnBiometrics.simplePrompt({
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
            {cancelable: false},
          );
        }
      }
    } catch (error) {
      dbg('Authentication Error:', error);
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
    dbg(
      'Rendering LoadingScreen - initialRoute:',
      initialRoute,
      'isAuthenticated:',
      isAuthenticated,
    );
    return (
      <ErrorBoundary>
        <SafeAreaProvider>
          <ThemeProvider>
            <LoadingScreen onRetry={handleRetryAuthentication} />
          </ThemeProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    );
  }
  dbg('Rendering main navigation with initialRoute:', initialRoute);
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppContent initialRoute={initialRoute} />
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
};
const AppContent = ({initialRoute}: {initialRoute: string | null}) => {
  const {theme} = useTheme();
  const dynamicStyles = {
    navigationContainer: {
      ...styles.navigationContainer,
      backgroundColor: theme.colors.background,
    },
  };
  return (
    <UserProvider>
      <WalletProvider>
        <View style={dynamicStyles.navigationContainer}>
                <NavigationContainer>
                  <Stack.Navigator
                    initialRouteName={initialRoute || undefined}
                    screenOptions={{
                      headerShown: false,
                      headerTitleAlign: 'left',
                    }}>
                    <Stack.Screen
                      name="PSBT"
                      component={PSBTScreen}
                      options={{
                        headerShown: true,
                        headerLeft: () => null,
                        headerTitle: '',
                        headerTitleAlign: 'left',
                        header: PSBTHeader,
                      }}
                    />
                    <Stack.Screen
                      name="Home"
                      component={WalletHome}
                      options={{
                        headerShown: true,
                        headerLeft: () => null,
                        headerTitle: '',
                        headerTitleAlign: 'left',
                        header: HomeHeader,
                      }}
                    />
                    <Stack.Screen
                      name="Welcome"
                      component={ShowcaseScreen}
                      options={{
                        header: WelcomeHeader,
                        title: 'Welcome',
                      }}
                    />
                    <Stack.Screen
                      name="Settings"
                      component={WalletSettings}
                      options={{
                        headerShown: true,
                        header: SettingsHeader,
                        title: 'Settings',
                      }}
                    />
                    <Stack.Screen
                      name="Devices Pairing"
                      component={MobilesPairing}
                      options={{
                        headerShown: true,
                        header: DevicesPairingHeader,
                        title: 'Devices Pairing',
                      }}
                    />
                    <Stack.Screen
                      name="Nostr Connect"
                      component={MobileNostrPairing}
                      options={{
                        headerShown: true,
                        header: NostrConnectHeader,
                        title: 'Nostr Connect',
                      }}
                    />
                    <Stack.Screen
                      name="User Preferences"
                      component={UserPreferenceScreen}
                      options={{
                        headerShown: false,
                        title: 'User Preferences',
                      }}
                    />
                  </Stack.Navigator>
                </NavigationContainer>
                <View style={styles.toastWrapper}>
                  <Toast config={createToastConfig(theme)} />
                </View>
              </View>
            </WalletProvider>
          </UserProvider>
  );
};
const styles = StyleSheet.create({
  navigationContainer: {
    flex: 1,
    // backgroundColor will be set dynamically based on theme
  },
  toastWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99999,
    elevation: 99999,
    pointerEvents: 'box-none',
  },
});
export default App;
