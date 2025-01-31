import React, {useEffect, useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';
import ShowcaseScreen from './screens/ShowcaseScreen';
import WalletHome from './screens/WalletHome';
import MobilesPairing from './screens/MobilesPairing';
import EncryptedStorage from 'react-native-encrypted-storage';
import LoadingScreen from './screens/LoadingScreen';
import ReactNativeBiometrics, {BiometryTypes} from 'react-native-biometrics';
import {
  Alert,
  EmitterSubscription,
  NativeEventEmitter,
  Platform,
} from 'react-native';
import WalletSettings from './screens/WalletSettings';
import {NativeModules} from 'react-native';
const {BBMTLibNativeModule} = NativeModules;

const Stack = createStackNavigator();
const rnBiometrics = new ReactNativeBiometrics({allowDeviceCredentials: true});

const App = () => {
  useEffect(() => {
    const logEmitter = new NativeEventEmitter(BBMTLibNativeModule);
    let subscription: EmitterSubscription | undefined;
    if (Platform.OS === 'android') {
      logEmitter.removeAllListeners('BBMT_LIB_ANDROID');
      subscription = logEmitter.addListener('BBMT_LIB_ANDROID', async log => {
        console.log('BBMT_LIB_ANDROID', log);
      });
    }
    if (Platform.OS === 'ios') {
      logEmitter.removeAllListeners('BBMT_LIB_IOS');
      subscription = logEmitter.addListener('BBMT_LIB_IOS', async log => {
        console.log('BBMT_LIB_IOS', log);
      });
    }
    return () => {
      subscription?.remove();
    };
  }, []);

  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  useEffect(() => {
    const authenticateUser = async () => {
      try {
        const {available, biometryType} =
          await rnBiometrics.isSensorAvailable();

        if (
          available &&
          (biometryType === BiometryTypes.TouchID ||
            biometryType === BiometryTypes.FaceID ||
            biometryType === BiometryTypes.Biometrics)
        ) {
          const {success} = await rnBiometrics.simplePrompt({
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
              {cancelable: false},
            );
          }
        } else {
          // Fallback to OS password/PIN
          const {success} = await rnBiometrics.simplePrompt({
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
              {cancelable: false},
            );
          }
        }
      } catch (error) {
        console.error('Authentication Error:', error);
        Alert.alert('Error', 'Authentication failed. Please try again.');
      }
    };

    const initializeApp = async () => {
      await authenticateUser();

      EncryptedStorage.getItem('keyshare').then(ks => {
        setInitialRoute(ks ? 'Bold Home' : 'Bold BTC Wallet');
      });
    };

    initializeApp();
  }, []);

  if (initialRoute === null || !isAuthenticated) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName={initialRoute}>
        <Stack.Screen name="Bold BTC Wallet" component={ShowcaseScreen} />
        <Stack.Screen name="Bold Home" component={WalletHome} />
        <Stack.Screen
          name="📱📱 Pairing"
          component={MobilesPairing}
          initialParams={{mode: 'setup'}}
        />
        <Stack.Screen name="Wallet Settings" component={WalletSettings} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;
