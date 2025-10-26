import {CommonActions} from '@react-navigation/native';
import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  NativeModules,
  Modal,
  TextInput,
  ScrollView,
  Animated,
  Easing,
  Image,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import EncryptedStorage from 'react-native-encrypted-storage';
import RNFS from 'react-native-fs';
import {useTheme} from '../theme';
import {dbg, HapticFeedback} from '../utils';
import LegalModal from '../components/LegalModal';
import LocalCache from '../services/LocalCache';

const {BBMTLibNativeModule} = NativeModules;

const ShowcaseScreen = ({navigation}: any) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [agreeToPrivacy, setAgreeToPrivacy] = useState(false);
  const [isLegalModalVisible, setIsLegalModalVisible] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy'>(
    'terms',
  );
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const {theme} = useTheme();

  const fadeAnim = useRef(new Animated.Value(0.6)).current;

  // Clear all app cache on component mount
  useEffect(() => {
    const clearAppCache = async () => {
      try {
        dbg('Clearing all app cache on ShowcaseScreen mount');
        await LocalCache.clear();
        // Avoid clearing persistent wallet cache; keep offline data
        dbg('App cache cleared successfully');
      } catch (_error) {
        dbg('Error clearing app cache:', _error);
      }
    };

    clearAppCache();
  }, []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.cubic,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0.6,
          duration: 1000,
          easing: Easing.cubic,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [fadeAnim]);

  const handleContentUri = async (uri: any) => {
    try {
      const localFilePath = `${RNFS.DocumentDirectoryPath}/tempFile.txt`;

      // Check if the file already exists and delete it if it does
      if (await RNFS.exists(localFilePath)) {
        await RNFS.unlink(localFilePath);
      }

      // Copy the file to a local path
      await RNFS.copyFile(uri, localFilePath);

      // Read the file content as base64
      const content = await RNFS.readFile(localFilePath, 'base64');

      // Clean up the temporary file
      await RNFS.unlink(localFilePath);

      return content;
    } catch (_error) {
      dbg('Error handling content URI:', _error);
      return '';
    }
  };

  // Handle the restore wallet process
  const handleRestoreWallet = async () => {
    try {
      const res = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.allFiles],
      });
      const uri = `${res.uri}`;

      let content = await handleContentUri(uri);
      setFileContent(content);
      setModalVisible(true);
    } catch (err: any) {
      if (DocumentPicker.isCancel(err)) {
        dbg('User cancelled the picker');
      } else {
        dbg('Error reading file:', err.message || err);
        Alert.alert('Error', 'Failed to read the file');
      }
    }
  };

  const handlePasswordSubmit = async () => {
    try {
      const decryptedKeyshare = await BBMTLibNativeModule.aesDecrypt(
        fileContent,
        await BBMTLibNativeModule.sha256(password),
      );
      if (decryptedKeyshare.indexOf('pub_key') < 0) {
        Alert.alert('Wrong Password', 'Could not import keyshare');
      } else {
        await EncryptedStorage.setItem('keyshare', decryptedKeyshare);
        setModalVisible(false);
        setPassword('');
        dbg('Opening Home');
        setTimeout(() => {
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{name: 'Bold Home'}],
            }),
          );
        }, 1000);
      }
    } catch {
      dbg('Failed to decode as UTF-8. File might be binary.');
      Alert.alert('Error', 'Failed to decrypt the file');
    }
  };

  const handleCloseModal = () => {
    HapticFeedback.medium();
    setModalVisible(false);
    setPassword('');
    setIsPasswordFocused(false);
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollContainer: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    heroSection: {
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      paddingVertical: 20,
    },
    heroTitle: {
      fontSize: 28,
      fontWeight: '700',
      color: theme.colors.text,
      marginTop: 16,
      textAlign: 'center',
      lineHeight: 36,
      marginBottom: 16,
    },
    heroSubtitle: {
      fontSize: 20,
      color: theme.colors.primary,
      fontWeight: '700',
      textAlign: 'center',
      lineHeight: 28,
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    heroTagline: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      fontWeight: '500',
      textAlign: 'center',
      lineHeight: 22,
      paddingHorizontal: 20,
      fontStyle: 'italic',
    },
    logoContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    storeIcon: {
      width: 120,
      height: 120,
    },
    bottomActions: {
      alignItems: 'center',
      width: '100%',
      marginBottom: 24,
      paddingHorizontal: 24,
    },
    ctaButtons: {
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 12,
      marginBottom: 24,
      width: '100%',
      paddingHorizontal: 8,
    },
    ctaButtonPrimary: {
      backgroundColor: theme.colors.primary,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      shadowColor: theme.colors.primary,
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 6,
    },
    ctaButtonSecondary: {
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderColor: theme.colors.border,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
    },
    ctaButtonText: {
      color: theme.colors.background,
      fontWeight: '600',
      fontSize: 16,
    },
    ctaButtonSecondaryText: {
      color: theme.colors.text,
      fontWeight: '600',
      fontSize: 16,
    },
    disabledButton: {
      opacity: 0.5,
    },
    termsContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
      paddingHorizontal: 20,
    },
    termsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      marginBottom: 16,
      paddingHorizontal: 10,
    },
    termsText: {
      fontSize: 14,
      textAlign: 'left',
      color: theme.colors.textSecondary,
      marginLeft: 8,
      marginTop: 6,
      lineHeight: 20,
      flex: 1,
      alignSelf: 'center',
    },
    termsLink: {
      color: theme.colors.accent,
      textDecorationLine: 'underline',
      fontWeight: '600',
    },
    checkboxContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 0,
      padding: 8,
      margin: -8,
    },
    checkbox: {
      width: 28,
      height: 28,
      borderWidth: 2,
      borderColor: theme.colors.border,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    checkmark: {
      color: theme.colors.background,
      fontSize: 16,
      fontWeight: 'bold',
    },
    // Enhanced Modal Styles
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
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(0,0,0,0.05)',
    },
    modalTitle: {
      fontSize: 22,
      fontWeight: '700',
      marginLeft: 12,
      color: theme.colors.text,
      flex: 1,
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(0,0,0,0.05)',
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 12,
    },
    closeButtonText: {
      fontSize: 24,
      color: theme.colors.text,
      fontWeight: '600',
    },
    modalBody: {
      paddingHorizontal: 24,
      paddingVertical: 20,
    },
    modalSubtitle: {
      fontSize: 14,
      color: theme.colors.secondary,
      marginBottom: 20,
      textAlign: 'center',
      fontWeight: '500',
    },
    passwordInputContainer: {
      marginBottom: 24,
    },
    passwordInputLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 10,
      paddingHorizontal: 4,
    },
    passwordInput: {
      borderWidth: 1.5,
      borderColor: theme.colors.accent,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: theme.colors.text,
      backgroundColor: 'rgba(0,0,0,0.02)',
      fontWeight: '500',
    },
    passwordInputFocused: {
      borderColor: theme.colors.primary,
      backgroundColor: 'rgba(0,0,0,0.03)',
    },
    modalActions: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 24,
      paddingBottom: 24,
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    modalActionButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: '600',
      flexDirection: 'row',
      gap: 2,
    },
    modalCancelButton: {
      backgroundColor: 'rgba(0,0,0,0.05)',
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.1)',
    },
    modalSubmitButton: {
      backgroundColor: theme.colors.primary,
    },
    modalActionButtonText: {
      fontSize: 14,
      fontWeight: '600',
      letterSpacing: 0.3,
    },
    modalCancelButtonText: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: '500',
    },
    modalSubmitButtonText: {
      color: theme.colors.background,
      fontSize: 14,
      fontWeight: '600',
    },
    modalHeaderIconImage: {
      width: 20,
      height: 20,
      tintColor: theme.colors.primary,
    },
    buttonIcon: {
      width: 16,
      height: 16,
      tintColor: theme.colors.background,
    },
  });

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.heroSection}>
          <Animated.View style={[styles.logoContainer, {opacity: fadeAnim}]}>
            <Image
              style={styles.storeIcon}
              source={require('../assets/playstore-icon.png')}
            />
          </Animated.View>
          <Text style={styles.heroSubtitle}>
            Seedless.{'\n'}Hardware-Free.{'\n'}Limitless.
          </Text>
          <Text style={styles.heroTagline}>
            The future of Bitcoin self-custody
          </Text>
        </View>
      </ScrollView>

      <View style={styles.bottomActions}>
        <View style={styles.termsContainer}>
          <View style={styles.termsRow}>
            <TouchableOpacity
              style={styles.checkboxContainer}
              onPress={() => {
                HapticFeedback.medium();
                setAgreeToTerms(prev => !prev);
              }}>
              <View
                style={[styles.checkbox, agreeToTerms && styles.checkboxChecked]}>
                {agreeToTerms && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </View>
            </TouchableOpacity>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text
                style={styles.termsLink}
                onPress={() => {
                  HapticFeedback.medium();
                  setLegalModalType('terms');
                  setIsLegalModalVisible(true);
                }}>
                Terms of Service
              </Text>
            </Text>
          </View>
          
          <View style={styles.termsRow}>
            <TouchableOpacity
              style={styles.checkboxContainer}
              onPress={() => {
                HapticFeedback.medium();
                setAgreeToPrivacy(prev => !prev);
              }}>
              <View
                style={[styles.checkbox, agreeToPrivacy && styles.checkboxChecked]}>
                {agreeToPrivacy && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </View>
            </TouchableOpacity>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text
                style={styles.termsLink}
                onPress={() => {
                  HapticFeedback.medium();
                  setLegalModalType('privacy');
                  setIsLegalModalVisible(true);
                }}>
                Privacy Policy
              </Text>
            </Text>
          </View>
        </View>
        <View style={styles.ctaButtons}>
          <TouchableOpacity
            style={[styles.ctaButtonPrimary, (!agreeToTerms || !agreeToPrivacy) && styles.disabledButton]}
            onPress={() => {
              HapticFeedback.medium();
              navigation.navigate('📱📱 Pairing');
            }}
            disabled={!agreeToTerms || !agreeToPrivacy}>
            <Text style={styles.ctaButtonText}>Setup New Wallet</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.ctaButtonSecondary,
              (!agreeToTerms || !agreeToPrivacy) && styles.disabledButton,
            ]}
            onPress={() => {
              HapticFeedback.medium();
              handleRestoreWallet();
            }}
            disabled={!agreeToTerms || !agreeToPrivacy}>
            <Text style={styles.ctaButtonSecondaryText}>Restore Existing Wallet</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Enhanced Password Prompt Modal */}
      <Modal
        transparent={true}
        visible={modalVisible}
        animationType="fade"
        onRequestClose={handleCloseModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header with Close Button */}
            <View style={styles.modalHeader}>
              <Image
                source={require('../assets/locker-icon.png')}
                style={styles.modalHeaderIconImage}
              />
              <Text style={styles.modalTitle}>Load Keyshare</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={handleCloseModal}
                activeOpacity={0.7}>
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Modal Body */}
            <View style={styles.modalBody}>
              <Text style={styles.modalSubtitle}>
                Import your keyshare file to unlock your wallet
              </Text>

              {/* Password Input */}
              <View style={styles.passwordInputContainer}>
                <Text style={styles.passwordInputLabel}>Password</Text>
                <TextInput
                  style={[
                    styles.passwordInput,
                    isPasswordFocused && styles.passwordInputFocused,
                  ]}
                  secureTextEntry
                  placeholder="Enter password"
                  placeholderTextColor={`${theme.colors.text}40`}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setIsPasswordFocused(true)}
                  onBlur={() => setIsPasswordFocused(false)}
                />
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalActionButton, styles.modalCancelButton]}
                  onPress={handleCloseModal}
                  activeOpacity={0.7}>
                  <Text
                    style={[
                      styles.modalActionButtonText,
                      styles.modalCancelButtonText,
                    ]}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalActionButton, styles.modalSubmitButton]}
                  onPress={() => {
                    HapticFeedback.medium();
                    handlePasswordSubmit();
                  }}
                  activeOpacity={0.8}>
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
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Legal Modal */}
      <LegalModal
        visible={isLegalModalVisible}
        onClose={() => {
          HapticFeedback.medium();
          setIsLegalModalVisible(false);
        }}
        type={legalModalType}
      />
    </View>
  );
};

export default ShowcaseScreen;
