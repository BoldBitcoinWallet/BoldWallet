import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  Image,
  ActivityIndicator,
} from 'react-native';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
  isSubmitting?: boolean;
};

const KeyshareImportPasswordModal = ({
  visible,
  onClose,
  onSubmit,
  isSubmitting = false,
}: Props) => {
  const {theme} = useTheme();
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);

  const handleClose = () => {
    setPassword('');
    setIsPasswordFocused(false);
    onClose();
  };

  const handleSubmit = async () => {
    await onSubmit(password);
  };

  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.75)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      width: '85%',
      maxWidth: 420,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 10},
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 10,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    modalTitle: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      marginLeft: 12,
      color: theme.colors.text,
      flex: 1,
    },
    closeButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 12,
      backgroundColor: theme.colors.subPrimary + '10',
      borderRadius: 32,
      borderWidth: 1,
      paddingTop: 2,
      borderColor: theme.colors.border + '10',
    },
    closeButtonText: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    modalBody: {
      paddingHorizontal: 24,
      paddingVertical: 20,
    },
    passwordInputContainer: {
      marginBottom: 24,
    },
    passwordInputLabel: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 10,
      paddingHorizontal: 4,
    },
    passwordInputWrapper: {
      position: 'relative',
      flexDirection: 'row',
      alignItems: 'center',
    },
    passwordInput: {
      borderWidth: 1.5,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent
          : theme.colors.bitcoinOrange,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingRight: 50,
      paddingVertical: 14,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
      backgroundColor: 'rgba(0,0,0,0.02)',
      flex: 1,
    },
    passwordInputFocused: {
      borderColor: theme.colors.primary,
      backgroundColor: 'rgba(0,0,0,0.03)',
    },
    eyeButton: {
      position: 'absolute',
      right: 12,
      padding: 4,
    },
    eyeIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.text,
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    modalActionButton: {
      flex: 1,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingVertical: 14,
      minHeight: 48,
    },
    modalCancelButton: {
      backgroundColor: 'rgba(0,0,0,0.05)',
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.1)',
    },
    modalSubmitButton: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    modalActionButtonText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      letterSpacing: 0.3,
    },
    modalCancelButtonText: {
      color: theme.colors.text,
      fontSize: theme.fontSizes?.base || 14,
    },
    modalSubmitButtonText: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.background
          : theme.colors.white,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
    },
    modalHeaderIconImage: {
      width: 20,
      height: 20,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    buttonIcon: {
      width: 16,
      height: 16,
      tintColor: theme.colors.white,
    },
  });

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Image
              source={require('../assets/locker-icon.png')}
              style={styles.modalHeaderIconImage}
            />
            <Text style={styles.modalTitle}>Restore Keyshare</Text>
            <AppPressable
              style={styles.closeButton}
              onPress={handleClose}
              disabled={isSubmitting}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Text style={styles.closeButtonText}>✕</Text>
            </AppPressable>
          </View>
          <View style={styles.modalBody}>
            <View style={styles.passwordInputContainer}>
              <Text style={styles.passwordInputLabel}>Keyshare Password</Text>
              <View style={styles.passwordInputWrapper}>
                <TextInput
                  style={[
                    styles.passwordInput,
                    isPasswordFocused && styles.passwordInputFocused,
                  ]}
                  secureTextEntry={!passwordVisible}
                  placeholder="Enter the password"
                  placeholderTextColor={`${theme.colors.text}40`}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setIsPasswordFocused(true)}
                  onBlur={() => setIsPasswordFocused(false)}
                  editable={!isSubmitting}
                />
                <AppPressable
                  style={styles.eyeButton}
                  onPress={() => setPasswordVisible(!passwordVisible)}>
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
            </View>
            <View style={styles.modalActions}>
              <AppPressable
                style={[styles.modalActionButton, styles.modalCancelButton]}
                onPress={handleClose}
                disabled={isSubmitting}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Text
                  style={[
                    styles.modalActionButtonText,
                    styles.modalCancelButtonText,
                  ]}>
                  Cancel
                </Text>
              </AppPressable>
              <AppPressable
                style={[styles.modalActionButton, styles.modalSubmitButton]}
                onPress={handleSubmit}
                disabled={isSubmitting}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                {isSubmitting ? (
                  <ActivityIndicator color={theme.colors.white} size="small" />
                ) : (
                  <>
                    <Image
                      source={require('../assets/key-icon.png')}
                      style={styles.buttonIcon}
                      resizeMode="contain"
                    />
                    <Text
                      style={[
                        styles.modalActionButtonText,
                        styles.modalSubmitButtonText,
                      ]}>
                      Import
                    </Text>
                  </>
                )}
              </AppPressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default KeyshareImportPasswordModal;
