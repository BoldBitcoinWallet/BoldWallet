// App.tsx
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import type {LinkingOptions, NavigationContainerRef} from '@react-navigation/native';
import type {BottomTabHeaderProps} from '@react-navigation/bottom-tabs';
import type {NativeStackHeaderProps} from '@react-navigation/native-stack';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {enableScreens} from 'react-native-screens';
import {Image} from 'react-native';
import ShowcaseScreen from './screens/ShowcaseScreen';
import WalletHome from './screens/WalletHome';
import MempoolPlaygroundScreen from './screens/MempoolPlaygroundScreen';
import UtxosScreen from './screens/UtxosScreen';
import AddressesScreen from './screens/AddressesScreen';
import PSBTScreen from './screens/PSBTScreen';
import DeviceScreen from './screens/DeviceScreen';
import LoadingScreen from './screens/LoadingScreen';
import Zeroconf, {ImplType} from 'react-native-zeroconf';
import DeviceInfo from 'react-native-device-info';
import {ThemeProvider, useTheme} from './theme';
import {WalletProvider} from './context/WalletContext';
import {UserProvider, useUser} from './context/UserContext';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {initializeHaptics} from './utils';
import database from './services/Database';
import {runMigrationIfNeeded} from './services/LocalCacheMigration';
import {runBrantaVerifiedBackfillIfNeeded} from './services/BrantaVerifiedBackfill';
import ErrorBoundary from './components/ErrorBoundary';
import {
  Alert,
  EmitterSubscription,
  NativeEventEmitter,
  Platform,
  DeviceEventEmitter,
  View,
  Text,
  StyleSheet,
  type GestureResponderEvent,
} from 'react-native';
import AppPressable from './components/AppPressable';
import WalletSettings from './screens/WalletSettings';
import {NativeModules} from 'react-native';
import {
  dbg,
  pinRemoteIP,
  getPinnedRemoteIPs,
  resolveInitialWalletRoute,
} from './utils';
import {ensureLanDiscoveryPermission} from './services/lanDiscoveryPermissions';
import MobilesPairing from './screens/MobilesPairing';
import MobileNostrPairing from './screens/MobileNostrPairing';
import UserPreferenceScreen from './screens/UserPreferenceScreen';
import {CustomHeader} from './components/Header';
import Toast from 'react-native-toast-message';
import {createToastConfig} from './utils/toastConfig';
import {promptWalletBiometricAuth} from './services/walletBiometricAuth';
import IncomingShareHandler from './components/IncomingShareHandler';
import IncomingUrlHandler from './components/IncomingUrlHandler';
// Initialize react-native-screens for Fabric compatibility
enableScreens(true);
const {BBMTLibNativeModule} = NativeModules;
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const linking: LinkingOptions<any> = {
  prefixes: ['boldwallet://', 'bitcoin:'],
  config: {
    screens: {
      MainTabs: {
        screens: {
          Wallet: 'wallet',
          PSBT: 'psbt',
        },
      },
    },
  },
};

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
const zeroconf = new Zeroconf();
const zeroOut = new Zeroconf();
/** Tab + stack headers both pass props here; CustomHeader is typed for native stack only. */
type AppNavigationHeaderProps =
  | NativeStackHeaderProps
  | BottomTabHeaderProps;

const renderAppHeader =
  (height: number) => (props: AppNavigationHeaderProps) => (
    <CustomHeader {...(props as NativeStackHeaderProps)} height={height} />
  );

// Custom header components with configurable height
const HomeHeader = renderAppHeader(60);
const PSBTHeader = renderAppHeader(60);
const SettingsHeader = renderAppHeader(60);
const WelcomeHeader = renderAppHeader(60);
const DevicesPairingHeader = renderAppHeader(60);
const NostrConnectHeader = renderAppHeader(60);
const DeviceHeader = renderAppHeader(60);

const TAB_BAR_ICON_SIZE = 22;

const tabBarIcons = {
  Device: require('./assets/key-icon.png'),
  Wallet: require('./assets/wallet-icon.png'),
  Playground: require('./assets/mempool-icon.png'),
  Utxos: require('./assets/utxo-icon.png'),
  Addresses: require('./assets/addresses-icon.png'),
  PSBT: require('./assets/cosign-icon.png'),
  Settings: require('./assets/settings-icon.png'),
};

const TabBarIcon = ({
  name,
  color,
  size = TAB_BAR_ICON_SIZE,
}: {
  name: keyof typeof tabBarIcons;
  color: string;
  size?: number;
}) => {
  const inset = 1;
  const iconSize = size - inset * 2;
  return (
    <View style={tabBarStyles.tabBarIconInner}>
      <Image
        source={tabBarIcons[name]}
        style={{width: iconSize, height: iconSize, tintColor: color}}
        resizeMode="contain"
      />
    </View>
  );
};

const TabBarIconDevice = (props: {color: string; size?: number}) => (
  <TabBarIcon
    name="Device"
    color={props.color}
    size={props.size ?? TAB_BAR_ICON_SIZE}
  />
);
const TabBarIconWallet = (props: {color: string; size?: number}) => (
  <TabBarIcon
    name="Wallet"
    color={props.color}
    size={props.size ?? TAB_BAR_ICON_SIZE}
  />
);
const TabBarIconPlayground = (props: {color: string; size?: number}) => (
  <TabBarIcon
    name="Playground"
    color={props.color}
    size={props.size ?? TAB_BAR_ICON_SIZE}
  />
);
const TabBarIconUtxos = (props: {color: string; size?: number}) => (
  <TabBarIcon
    name="Utxos"
    color={props.color}
    size={props.size ?? TAB_BAR_ICON_SIZE}
  />
);
const TabBarIconAddresses = (props: {color: string; size?: number}) => (
  <TabBarIcon
    name="Addresses"
    color={props.color}
    size={props.size ?? TAB_BAR_ICON_SIZE}
  />
);
const TabBarIconPSBT = (props: {color: string; size?: number}) => (
  <TabBarIcon
    name="PSBT"
    color={props.color}
    size={props.size ?? TAB_BAR_ICON_SIZE}
  />
);
const TabBarIconSettings = (props: {color: string; size?: number}) => (
  <TabBarIcon
    name="Settings"
    color={props.color}
    size={props.size ?? TAB_BAR_ICON_SIZE}
  />
);

const TAB_BAR_BUTTON_BORDER_RADIUS = 12;

const tabBarStyles = StyleSheet.create({
  mainTabsContainer: {flex: 1},
  tabBarButtonInner: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TAB_BAR_BUTTON_BORDER_RADIUS,
    overflow: 'hidden',
    padding: 12,
  },
  activeTabBgLight: {backgroundColor: 'rgba(0,0,0,0.06)'},
  activeTabBgDark: {backgroundColor: 'rgba(255,255,255,0.08)'},
  tabBarIcon: {
    width: TAB_BAR_ICON_SIZE,
    height: TAB_BAR_ICON_SIZE,
    marginBottom: 2,
    overflow: 'visible' as const,
  },
  tabBarIconInner: {
    width: TAB_BAR_ICON_SIZE,
    height: TAB_BAR_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarLabel: {
    textAlign: 'center',
  },
  tabBarLabelWrapper: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  tabBarLabelText: {
    width: '100%',
    textAlign: 'center',
  },
  tabBarItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const TabBarLabel = ({color, children}: {color: string; children: string}) => {
  const {theme} = useTheme();
  const labelTypography = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.medium,
    color,
  };
  return (
    <View style={tabBarStyles.tabBarLabelWrapper}>
      <Text
        style={[
          tabBarStyles.tabBarLabel,
          tabBarStyles.tabBarLabelText,
          labelTypography,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}>
        {children}
      </Text>
    </View>
  );
};

type TabBarButtonProps = Record<string, unknown> & {isDarkMode?: boolean};

const TabBarButton = (props: TabBarButtonProps) => {
  const {style, accessibilityState, isDarkMode, onPress, ...rest} = props;
  const selected = (accessibilityState as {selected?: boolean})?.selected;
  const activeBg =
    isDarkMode === true
      ? tabBarStyles.activeTabBgDark
      : tabBarStyles.activeTabBgLight;
  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      (onPress as (e: GestureResponderEvent) => void)?.(e);
    },
    [onPress],
  );
  return (
    <View style={[style as object, selected && activeBg]}>
      <AppPressable
        {...(rest as object)}
        onPress={handlePress}
        style={tabBarStyles.tabBarButtonInner}
      />
    </View>
  );
};

const MainTabs = () => {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const isDarkMode = theme.colors.background !== '#ffffff';
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
  const lockFabPosition = {
    position: 'absolute' as const,
    right: 30 + insets.right,
    bottom: 80 + insets.bottom,
    zIndex: 1000,
  };
  const lockFabSize = 48; // 15% smaller than 56
  const lockFabShape = {
    width: lockFabSize,
    height: lockFabSize,
    borderRadius: lockFabSize / 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: isDarkMode
      ? theme.colors.cardBackground
      : theme.colors.primaryOverlay95,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    borderColor: isDarkMode
      ? theme.colors.border + '80'
      : theme.colors.blackOverlay10,
  };
  const lockFabStyle =
    Platform.OS === 'android'
      ? {
          ...lockFabShape,
          position: 'absolute' as const,
          top: 0,
          left: 0,
          overflow: 'hidden' as const,
          elevation: 0,
        }
      : {
          ...lockFabPosition,
          ...lockFabShape,
          shadowColor: theme.colors.shadowColor || '#000',
          shadowOffset: {width: 0, height: 2},
          shadowOpacity: 0.15,
          shadowRadius: 4,
          elevation: 4,
        };
  const lockFabWrapperStyle =
    Platform.OS === 'android'
      ? {
          ...lockFabPosition,
          width: lockFabSize,
          height: lockFabSize,
        }
      : undefined;
  const lockFabShadowStyle =
    Platform.OS === 'android'
      ? {
          position: 'absolute' as const,
          top: -1,
          left: -1,
          width: lockFabSize + 2,
          height: lockFabSize + 2,
          borderRadius: lockFabSize / 2 + 1,
          backgroundColor: 'rgba(255, 255, 255, 0.2)',
        }
      : undefined;
  const lockFabIconStyle = {
    width: 20,
    height: 20,
    tintColor: theme.colors.textOnPrimary,
    opacity: 0.9,
    resizeMode: 'contain' as const,
  };
  const renderTabBarButton = useCallback(
    (props: Record<string, unknown>) => (
      <TabBarButton {...props} isDarkMode={isDarkMode} />
    ),
    [isDarkMode],
  );
  const {
    activeNetwork,
    showMempoolPlayground,
    showUtxosTab,
    showAddressesTab,
    showPsbtTab,
    showWalletTab,
  } = useUser();
  const showPlayTab = activeNetwork === 'mainnet' && showMempoolPlayground;
  const initialTab = showWalletTab ? 'Wallet' : showPsbtTab ? 'PSBT' : 'Device';
  return (
    <View style={tabBarStyles.mainTabsContainer}>
      <Tab.Navigator
        initialRouteName={initialTab}
        screenOptions={{
          headerShown: true,
          headerLeft: () => null,
          headerTitle: '',
          headerTitleAlign: 'left',
          tabBarStyle: {
            backgroundColor: theme.colors.background,
            borderTopWidth: 1,
            borderTopColor: isDarkMode
              ? theme.colors.border + 'CC'
              : theme.colors.border + '60',
          },
          tabBarActiveTintColor: isDarkMode
            ? theme.colors.text
            : theme.colors.primary || theme.colors.text,
          tabBarInactiveTintColor: theme.colors.textSecondary,
          tabBarIconStyle: tabBarStyles.tabBarIcon,
          tabBarLabelStyle: tabBarStyles.tabBarLabel,
          tabBarItemStyle: tabBarStyles.tabBarItem,
          tabBarAllowFontScaling: false,
          tabBarButton: renderTabBarButton,
          tabBarLabel: TabBarLabel,
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
        {showPsbtTab && (
          <Tab.Screen
            name="PSBT"
            component={PSBTScreen}
            options={{
              header: PSBTHeader,
              tabBarLabel: 'PSBT',
              tabBarIcon: TabBarIconPSBT,
            }}
          />
        )}
        {showWalletTab && (
          <Tab.Screen
            name="Wallet"
            component={WalletHome}
            options={{
              header: HomeHeader,
              tabBarLabel: 'Wallet',
              tabBarIcon: TabBarIconWallet,
            }}
          />
        )}
        {showPlayTab && (
          <Tab.Screen
            name="Playground"
            component={MempoolPlaygroundScreen}
            options={{
              header: HomeHeader,
              tabBarLabel: 'Play',
              tabBarIcon: TabBarIconPlayground,
            }}
          />
        )}
        {showUtxosTab && (
          <Tab.Screen
            name="Utxos"
            component={UtxosScreen}
            options={{
              header: HomeHeader,
              tabBarLabel: 'UTXOs',
              tabBarIcon: TabBarIconUtxos,
            }}
          />
        )}
        {showAddressesTab && (
          <Tab.Screen
            name="Addresses"
            component={AddressesScreen}
            options={{
              header: HomeHeader,
              tabBarLabel: 'Addresses',
              tabBarIcon: TabBarIconAddresses,
            }}
          />
        )}
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
        {Platform.OS === 'android' &&
        lockFabWrapperStyle &&
        lockFabShadowStyle ? (
          <View style={lockFabWrapperStyle}>
            <View style={lockFabShadowStyle} pointerEvents="none" />
            <AppPressable
              style={lockFabStyle}
              onPress={() => {
                DeviceEventEmitter.emit('app:reload');
              }}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Lock wallet"
              accessibilityHint="Double tap to lock the wallet">
              <Image
                source={require('./assets/locker-icon.png')}
                style={lockFabIconStyle}
              />
            </AppPressable>
          </View>
        ) : (
          <AppPressable
            style={lockFabStyle}
            onPress={() => {
              DeviceEventEmitter.emit('app:reload');
            }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Lock wallet"
            accessibilityHint="Double tap to lock the wallet">
            <Image
              source={require('./assets/locker-icon.png')}
              style={lockFabIconStyle}
            />
          </AppPressable>
        )}
      </View>
    </View>
  );
};

const App = () => {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  /** Remount wallet UI after lock (keeps UserProvider — avoids keychain reads while locked). */
  const [contentResetKey, setContentResetKey] = useState(0);
  /** Full remount including UserProvider (wallet delete / import only). */
  const [userProviderResetKey, setUserProviderResetKey] = useState(0);
  const unlockInFlightRef = useRef(false);
  // Initialize debug logging state from module-level ref
  const [debugLoggingEnabled, setDebugLoggingEnabledState] = useState(
    debugLoggingEnabledRef.current,
  );
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'app:reload',
      async (payload?: {revalidateRoute?: boolean}) => {
        if (Platform.OS === 'android') {
          try {
            require('rn-barcode-zxing-scan').default?.stopQrReader?.();
          } catch {
            // Native module unavailable — non-fatal
          }
        }
        setIsAuthenticated(false);
        setDebugLoggingEnabledState(debugLoggingEnabledRef.current);
        // Resolve route before remounting navigation so unlock never lands with initialRoute null.
        try {
          const route = await resolveInitialWalletRoute();
          setInitialRoute(route);
        } catch {
          setInitialRoute('Welcome');
        }
        setContentResetKey(k => k + 1);
        if (payload?.revalidateRoute) {
          setUserProviderResetKey(k => k + 1);
        }
      },
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    initializeHaptics();
    const checkWallet = async () => {
      // Open SQLite database and run one-time LocalCache → SQLite migration.
      // Wrapped in try/catch so a DB failure never blocks app startup.
      try {
        await database.open();
        dbg('App: SQLite database ready');
        await runMigrationIfNeeded();
        await runBrantaVerifiedBackfillIfNeeded();
      } catch (dbErr) {
        dbg('App: Database init error (non-fatal):', dbErr);
      }
      try {
        const route = await resolveInitialWalletRoute();
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
    let cancelled = false;
    (async () => {
      try {
        dbg('publishing service...');
        const deviceID = DeviceInfo.getUniqueIdSync();
        if (!deviceID || deviceID.trim() === '') {
          dbg('Warning: deviceID is empty, skipping service publication');
          return;
        }
        await ensureLanDiscoveryPermission();
        if (cancelled) {
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
      } catch (e: any) {
        dbg('error publishing service', e);
      }
    })();
    return () => {
      cancelled = true;
      try {
        zeroOut.unpublishService('bbw_scan', ImplType.NSD);
        zeroOut.stop();
        dbg('service publish stopped');
      } catch (e: any) {
        dbg('error stopping service', e);
      }
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        dbg('scanning for mDNS Services');
        const deviceID = DeviceInfo.getUniqueIdSync();
        // Validate deviceID before scanning
        if (!deviceID || deviceID.trim() === '') {
          dbg('Warning: deviceID is empty, skipping mDNS scan');
          return;
        }
        await ensureLanDiscoveryPermission();
        if (cancelled) {
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
      } catch (e: any) {
        dbg('error scanning mDNS', e);
      }
    })();
    return () => {
      cancelled = true;
      try {
        dbg('service scanning stopped');
        zeroconf.removeAllListeners();
        zeroconf.stop();
      } catch (e: any) {
        dbg('error stopping mDNS scan', e);
      }
    };
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
    if (unlockInFlightRef.current) {
      return;
    }
    unlockInFlightRef.current = true;
    dbg('Starting authentication...');
    try {
      const success = await promptWalletBiometricAuth({
        showFailureAlert: false,
      });
      if (!success) {
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
        return;
      }
      dbg('Biometric authentication successful');
      try {
        const route = await resolveInitialWalletRoute();
        setInitialRoute(route);
      } catch {
        setInitialRoute('Welcome');
      }
      DeviceEventEmitter.emit('wallet:unlocked');
      setIsAuthenticated(true);
    } finally {
      unlockInFlightRef.current = false;
    }
  };
  const handleRetryAuthentication = async () => {
    setIsAuthenticated(false);
    await authenticateUser();
  };
  dbg(
    'Rendering - initialRoute:',
    initialRoute,
    'isAuthenticated:',
    isAuthenticated,
  );
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <UserProvider key={`user-${userProviderResetKey}`}>
            {initialRoute === null || !isAuthenticated ? (
              <LoadingScreen onRetry={handleRetryAuthentication} />
            ) : (
              <AppContent
                key={`content-${contentResetKey}`}
                initialRoute={initialRoute}
                isAuthenticated={isAuthenticated}
              />
            )}
          </UserProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
};
const AppContent = ({
  initialRoute,
  isAuthenticated,
}: {
  initialRoute: string | null;
  isAuthenticated: boolean;
}) => {
  const {theme} = useTheme();
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  const dynamicStyles = {
    navigationContainer: {
      ...styles.navigationContainer,
      backgroundColor: theme.colors.background,
    },
  };
  return (
    <WalletProvider>
        <View style={dynamicStyles.navigationContainer}>
          <NavigationContainer ref={navigationRef} linking={linking}>
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
          <IncomingShareHandler
            isAuthenticated={isAuthenticated}
            navigationRef={navigationRef}
          />
          <IncomingUrlHandler
            isAuthenticated={isAuthenticated}
            navigationRef={navigationRef}
          />
          <View style={styles.toastWrapper}>
            <Toast config={createToastConfig(theme)} />
          </View>
        </View>
      </WalletProvider>
  );
};
const styles = StyleSheet.create({
  navigationContainer: {
    flex: 1,
    overflow: 'visible',
    // backgroundColor will be set dynamically based on theme
  },
  toastWrapper: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
    pointerEvents: 'box-none',
  },
});
export default App;
