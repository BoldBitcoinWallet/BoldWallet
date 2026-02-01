import React, {useState} from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Alert,
  StyleSheet,
} from 'react-native';
import AppPressable from './AppPressable';
import {NativeModules} from 'react-native';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import EncryptedStorage from 'react-native-encrypted-storage';
import {dbg, HapticFeedback} from '../utils';
import {getKeyshareLabel} from '../utils';
import {useTheme} from '../theme';
import {createStyles} from './Styles';

const {BBMTLibNativeModule} = NativeModules;

interface BackupKeyshareModalProps {
  visible: boolean;
  onClose: () => void;
  description?: string;
  onBackupComplete?: () => void;
}

const BackupKeyshareModal: React.FC<BackupKeyshareModalProps> = ({
  visible,
  onClose,
  description,
  onBackupComplete,
}) => {
  const {theme} = useTheme();
  const globalStyles = createStyles(theme);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const validatePassword = (pass: string) => {
    const errors: string[] = [];
    const rules = {
      length: pass.length >= 12,
      uppercase: /[A-Z]/.test(pass),
      lowercase: /[a-z]/.test(pass),
      number: /\d/.test(pass),
      symbol: /[!@#$%^&*(),.?":{}|<>]/.test(pass),
    };

    if (!rules.length) {
      errors.push('12+ characters');
    }
    if (!rules.uppercase) {
      errors.push('Uppercase letter (A-Z)');
    }
    if (!rules.lowercase) {
      errors.push('Lowercase letter (a-z)');
    }
    if (!rules.number) {
      errors.push('Number (0-9)');
    }
    if (!rules.symbol) {
      errors.push('Special character (!@#$...)');
    }

    setPasswordErrors(errors);
    // Calculate strength (0-4)
    const strength = Object.values(rules).filter(Boolean).length;
    setPasswordStrength(strength);
    return errors.length === 0;
  };

  const getPasswordStrengthColor = () => {
    if (passwordStrength <= 1) {
      return theme.colors.danger;
    }
    if (passwordStrength <= 2) {
      return theme.colors.warning;
    }
    if (passwordStrength <= 3) {
      return theme.colors.warningLight;
    }
    return theme.colors.received;
  };

  const getPasswordStrengthText = () => {
    if (passwordStrength <= 1) {
      return 'Very Weak';
    }
    if (passwordStrength <= 2) {
      return 'Weak';
    }
    if (passwordStrength <= 3) {
      return 'Medium';
    }
    return 'Strong';
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    if (text.length > 0) {
      validatePassword(text);
    } else {
      setPasswordStrength(0);
      setPasswordErrors([]);
    }
  };

  const clearModal = () => {
    setPassword('');
    setConfirmPassword('');
    setPasswordVisible(false);
    setConfirmPasswordVisible(false);
    setPasswordStrength(0);
    setPasswordErrors([]);
    onClose();
  };

  const handleBackup = async () => {
    if (!validatePassword(password)) {
      const missingRequirements = passwordErrors.join('\n• ');
      Alert.alert(
        'Password Requirements Not Met',
        `Your password must meet all of the following requirements:\n\n• ${missingRequirements}\n\nPlease update your password and try again.`,
      );
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(
        'Passwords Do Not Match',
        'The password and confirmation password must be identical. Please check both fields and try again.',
      );
      return;
    }

    try {
      HapticFeedback.medium();
      const storedKeyshare = await EncryptedStorage.getItem('keyshare');
      if (storedKeyshare) {
        const json = JSON.parse(storedKeyshare);
        const encryptedKeyshare = await BBMTLibNativeModule.aesEncrypt(
          storedKeyshare,
          await BBMTLibNativeModule.sha256(password),
        );

        // Create filename based on pub_key hash and keyshare number
        if (!json.pub_key) {
          Alert.alert('Error', 'Keyshare missing pub_key.');
          return;
        }

        // Get SHA256 hash of pub_key and take first 4 characters
        const pubKeyHash = await BBMTLibNativeModule.sha256(json.pub_key);
        const hashPrefix = pubKeyHash.substring(0, 4).toLowerCase();

        // Extract keyshare number from label (KeyShare1 -> 1, KeyShare2 -> 2, etc.)
        const keyshareLabel = getKeyshareLabel(json);
        let keyshareNumber = '1'; // default
        if (keyshareLabel) {
          const match = keyshareLabel.match(/KeyShare(\d+)/);
          if (match) {
            keyshareNumber = match[1];
          }
        } else if (json.keygen_committee_keys && json.local_party_key) {
          // Fallback: compute from position in sorted keygen_committee_keys
          const sortedKeys = [...json.keygen_committee_keys].sort();
          const index = sortedKeys.indexOf(json.local_party_key);
          if (index >= 0) {
            keyshareNumber = String(index + 1);
          }
        }

        const friendlyFilename = `${hashPrefix}K${keyshareNumber}.share`;
        const tempDir = RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath;
        const filePath = `${tempDir}/${friendlyFilename}`;
        await RNFS.writeFile(filePath, encryptedKeyshare, 'base64');

        await Share.open({
          title: 'Backup Your Keyshare',
          isNewTask: true,
          message:
            'Save this encrypted file securely. It is required for wallet recovery.',
          url: `file://${filePath}`,
          type: 'application/octet-stream',
          filename: friendlyFilename,
          failOnCancel: false,
        });

        // Cleanup temp file (best-effort)
        try {
          await RNFS.unlink(filePath);
        } catch {
          // ignore cleanup errors
        }

        clearModal();
        if (onBackupComplete) {
          onBackupComplete();
        }
      } else {
        Alert.alert('Error', 'Invalid keyshare.');
      }
    } catch (error) {
      dbg('Error encrypting or sharing keyshare:', error);
      Alert.alert('Error', 'Failed to encrypt or share the keyshare.');
    }
  };

  const defaultDescription =
    'Create an encrypted backup of your keyshare, protected by a strong password.';

  const styles = StyleSheet.create({
    flexContainer: {
      flex: 1,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    modalIcon: {
      width: 24,
      height: 24,
      marginRight: 10,
      tintColor: theme.colors.text,
    },
    modalTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    modalDescription: {
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.textSecondary,
      marginBottom: 20,
      textAlign: 'center',
    },
    passwordContainer: {
      marginBottom: 12,
    },
    passwordLabel: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 4,
    },
    passwordInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 6,
      width: '100%',
    },
    passwordInput: {
      flex: 1,
      padding: 10,
      fontSize: theme.fontSizes?.base || 13,
      color: theme.colors.text,
    },
    eyeButton: {
      padding: 10,
    },
    eyeIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.text,
    },
    strengthContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
      marginBottom: 8,
    },
    strengthBar: {
      flex: 1,
      height: 8,
      backgroundColor: theme.colors.border,
      borderRadius: 4,
      marginRight: 12,
      overflow: 'hidden',
    },
    strengthFill: {
      height: '100%',
      borderRadius: 4,
    },
    strengthText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      minWidth: 60,
      textAlign: 'right',
      color: theme.colors.textSecondary,
    },
    requirementsContainer: {
      marginTop: 4,
    },
    requirementText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.warningAccent,
    },
    errorInput: {
      borderColor: theme.colors.danger,
    },
    errorText: {
      color: theme.colors.danger,
      fontSize: theme.fontSizes?.sm || 12,
      marginTop: 4,
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 20,
      gap: 12,
    },
    modalButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButton: {
      backgroundColor: theme.colors.secondary,
    },
    confirmButton: {
      backgroundColor: theme.colors.bitcoinOrange,
    },
    disabledButton: {
      backgroundColor: theme.colors.disabled || theme.colors.border,
      opacity: 0.5,
    },
    cancelButtonText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.text,
      textAlign: 'center',
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonIcon: {
      width: 20,
      height: 20,
      marginRight: 12,
      tintColor: theme.colors.white,
    },
    whiteTint: {
      tintColor: theme.colors.white,
    },
    buttonText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
    },
    buttonTextOnColored: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white,
      textAlign: 'center',
    },
    disabledButtonText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.disabledText || theme.colors.textSecondary,
      textAlign: 'center',
    },
  });

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={clearModal}>
      <KeyboardAvoidingView
        style={styles.flexContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <AppPressable
          style={globalStyles.modalOverlay}
          onPress={() => {
            HapticFeedback.light();
            Keyboard.dismiss();
          }}>
          <AppPressable
            style={globalStyles.modalContent}
            onPress={() => {
              HapticFeedback.light();
            }}>
            <View style={styles.modalHeader}>
              <Image
                source={require('../assets/backup-icon.png')}
                style={styles.modalIcon}
                resizeMode="contain"
              />
              <Text style={styles.modalTitle}>Backup Keyshare</Text>
            </View>
            <Text style={styles.modalDescription}>
              {description || defaultDescription}
            </Text>
            <View style={styles.passwordContainer}>
              <Text style={styles.passwordLabel}>Set a Password</Text>
              <View style={styles.passwordInputContainer}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Enter a strong password"
                  placeholderTextColor={theme.colors.textSecondary + '80'}
                  secureTextEntry={!passwordVisible}
                  value={password}
                  onChangeText={handlePasswordChange}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <AppPressable
                  style={styles.eyeButton}
                  onPress={() => {
                    HapticFeedback.light();
                    setPasswordVisible(!passwordVisible);
                  }}
                  android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                  <Image
                    source={
                      passwordVisible
                        ? require('../assets/eye-off-icon.png')
                        : require('../assets/eye-on-icon.png')
                    }
                    style={styles.eyeIcon}
                    resizeMode="contain"
                  />
                </AppPressable>
              </View>
              {/* Password Strength Indicator */}
              {password.length > 0 && (
                <View style={styles.strengthContainer}>
                  <View style={styles.strengthBar}>
                    <View
                      style={[
                        styles.strengthFill,
                        {
                          width: `${(passwordStrength / 4) * 100}%`,
                          backgroundColor: getPasswordStrengthColor(),
                        },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      styles.strengthText,
                      {color: getPasswordStrengthColor()},
                    ]}>
                    {getPasswordStrengthText()}
                  </Text>
                </View>
              )}
              {/* Password Requirements */}
              {passwordErrors.length > 0 && (
                <View style={styles.requirementsContainer}>
                  {passwordErrors.map((error, index) => (
                    <Text key={index} style={styles.requirementText}>
                      • {error}
                    </Text>
                  ))}
                </View>
              )}
            </View>
            <View style={styles.passwordContainer}>
              <Text style={styles.passwordLabel}>Confirm Password</Text>
              <View style={styles.passwordInputContainer}>
                <TextInput
                  style={[
                    styles.passwordInput,
                    confirmPassword.length > 0 &&
                      password !== confirmPassword &&
                      styles.errorInput,
                  ]}
                  placeholder="Confirm your password"
                  placeholderTextColor={theme.colors.textSecondary + '80'}
                  secureTextEntry={!confirmPasswordVisible}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <AppPressable
                  style={styles.eyeButton}
                  onPress={() => {
                    HapticFeedback.light();
                    setConfirmPasswordVisible(!confirmPasswordVisible);
                  }}
                  android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                  <Image
                    source={
                      confirmPasswordVisible
                        ? require('../assets/eye-off-icon.png')
                        : require('../assets/eye-on-icon.png')
                    }
                    style={styles.eyeIcon}
                    resizeMode="contain"
                  />
                </AppPressable>
              </View>
              {confirmPassword.length > 0 &&
                password !== confirmPassword && (
                  <Text style={styles.errorText}>Passwords do not match</Text>
                )}
            </View>
            <View style={styles.modalActions}>
              <AppPressable
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  HapticFeedback.light();
                  clearModal();
                }}
                android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </AppPressable>
              <AppPressable
                style={[
                  styles.modalButton,
                  styles.confirmButton,
                  (!password ||
                    !confirmPassword ||
                    password !== confirmPassword ||
                    passwordStrength < 3) &&
                    styles.disabledButton,
                ]}
                onPress={handleBackup}
                disabled={
                  !password ||
                  !confirmPassword ||
                  password !== confirmPassword ||
                  passwordStrength < 3
                }
                android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                <View style={styles.buttonContent}>
                  <Image
                    source={require('../assets/upload-icon.png')}
                    style={[styles.buttonIcon, styles.whiteTint]}
                    resizeMode="contain"
                  />
                  <Text style={styles.buttonTextOnColored}>Backup</Text>
                </View>
              </AppPressable>
            </View>
          </AppPressable>
        </AppPressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default BackupKeyshareModal;
