import {Alert} from 'react-native';
import ReactNativeBiometrics, {BiometryTypes} from 'react-native-biometrics';
import {dbg} from '../utils';

const rnBiometrics = new ReactNativeBiometrics({allowDeviceCredentials: true});

export type WalletBiometricPromptOptions = {
  promptMessage?: string;
  fallbackPromptMessage?: string;
  /** When false, failed/cancelled auth shows an alert with Retry (lock-screen style). Default true. */
  showFailureAlert?: boolean;
};

const PASSCODE_FALLBACK = 'Use your device passcode to continue';

/** Copy for sensitive in-app actions (settings backup/delete, dev mode, keyshare inspector). */
export const WALLET_SENSITIVE_ACTION_AUTH = {
  backupKeyshare: {
    promptMessage: 'Authenticate to backup your wallet keyshare',
    fallbackPromptMessage: PASSCODE_FALLBACK,
  },
  deleteWallet: {
    promptMessage: 'Authenticate to delete your wallet on this device',
    fallbackPromptMessage: PASSCODE_FALLBACK,
  },
  enableDeveloperMode: {
    promptMessage: 'Authenticate to enable Developer Mode',
    fallbackPromptMessage: PASSCODE_FALLBACK,
  },
  viewKeyshareStructure: {
    promptMessage: 'Authenticate to view keyshare structure',
    fallbackPromptMessage: PASSCODE_FALLBACK,
  },
} as const satisfies Record<string, WalletBiometricPromptOptions>;

/**
 * Device biometric / passcode prompt (same stack as lock screen unlock).
 * Returns true when authenticated or when no sensor is available (same as App startup).
 */
export async function promptWalletBiometricAuth(
  opts?: WalletBiometricPromptOptions,
): Promise<boolean> {
  const promptMessage =
    opts?.promptMessage ?? 'Authenticate to access your wallet';
  const fallbackPromptMessage =
    opts?.fallbackPromptMessage ?? 'Use your device passcode to unlock';
  const showFailureAlert = opts?.showFailureAlert !== false;

  try {
    dbg('promptWalletBiometricAuth: starting');
    const {available, biometryType} = await rnBiometrics.isSensorAvailable();
    dbg('promptWalletBiometricAuth: available', available, biometryType);
    if (!available) {
      return true;
    }

    const useBiometric =
      biometryType === BiometryTypes.TouchID ||
      biometryType === BiometryTypes.FaceID ||
      biometryType === BiometryTypes.Biometrics;

    const {success} = await rnBiometrics.simplePrompt(
      useBiometric
        ? {
            promptMessage,
            fallbackPromptMessage,
          }
        : {
            promptMessage: 'Enter your device passcode to unlock',
          },
    );

    if (success) {
      return true;
    }

    if (showFailureAlert) {
      await new Promise<void>(resolve => {
        Alert.alert(
          'Authentication Failed',
          'Unable to authenticate. Please try again.',
          [{text: 'OK', onPress: () => resolve()}],
        );
      });
    }
    return false;
  } catch (error) {
    dbg('promptWalletBiometricAuth: error', error);
    if (__DEV__) {
      dbg('promptWalletBiometricAuth: DEV skip after error');
      return true;
    }
    if (showFailureAlert) {
      Alert.alert('Error', 'Authentication failed. Please try again.');
    }
    return false;
  }
}
