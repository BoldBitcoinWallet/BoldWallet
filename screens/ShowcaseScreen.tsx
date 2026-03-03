import {CommonActions} from '@react-navigation/native';
import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  NativeModules,
  Modal,
  TextInput,
  ScrollView,
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import DocumentPicker from 'react-native-document-picker';
import EncryptedStorage from 'react-native-encrypted-storage';
import RNFS from 'react-native-fs';
import {useTheme} from '../theme';
import {dbg, isLegacyWallet} from '../utils';
import LegalModal from '../components/LegalModal';
import TransportModeSelector from '../components/TransportModeSelector';
import RestoringIndexesModal from '../components/RestoringIndexesModal';
import LocalCache from '../services/LocalCache';
import {WalletService} from '../services/WalletService';
import {useUser} from '../context/UserContext';
const {BBMTLibNativeModule} = NativeModules;
const ShowcaseScreen = ({navigation}: any) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [agreeToPrivacy, setAgreeToPrivacy] = useState(false);
  const [isLegalModalVisible, setIsLegalModalVisible] = useState(false);
  const [isModeModalVisible, setIsModeModalVisible] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'duo' | 'trio' | null>(null);
  const [isTransportModalVisible, setIsTransportModalVisible] = useState(false);
  const [pendingMode, setPendingMode] = useState<'duo' | 'trio' | null>(null);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy'>(
    'terms',
  );
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isRestoringIndexes, setIsRestoringIndexes] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{
    chain: 'external' | 'internal';
    index: number;
    gapIndex: number;
  } | null>(null);
  const {theme} = useTheme();
  const {setActiveNetwork} = useUser();
  const fadeAnim = useRef(new Animated.Value(0.6)).current;
  const connectorAnim = useRef(new Animated.Value(0)).current;
  const connectorLoopRef = useRef(null as Animated.CompositeAnimation | null);
  // Clear all app cache on component mount (wallet import screen)
  useEffect(() => {
    const clearAllCache = async () => {
      try {
        dbg('=== ShowcaseScreen: Clearing all cache for wallet import');
        // Clear LocalCache
        await LocalCache.clear();
        dbg('LocalCache cleared successfully');
        // Clear stale EncryptedStorage items (but keep keyshare if it exists)
        // We clear btcPub as it will be regenerated with the imported keyshare
        await EncryptedStorage.removeItem('btcPub');
        dbg('Cleared stale btcPub from EncryptedStorage');
        // Clear WalletService cache
        try {
          await LocalCache.removeItem('walletCache');
          dbg('WalletService cache cleared');
        } catch (error) {
          dbg('Error clearing WalletService cache:', error);
        }
        dbg('=== ShowcaseScreen: Cache clearing completed');
      } catch (err) {
        dbg('Error clearing app cache:', err);
      }
    };
    clearAllCache();
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
  useEffect(() => {
    // Start/stop the connector ping-pong animation based on selection and modal visibility
    if (isModeModalVisible && selectedMode) {
      connectorLoopRef.current?.stop?.();
      connectorAnim.setValue(0);
      connectorLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(connectorAnim, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(connectorAnim, {
            toValue: 0,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      connectorLoopRef.current.start();
    } else {
      connectorLoopRef.current?.stop?.();
      connectorAnim.stopAnimation();
      connectorAnim.setValue(0);
    }
  }, [isModeModalVisible, selectedMode, connectorAnim]);
  // Reset selection each time the mode modal opens
  useEffect(() => {
    if (isModeModalVisible) {
      setSelectedMode(null);
    }
  }, [isModeModalVisible]);
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
        // validate keyshare
        let ks: any;
        try {
          ks = JSON.parse(decryptedKeyshare);
          if (!ks.pub_key) {
            throw 'Error: pub_key not found in keyshare';
          }
        } catch (error) {
          dbg('Error parsing keyshare:', error);
          throw 'Error: Invalid keyshare';
        }
        await EncryptedStorage.setItem('keyshare', decryptedKeyshare);
        // Reset legacy wallet modal flag for new wallet
        // If legacy wallet, set to "no" (show modal); if not legacy, set to "yes" (won't show anyway)
        const isLegacy = isLegacyWallet(ks.created_at);
        await LocalCache.setItem(
          'legacyWalletModalDoNotRemind',
          isLegacy ? 'no' : 'yes',
        );
        // CRITICAL: Always reset network to mainnet on keyshare import
        // This ensures a clean state and proper address derivation for the new wallet
        dbg('=== Keyshare imported: Resetting network to mainnet');
        await setActiveNetwork('mainnet');
        dbg('=== Network reset to mainnet, UserContext will refresh addresses');
        setModalVisible(false);
        setIsRestoringIndexes(true);
        setRestoreProgress(null);
        try {
          // Restore discovery: scan chain to populate HD indexes for all address types
          dbg('ShowcaseScreen: Running restore discovery for all address types');
          const mainnetApi = 'https://mempool.space/api';
          const ws = WalletService.getInstance();
          for (const addrType of ['legacy', 'segwit-native', 'segwit-compatible']) {
            dbg('ShowcaseScreen: Restore discovery for', addrType);
            await ws.discoverHdIndexesForNetwork(
              'mainnet',
              addrType,
              mainnetApi,
              (chain, index, gapIndex) =>
                setRestoreProgress({chain, index, gapIndex}),
            );
          }
          dbg('ShowcaseScreen: Restore discovery complete for all address types');
        } finally {
          setIsRestoringIndexes(false);
          setRestoreProgress(null);
        }
        setPassword('');
        dbg('Navigating to User Preferences');
        setTimeout(() => {
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{name: 'User Preferences'}],
            }),
          );
        }, 1000);
      }
    } catch {
      dbg('Failed to decode as UTF-8. File might be binary.');
      Alert.alert('Error', 'Failed to import the file');
    }
  };
  const handleCloseModal = () => {
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
      fontSize: theme.fontSizes?.['3xl'] || 28,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginTop: 16,
      textAlign: 'center',
      lineHeight: 36,
      marginBottom: 16,
    },
    heroSubtitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.text,
      textAlign: 'center',
      lineHeight: 28,
      paddingHorizontal: 20,
      marginBottom: 16,
    },
    heroTagline: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
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
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
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
      color: theme.colors.white,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
    },
    ctaButtonSecondaryText: {
      color: theme.colors.text,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
    },
    ctaButtonIconContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      position: 'relative',
      gap: 8,
    },
    ctaButtonIcon: {
      width: 20,
      height: 20,
    },
    ctaButtonIconLeft: {
      position: 'absolute',
      left: 0,
      width: 20,
      height: 20,
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
      fontSize: theme.fontSizes?.base || 14,
      textAlign: 'left',
      color: theme.colors.textSecondary,
      marginLeft: 8,
      marginTop: 6,
      lineHeight: 20,
      flex: 1,
      alignSelf: 'center',
    },
    termsLink: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.accent
          : theme.colors.bitcoinOrange,
      textDecorationLine: 'underline',
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
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.text
          : theme.colors.border,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    checkmark: {
      color: theme.colors.background,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
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
    modalSubtitle: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.secondary,
      marginBottom: 20,
      textAlign: 'left',
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
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.white,
    },
    modeOptionsContainer: {
      paddingVertical: 8,
      flexDirection: 'row',
      gap: 12,
      width: '100%',
    },
    modeHintWrapper: {
      alignItems: 'center',
      marginBottom: 20,
    },
    modeHintTitle: {
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
      textAlign: 'left',
      alignSelf: 'flex-start',
    },
    modeHintLine: {
      fontSize: theme.fontSizes?.base || 13,
      color: theme.colors.textSecondary,
      marginTop: 6,
      textAlign: 'left',
      alignSelf: 'flex-start',
    },
    modeHintLineCentered: {
      fontSize: theme.fontSizes?.base || 13,
      color: theme.colors.textSecondary,
      marginTop: 6,
      textAlign: 'center',
    },
    modeOptionCard: {
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      paddingTop: 18,
      paddingBottom: 12,
      position: 'relative',
    },
    modeOptionCardPrimary: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.cardBackground,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.border + '40'
          : theme.colors.border + '60',
    },
    modeOptionCardSelected: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.subPrimary + '10'
          : theme.colors.bitcoinOrange + '20',
      borderWidth: 1.5,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.subPrimary
          : theme.colors.bitcoinOrange,
    },
    modeOptionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
    },
    modeOptionContent: {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      gap: 10,
    },
    modeOptionIcon: {
      width: 26,
      height: 26,
      marginBottom: 0,
    },
    modeIconRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    modeIconRowTrio: {
      gap: 2,
    },
    modeIconWrapper: {
      position: 'relative',
      justifyContent: 'center',
      alignItems: 'center',
      width: '100%',
    },
    modeConnectorLine: {
      position: 'absolute',
      left: '50%',
      marginLeft: -15,
      width: 30,
      top: 30,
      height: 2,
      borderRadius: 1,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.border
          : theme.colors.bitcoinOrange,
      opacity: theme.colors.background === '#ffffff' ? 0.4 : 0.6,
      zIndex: 0,
    },
    modeConnectorLineTrio: {
      marginLeft: -28,
      width: 56,
    },
    modeConnectorDot: {
      position: 'absolute',
      top: 27,
      left: '50%',
      marginLeft: -15,
      width: 6,
      height: 6,
      borderRadius: 3,
      zIndex: 0,
    },
    modeConnectorDotTrio: {
      marginLeft: -28,
    },
    modeOptionTitle: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.background
          : theme.colors.text,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      textAlign: 'center',
    },
    modeSelectedCheck: {
      position: 'absolute',
      top: 10,
      right: 10,
      width: 18,
      height: 18,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.white,
    },
    modeSelectedCheckHidden: {
      opacity: 0,
    },
    modeContinueButton: {
      marginTop: 24,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
    },
    modeContinueButtonDisabled: {
      opacity: 0.5,
    },
    modeContinueButtonText: {
      color: theme.colors.white,
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.bold,
    },
    modeOptionDesc: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.background
          : theme.colors.textSecondary,
      opacity: 0.9,
      textAlign: 'center',
      fontSize: theme.fontSizes?.base || 13,
      marginTop: 6,
      lineHeight: 18,
    },
    modeSelectedHint: {
      opacity: 0.5,
      marginTop: 14,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.cardBackground,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    modeSelectedHintRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      width: '100%',
    },
    modeSelectedHintIcon: {
      width: 20,
      height: 20,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.text,
    },
    modeSelectedHintText: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.text,
      fontSize: theme.fontSizes?.base || 14,
      textAlign: 'left',
      flex: 1,
      flexWrap: 'wrap',
      maxWidth: '100%',
    },
    modeSelectedHintTextBold: {
      fontFamily: theme.fontFamilies?.bold,
    },
    // Setup Guide Hint Styles - Subtle
    setupGuideHint: {
      marginTop: 12,
      alignItems: 'center',
    },
    setupGuideHintTouchable: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
    },
    setupGuideHintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    setupGuideHintIcon: {
      width: 16,
      height: 16,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    setupGuideHintText: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.medium,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      textDecorationLine: 'underline',
      textDecorationColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '80'
          : theme.colors.bitcoinOrange + '80',
    },
  });
  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        overScrollMode="never"
        showsVerticalScrollIndicator={false}>
        <View style={styles.heroSection}>
          <Animated.View style={[styles.logoContainer, {opacity: fadeAnim}]}>
            <Image
              style={styles.storeIcon}
              source={require('../assets/bold-bitcoin-icon.png')}
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
            <Pressable
              style={styles.checkboxContainer}
              onPress={() => {
                setAgreeToTerms(prev => !prev);
              }}>
              <View
                style={[
                  styles.checkbox,
                  agreeToTerms && styles.checkboxChecked,
                ]}>
                {agreeToTerms && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </Pressable>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text
                style={styles.termsLink}
                onPress={() => {
                  setLegalModalType('terms');
                  setIsLegalModalVisible(true);
                }}>
                Terms of Service
              </Text>
            </Text>
          </View>
          <View style={styles.termsRow}>
            <Pressable
              style={styles.checkboxContainer}
              onPress={() => {
                setAgreeToPrivacy(prev => !prev);
              }}>
              <View
                style={[
                  styles.checkbox,
                  agreeToPrivacy && styles.checkboxChecked,
                ]}>
                {agreeToPrivacy && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </Pressable>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text
                style={styles.termsLink}
                onPress={() => {
                  setLegalModalType('privacy');
                  setIsLegalModalVisible(true);
                }}>
                Privacy Policy
              </Text>
            </Text>
          </View>
        </View>
        <View style={styles.ctaButtons}>
          <AppPressable
            style={[
              styles.ctaButtonPrimary,
              (!agreeToTerms || !agreeToPrivacy) && styles.disabledButton,
            ]}
            onPress={() => {
              setIsModeModalVisible(true);
            }}
            disabled={!agreeToTerms || !agreeToPrivacy}>
            <View style={styles.ctaButtonIconContainer}>
              <Image
                source={require('../assets/new-icon.png')}
                style={[
                  styles.ctaButtonIconLeft,
                  {
                    tintColor: theme.colors.white,
                  },
                ]}
                resizeMode="contain"
              />
              <Text style={styles.ctaButtonText}>Setup New Wallet</Text>
            </View>
          </AppPressable>
          <AppPressable
            style={[
              styles.ctaButtonSecondary,
              (!agreeToTerms || !agreeToPrivacy) && styles.disabledButton,
            ]}
            onPress={() => {
              handleRestoreWallet();
            }}
            disabled={!agreeToTerms || !agreeToPrivacy}>
            <View style={styles.ctaButtonIconContainer}>
              <Image
                source={require('../assets/restore-icon.png')}
                style={[
                  styles.ctaButtonIconLeft,
                  {tintColor: theme.colors.text},
                ]}
                resizeMode="contain"
              />
              <Text style={styles.ctaButtonSecondaryText}>
                Restore Existing Wallet
              </Text>
            </View>
          </AppPressable>
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
              <Text style={styles.modalTitle}>Restore Keyshare</Text>
              <AppPressable
                style={styles.closeButton}
                onPress={handleCloseModal}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Text style={styles.closeButtonText}>✕</Text>
              </AppPressable>
            </View>
            {/* Modal Body */}
            <View style={styles.modalBody}>
              {/* Password Input */}
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
                  />
                  <AppPressable
                    style={styles.eyeButton}
                    onPress={() => {
                      setPasswordVisible(!passwordVisible);
                    }}>
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
              {/* Action Buttons */}
              <View style={styles.modalActions}>
                <AppPressable
                  style={[styles.modalActionButton, styles.modalCancelButton]}
                  onPress={handleCloseModal}
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
                  onPress={() => {
                    handlePasswordSubmit();
                  }}
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
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
                </AppPressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
      {/* Legal Modal */}
      <LegalModal
        visible={isLegalModalVisible}
        onClose={() => {
          setIsLegalModalVisible(false);
        }}
        type={legalModalType}
      />
      <RestoringIndexesModal
        visible={isRestoringIndexes}
        chain={restoreProgress?.chain}
        index={restoreProgress?.index}
        gapIndex={restoreProgress?.gapIndex}
      />
      {/* Transport Mode Selector */}
      <TransportModeSelector
        visible={isTransportModalVisible}
        onClose={() => {
          setIsTransportModalVisible(false);
          setPendingMode(null);
        }}
        onSelect={(transport: 'local' | 'nostr') => {
          if (!pendingMode) return;
          if (transport === 'local') {
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [
                  {
                    name: 'Devices Pairing',
                    params: {mode: pendingMode},
                  },
                ],
              }),
            );
          } else {
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [
                  {
                    name: 'Nostr Connect',
                    params: {mode: pendingMode},
                  },
                ],
              }),
            );
          }
        }}
        title="Select Pairing Method"
        description="Choose how to connect with other devices"
      />
      {/* Mode Selection Modal */}
      <Modal
        transparent={true}
        visible={isModeModalVisible}
        animationType="fade"
        onRequestClose={() => setIsModeModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Image
                source={require('../assets/security-icon.png')}
                style={styles.modalHeaderIconImage}
              />
              <Text style={styles.modalTitle}>Choose Your Setup</Text>
              <AppPressable
                style={styles.closeButton}
                onPress={() => {
                  setIsModeModalVisible(false);
                }}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Text style={styles.closeButtonText}>✕</Text>
              </AppPressable>
            </View>
            <View style={styles.modalBody}>
              <View style={styles.modeOptionsContainer}>
                <AppPressable
                  style={[
                    styles.modeOptionCard,
                    styles.modeOptionCardPrimary,
                    selectedMode === 'duo' && styles.modeOptionCardSelected,
                  ]}
                  onPress={() => {
                    setSelectedMode('duo');
                  }}
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <View style={styles.modeOptionContent}>
                    <View style={styles.modeIconWrapper}>
                      {selectedMode === 'duo' && (
                        <View style={styles.modeConnectorLine} />
                      )}
                      {selectedMode === 'duo' && (
                        <Animated.View
                          style={[
                            styles.modeConnectorDot,
                            {
                              backgroundColor:
                                theme.colors.background === '#ffffff'
                                  ? theme.colors.primary
                                  : theme.colors.bitcoinOrange,
                              transform: [
                                {
                                  translateX: connectorAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0, 24],
                                  }),
                                },
                              ],
                            },
                          ]}
                        />
                      )}
                      <View style={styles.modeIconRow}>
                        <Image
                          source={require('../assets/phone-icon.png')}
                          style={[
                            styles.modeOptionIcon,
                            {
                              tintColor:
                                theme.colors.background === '#ffffff'
                                  ? theme.colors.primary
                                  : theme.colors.bitcoinOrange,
                            },
                          ]}
                          resizeMode="contain"
                        />
                        <Image
                          source={require('../assets/phone-icon.png')}
                          style={[
                            styles.modeOptionIcon,
                            {
                              tintColor:
                                theme.colors.background === '#ffffff'
                                  ? theme.colors.primary
                                  : theme.colors.bitcoinOrange,
                            },
                          ]}
                          resizeMode="contain"
                        />
                      </View>
                    </View>
                    <Text
                      style={[
                        styles.modeOptionTitle,
                        {
                          color:
                            theme.colors.background === '#ffffff'
                              ? theme.colors.primary
                              : theme.colors.text,
                        },
                      ]}>
                      Duo
                    </Text>
                  </View>
                </AppPressable>
                <AppPressable
                  style={[
                    styles.modeOptionCard,
                    styles.modeOptionCardPrimary,
                    selectedMode === 'trio' && styles.modeOptionCardSelected,
                  ]}
                  onPress={() => {
                    setSelectedMode('trio');
                  }}
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <View style={styles.modeOptionContent}>
                    <View style={styles.modeIconWrapper}>
                      {selectedMode === 'trio' && (
                        <View
                          style={[
                            styles.modeConnectorLine,
                            styles.modeConnectorLineTrio,
                          ]}
                        />
                      )}
                      {selectedMode === 'trio' && (
                        <Animated.View
                          style={[
                            styles.modeConnectorDot,
                            styles.modeConnectorDotTrio,
                            {
                              backgroundColor:
                                theme.colors.background === '#ffffff'
                                  ? theme.colors.primary
                                  : theme.colors.accent,
                              transform: [
                                {
                                  translateX: connectorAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0, 50],
                                  }),
                                },
                              ],
                            },
                          ]}
                        />
                      )}
                      <View
                        style={[styles.modeIconRow, styles.modeIconRowTrio]}>
                        <Image
                          source={require('../assets/phone-icon.png')}
                          style={[
                            styles.modeOptionIcon,
                            {
                              tintColor:
                                theme.colors.background === '#ffffff'
                                  ? theme.colors.primary
                                  : theme.colors.bitcoinOrange,
                            },
                          ]}
                          resizeMode="contain"
                        />
                        <Image
                          source={require('../assets/phone-icon.png')}
                          style={[
                            styles.modeOptionIcon,
                            {
                              tintColor:
                                theme.colors.background === '#ffffff'
                                  ? theme.colors.primary
                                  : theme.colors.bitcoinOrange,
                            },
                          ]}
                          resizeMode="contain"
                        />
                        <Image
                          source={require('../assets/phone-icon.png')}
                          style={[
                            styles.modeOptionIcon,
                            {
                              tintColor:
                                theme.colors.background === '#ffffff'
                                  ? theme.colors.border
                                  : theme.colors.textSecondary,
                            },
                          ]}
                          resizeMode="contain"
                        />
                      </View>
                    </View>
                    <Text
                      style={[
                        styles.modeOptionTitle,
                        {
                          color:
                            theme.colors.background === '#ffffff'
                              ? theme.colors.primary
                              : theme.colors.text,
                        },
                      ]}>
                      Trio
                    </Text>
                  </View>
                </AppPressable>
              </View>
              {selectedMode && (
                <View style={styles.modeSelectedHint}>
                  <View style={styles.modeSelectedHintRow}>
                    <Image
                      source={require('../assets/bulb-icon.png')}
                      style={styles.modeSelectedHintIcon}
                      resizeMode="contain"
                    />
                    {selectedMode === 'duo' ? (
                      <Text style={styles.modeSelectedHintText}>
                        <Text style={styles.modeSelectedHintTextBold}>
                          Duo (2/2)
                        </Text>
                        : two devices needed for wallet setup. both of them must
                        approve transactions when spending funds.
                      </Text>
                    ) : (
                      <Text style={styles.modeSelectedHintText}>
                        <Text style={styles.modeSelectedHintTextBold}>
                          Trio (2/3)
                        </Text>
                        : three devices needed for wallet setup. any 2 of them
                        must approve transactions when spending funds.
                      </Text>
                    )}
                  </View>
                </View>
              )}
              {/* Setup Guide Video Hint - Subtle */}
              {selectedMode && (
                <View style={styles.setupGuideHint}>
                  <AppPressable
                    style={styles.setupGuideHintTouchable}
                    onPress={() => {
                      const url =
                        'https://x.com/boldbtcwallet/status/1988322162386854108';
                      Linking.openURL(url).catch(err => {
                        Alert.alert('Error', 'Unable to open the video link');
                        dbg('Error opening URL:', err);
                      });
                    }}
                    android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                    <View style={styles.setupGuideHintRow}>
                      <Image
                        source={require('../assets/start-icon.png')}
                        style={styles.setupGuideHintIcon}
                        resizeMode="contain"
                      />
                      <Text style={styles.setupGuideHintText}>
                        🎥 Watch setup guide →
                      </Text>
                    </View>
                  </AppPressable>
                </View>
              )}
              <AppPressable
                style={[
                  styles.modalSubmitButton,
                  styles.modeContinueButton,
                  !selectedMode && styles.modeContinueButtonDisabled,
                ]}
                onPress={() => {
                  if (!selectedMode) return;
                  setIsModeModalVisible(false);
                  setPendingMode(selectedMode);
                  setIsTransportModalVisible(true);
                }}
                disabled={!selectedMode}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Text style={styles.modeContinueButtonText}>
                  Continue to Pair Devices →
                </Text>
              </AppPressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};
export default ShowcaseScreen;
