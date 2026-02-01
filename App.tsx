// App.tsx
import React, {useEffect, useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {enableScreens} from 'react-native-screens';
import {Image} from 'react-native';
import ShowcaseScreen from './screens/ShowcaseScreen';
import WalletHome from './screens/WalletHome';
import PSBTScreen from './screens/PSBTScreen';
import DeviceScreen from './screens/DeviceScreen';
import EncryptedStorage from 'react-native-encrypted-storage';
import LoadingScreen from './screens/LoadingScreen';
import Zeroconf, {ImplType} from 'react-native-zeroconf';
import ReactNativeBiometrics, {BiometryTypes} from 'react-native-biometrics';
import DeviceInfo from 'react-native-device-info';
import {ThemeProvider, useTheme} from './theme';
import {WalletProvider} from './context/WalletContext';
import {UserProvider} from './context/UserContext';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {initializeHaptics, HapticFeedback} from './utils';
import ErrorBoundary from './components/ErrorBoundary';
import {
  Alert,
  EmitterSubscription,
  NativeEventEmitter,
  Platform,
  DeviceEventEmitter,
  View,
  StyleSheet,
  Pressable,
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
const Tab = createBottomTabNavigator();

// Debug logging state (session-only, not persisted)
// Default: false (logs suppressed even in __DEV__)
// This is a module-level variable that can be set from WalletSettings
let debugLoggingEnabledRef = {current: false};

// Store original console methods before they get disabled
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
  info: console.info,
  trace: console.trace,
};

// Export functions to control debug logging from other modules
export const setDebugLoggingEnabled = (enabled: boolean) => {
  debugLoggingEnabledRef.current = enabled;
};

export const isDebugLoggingEnabled = () => {
  return debugLoggingEnabledRef.current;
};
const rnBiometrics = new ReactNativeBiometrics({allowDeviceCredentials: true});
const zeroconf = new Zeroconf();
const zeroOut = new Zeroconf();
// Custom header components with configurable height
const HomeHeader = (props: any) => <CustomHeader {...props} height={60} />;
const PSBTHeader = (props: any) => <CustomHeader {...props} height={60} />;
const SettingsHeader = (props: any) => <CustomHeader {...props} height={60} />;
const WelcomeHeader = (props: any) => <CustomHeader {...props} height={60} />;
const DevicesPairingHeader = (props: any) => (
  <CustomHeader {...props} height={60} />
);
const NostrConnectHeader = (props: any) => (
  <CustomHeader {...props} height={60} />
);
const DeviceHeader = (props: any) => <CustomHeader {...props} height={60} />;

const tabBarIcons = {
  Device: require('./assets/key-icon.png'),
  Wallet: require('./assets/wallet-icon.png'),
  PSBT: require('./assets/cosign-icon.png'),
  Settings: require('./assets/settings-icon.png'),
};

const TabBarIcon = ({
  name,
  color,
  size = 24,
}: {
  name: keyof typeof tabBarIcons;
  color: string;
  size?: number;
}) => (
  <Image
    source={tabBarIcons[name]}
    style={{width: size, height: size, tintColor: color}}
    resizeMode="contain"
  />
);

const TabBarIconDevice = (props: {color: string; size?: number}) => (
  <TabBarIcon name="Device" color={props.color} size={props.size ?? 24} />
);
const TabBarIconWallet = (props: {color: string; size?: number}) => (
  <TabBarIcon name="Wallet" color={props.color} size={props.size ?? 24} />
);
const TabBarIconPSBT = (props: {color: string; size?: number}) => (
  <TabBarIcon name="PSBT" color={props.color} size={props.size ?? 24} />
);
const TabBarIconSettings = (props: {color: string; size?: number}) => (
  <TabBarIcon name="Settings" color={props.color} size={props.size ?? 24} />
);

const MainTabs = () => {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const isDarkMode =
    theme.colors.background === '#121212' ||
    theme.colors.background.includes('12');
  const lockFabOverlayStyle = {
    position: 'absolute' as const,
    right: 0,
    bottom: 0,
    left: 0,
    top: 0,
    zIndex: 999,
    elevation: 8,
    backgroundColor: 'transparent',
    pointerEvents: 'box-none' as const,
  };
  const lockFabStyle = {
    position: 'absolute' as const,
    right: 20 + insets.right,
    bottom: 64 + insets.bottom,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: isDarkMode
      ? theme.colors.cardBackground
      : theme.colors.blackOverlay06,
    borderWidth: 1,
    borderColor: isDarkMode
      ? theme.colors.border + '80'
      : theme.colors.blackOverlay10,
    shadowColor: theme.colors.shadowColor || '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 1000,
  };
  const lockFabIconStyle = {
    width: 24,
    height: 24,
    tintColor: theme.colors.text,
    opacity: 0.9,
    resizeMode: 'contain' as const,
  };
  return (
    <View style={{flex: 1}}>
      <Tab.Navigator
        initialRouteName="Wallet"
        screenOptions={{
          headerShown: true,
          headerLeft: () => null,
          headerTitle: '',
          headerTitleAlign: 'left',
          tabBarStyle: {
            backgroundColor: theme.colors.background,
            borderTopColor: theme.colors.border + '40',
          },
          tabBarActiveTintColor: theme.colors.primary || theme.colors.text,
          tabBarInactiveTintColor: theme.colors.textSecondary,
        }}>
        <Tab.Screen
          name="Device"
          component={DeviceScreen}
          options={{
            header: DeviceHeader,
            tabBarLabel: 'Device',
            tabBarIcon: TabBarIconDevice,
          }}
        />
        <Tab.Screen
          name="Wallet"
          component={WalletHome}
          options={{
            header: HomeHeader,
            tabBarLabel: 'Wallet',
            tabBarIcon: TabBarIconWallet,
          }}
        />
        <Tab.Screen
          name="PSBT"
          component={PSBTScreen}
          options={{
            header: PSBTHeader,
            tabBarLabel: 'PSBT',
            tabBarIcon: TabBarIconPSBT,
          }}
        />
        <Tab.Screen
          name="Settings"
          component={WalletSettings}
          options={{
            header: SettingsHeader,
            tabBarLabel: 'Settings',
            tabBarIcon: TabBarIconSettings,
          }}
        />
      </Tab.Navigator>
      <View style={lockFabOverlayStyle}>
        <Pressable
          style={lockFabStyle}
          onPress={() => {
            HapticFeedback.light();
            DeviceEventEmitter.emit('app:reload');
          }}
          android_ripple={{color: 'rgba(0,0,0,0.1)'}}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Lock wallet"
          accessibilityHint="Double tap to lock the wallet">
          <Image
            source={require('./assets/locker-icon.png')}
            style={lockFabIconStyle}
          />
        </Pressable>
      </View>
    </View>
  );
};

const App = () => {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Initialize debug logging state from module-level ref
  const [debugLoggingEnabled, setDebugLoggingEnabledState] = useState(
    debugLoggingEnabledRef.current,
  );
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('app:reload', async () => {
      //dbg('App: Received app:reload event');
      setIsAuthenticated(false);
      // Update debug logging state from ref
      setDebugLoggingEnabledState(debugLoggingEnabledRef.current);
      // Re-check wallet state after reload to ensure correct initial route
      try {
        const keyshare = await EncryptedStorage.getItem('keyshare');
        const route =
          keyshare && keyshare.length > 0 ? 'MainTabs' : 'Welcome';
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
        const route =
          keyshare && keyshare.length > 0 ? 'MainTabs' : 'Welcome';
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
    // Sync ref with state to ensure consistency
    debugLoggingEnabledRef.current = debugLoggingEnabled;
    // Always disable logging by default (even in __DEV__)
    // Only enable if explicitly toggled via debug setting
    if (!__DEV__ && !debugLoggingEnabled) {
      BBMTLibNativeModule.disableLogging('ok')
        .then((feedback: any) => {
          if (feedback === 'ok') {
            // Restore console methods temporarily to log the message
            console.log = originalConsole.log;
            console.log('[DEBUG] Logging disabled');
            // Now disable console methods
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
          // Restore console.log temporarily to log the error
          console.log = originalConsole.log;
          console.log('error while disabling logging', e);
          // Disable again
          console.log = () => {};
        });
    } else {
      // Restore original console methods first (they might be disabled from previous state)
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;
      console.info = originalConsole.info;
      console.trace = originalConsole.trace;
      // Now we can log the enabled message
      console.log('[DEBUG] Logging enabled');
      // Debug logging enabled - set up native log listeners
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
  }, [debugLoggingEnabled]);
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
                name="MainTabs"
                component={MainTabs}
                options={{headerShown: false}}
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
