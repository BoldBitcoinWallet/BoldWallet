import {CommonActions} from '@react-navigation/native';
import {confirmAppPrompt, showAppNotice} from '../services/appPrompt';
import Toast from 'react-native-toast-message';
import {
  beginAirgapImportSession,
  endAirgapImportSession,
} from '../services/airgapImportSession';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  Easing,
  Image,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import DocumentPicker from 'react-native-document-picker';
import {useTheme} from '../theme';
import EncryptedStorage from 'react-native-encrypted-storage';
import {
  dbg,
  hasWalletKeyshareInSecureStorage,
  clearKeyshareMetadata,
  KEYSHARE_STORAGE_KEY,
} from '../utils';
import {
  clearShowcaseImportPrefs,
  removeLegacyEncryptedPrefKeys,
} from '../services/encryptedPrefsMigration';
import {discardPendingKeyshares} from '../services/keyshareHandles';
import KeyshareImportPasswordModal from '../components/KeyshareImportPasswordModal';
import QRScanner, {stopAndroidContinuousScan} from '../components/QRScanner';
import {
  AirgapHostResumeError,
  waitForAirgapHostScreen,
} from '../utils/airgapHostResume';
import {
  assertNoExistingWallet,
  importKeyshareFromBase64,
  readBackupBlobFromUri,
  showKeyshareImportError,
  showWalletAlreadyLoadedAlert,
  WalletAlreadyLoadedError,
  WrongKeysharePasswordError,
} from '../services/keyshareImport';
import LegalModal from '../components/LegalModal';
import {clearCachesBeforeWalletSession} from '../services/walletSessionReset';
import {useUser} from '../context/UserContext';
import {shouldIgnoreNonUrDuringSendScan} from '../utils/sendQrScan';
import {
  airgapV2Envelope,
  createUrDecoder,
  decoderMatchesPartSeqLen,
  receiveUrBytesPartAsBase64,
  urSeqIndexFromPart,
  type UrBytesProgress,
} from '../utils/urBytesQr';
const AIRGAP_IMPORT_TIMEOUT_MS = 90_000;

const ShowcaseScreen = ({navigation}: any) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [fileContent, setFileContent] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [restoreMode, setRestoreMode] = useState<'file' | 'airgap' | null>(
    null,
  );
  const [airgapCipherBase64, setAirgapCipherBase64] = useState('');
  const [isAirgapScannerVisible, setIsAirgapScannerVisible] = useState(false);
  const [airgapUrProgress, setAirgapUrProgress] =
    useState<UrBytesProgress | null>(null);
  const airgapUrDecoderRef = useRef<ReturnType<typeof createUrDecoder> | null>(
    null,
  );
  const airgapImportingRef = useRef(false);
  const airgapImportEpochRef = useRef(0);
  const airgapPasswordRef = useRef('');
  const airgapLastLoggedReceivedRef = useRef(-1);
  const [walletAlreadyLoaded, setWalletAlreadyLoaded] = useState(false);
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [agreeToPrivacy, setAgreeToPrivacy] = useState(false);
  const [isLegalModalVisible, setIsLegalModalVisible] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy'>(
    'terms',
  );
  const {theme} = useTheme();
  const {setActiveNetwork} = useUser();
  const fadeAnim = useRef(new Animated.Value(0.6)).current;
  // Full reset on mount: wipe wallet DB tables, in-memory caches, and
  // import-time prefs in `app_config`. The keyshare blob and keyshare meta stay
  // so a user who already onboarded can land here without losing key material.
  useEffect(() => {
    const clearAllCache = async () => {
      try {
        dbg('=== ShowcaseScreen: Full reset for wallet import');
        await clearCachesBeforeWalletSession();
        dbg('Wallet caches cleared');

        // Display / PIN / debug prefs. Launcher identity + keyshare meta stay.
        clearShowcaseImportPrefs();
        await removeLegacyEncryptedPrefKeys();
        dbg('Import prefs cleared');

        dbg('=== ShowcaseScreen: Full reset completed');
      } catch (err) {
        dbg('ShowcaseScreen: Error during full reset:', err);
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
    hasWalletKeyshareInSecureStorage()
      .then(setWalletAlreadyLoaded)
      .catch(() => setWalletAlreadyLoaded(false));
  }, []);
  useEffect(() => {
    const holding =
      isAirgapScannerVisible || (isImporting && restoreMode === 'airgap');
    if (!holding) {
      return;
    }
    beginAirgapImportSession();
    return () => endAirgapImportSession();
  }, [isAirgapScannerVisible, isImporting, restoreMode]);
  const openLoadedWallet = () => {
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{name: 'MainTabs'}],
      }),
    );
  };
  const removeLoadedKeyshare = () => {
    confirmAppPrompt({
      icon: 'delete',
      title: 'Remove this wallet?',
      hint: 'A backup file you already saved stays.',
      cancelLabel: 'Cancel',
      confirmLabel: 'Remove',
      tone: 'danger',
    }).then(async ok => {
      if (!ok) {
        return;
      }
      try {
        await EncryptedStorage.removeItem(KEYSHARE_STORAGE_KEY);
      } catch (e) {
        dbg('Showcase: keyshare remove failed', e);
      }
      await clearKeyshareMetadata();
      // F15b-1 (A10): wipe any Go-staged keyshare behind a dropped handle.
      await discardPendingKeyshares();
      setWalletAlreadyLoaded(false);
    });
  };
  const handleRestoreWallet = async () => {
    try {
      await assertNoExistingWallet();
      const res = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.allFiles],
      });
      const content = await readBackupBlobFromUri(`${res.uri}`);
      setRestoreMode('file');
      setFileContent(content);
      setModalVisible(true);
    } catch (err: any) {
      if (err instanceof WalletAlreadyLoadedError) {
        showWalletAlreadyLoadedAlert();
        return;
      }
      if (DocumentPicker.isCancel(err)) {
        dbg('User cancelled the picker');
      } else {
        dbg('Error reading file:', err.message || err);
        showAppNotice('Error', 'Failed to read the file');
      }
    }
  };
  const resetAirgapRestore = useCallback(() => {
    airgapPasswordRef.current = '';
    setAirgapCipherBase64('');
    setIsAirgapScannerVisible(false);
    setAirgapUrProgress(null);
    airgapUrDecoderRef.current = null;
    airgapImportingRef.current = false;
    airgapLastLoggedReceivedRef.current = -1;
  }, []);
  const handleRestoreViaAirgap = async () => {
    try {
      await assertNoExistingWallet();
      setRestoreMode('airgap');
      setAirgapCipherBase64('');
      airgapPasswordRef.current = '';
      setModalVisible(true);
    } catch (err: any) {
      if (err instanceof WalletAlreadyLoadedError) {
        showWalletAlreadyLoadedAlert();
        return;
      }
      dbg('Error starting airgap restore:', err?.message || err);
    }
  };
  const importAirgapCipher = useCallback(
    async (base64Content: string, password: string) => {
      const epoch = ++airgapImportEpochRef.current;
      airgapImportingRef.current = true;
      setIsImporting(true);
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let invalidated = false;
      try {
        // Camera activity / scanner modal must be gone before the OS auth
        // sheet. Prompting during that handoff never calls back.
        await waitForAirgapHostScreen();
        if (airgapImportEpochRef.current !== epoch) {
          return;
        }
        const envelope = airgapV2Envelope(base64Content);
        const imported = importKeyshareFromBase64(envelope, password, {
          setActiveNetwork,
          landOn: 'wallet-home',
          navigate: action => {
            if (airgapImportEpochRef.current !== epoch) {
              return;
            }
            navigation.dispatch(action);
          },
        });
        imported.catch(() => undefined);
        const timedOut = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error('AIRGAP_IMPORT_TIMEOUT'));
          }, AIRGAP_IMPORT_TIMEOUT_MS);
        });
        await Promise.race([imported, timedOut]);
        if (airgapImportEpochRef.current !== epoch) {
          return;
        }
        setModalVisible(false);
        setRestoreMode(null);
        resetAirgapRestore();
        Toast.show({
          type: 'success',
          text1: 'Keyshare imported',
          text2: 'Opening your wallet.',
          position: 'top',
        });
      } catch (error) {
        if (airgapImportEpochRef.current !== epoch) {
          return;
        }
        airgapImportingRef.current = false;
        const stalled =
          (error instanceof Error && error.message === 'AIRGAP_IMPORT_TIMEOUT') ||
          error instanceof AirgapHostResumeError;
        if (stalled) {
          // Drop a late success so a prompt that returns after the timeout
          // cannot navigate away from the error.
          invalidated = true;
          airgapImportEpochRef.current += 1;
          showAppNotice(
            'Import timed out',
            error instanceof AirgapHostResumeError
              ? error.message
              : 'Authentication did not finish. Scan the QR again.',
          );
          setModalVisible(false);
          setRestoreMode(null);
          resetAirgapRestore();
        } else if (error instanceof WrongKeysharePasswordError) {
          showAppNotice('Wrong PIN', 'That PIN does not match this QR.');
          setIsAirgapScannerVisible(false);
          setModalVisible(true);
        } else {
          showKeyshareImportError(error);
          setModalVisible(false);
          setRestoreMode(null);
          resetAirgapRestore();
        }
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (airgapImportEpochRef.current === epoch || invalidated) {
          setIsImporting(false);
        }
      }
    },
    [navigation, resetAirgapRestore, setActiveNetwork],
  );
  const handlePasswordSubmit = async (password: string) => {
    if (restoreMode === 'airgap') {
      airgapPasswordRef.current = password;
      if (airgapCipherBase64) {
        await importAirgapCipher(airgapCipherBase64, password);
        return;
      }
      setModalVisible(false);
      airgapUrDecoderRef.current = null;
      setAirgapUrProgress(null);
      setIsAirgapScannerVisible(true);
      return;
    }
    try {
      setIsImporting(true);
      await importKeyshareFromBase64(fileContent, password, {
        setActiveNetwork,
        navigate: action => navigation.dispatch(action),
      });
      setModalVisible(false);
      setFileContent('');
      setRestoreMode(null);
    } catch (error) {
      showKeyshareImportError(error);
    } finally {
      setIsImporting(false);
    }
  };
  const handleCloseModal = () => {
    setModalVisible(false);
    setFileContent('');
    if (restoreMode === 'airgap') {
      resetAirgapRestore();
    }
    setRestoreMode(null);
  };
  const handleAirgapScannerClose = () => {
    setIsAirgapScannerVisible(false);
    if (airgapImportingRef.current) {
      return;
    }
    setAirgapUrProgress(null);
    airgapUrDecoderRef.current = null;
    if (airgapCipherBase64) {
      setModalVisible(true);
      return;
    }
    airgapPasswordRef.current = '';
    setRestoreMode(null);
  };
  const handleAirgapScan = useCallback((qrData: string) => {
    if (airgapImportingRef.current) {
      return;
    }
    const trimmed = qrData.trim();
    if (
      shouldIgnoreNonUrDuringSendScan(
        trimmed,
        airgapUrDecoderRef.current !== null,
      )
    ) {
      return;
    }
    if (!trimmed.toLowerCase().startsWith('ur:')) {
      return;
    }
    if (
      airgapUrDecoderRef.current &&
      !decoderMatchesPartSeqLen(airgapUrDecoderRef.current, trimmed)
    ) {
      const parsed = urSeqIndexFromPart(trimmed);
      dbg('airgap scan: seqLen mismatch, reset decoder', parsed);
      airgapUrDecoderRef.current = createUrDecoder();
      setAirgapUrProgress(null);
      airgapLastLoggedReceivedRef.current = -1;
    }
    if (!airgapUrDecoderRef.current) {
      airgapUrDecoderRef.current = createUrDecoder();
    }
    const parsed = urSeqIndexFromPart(trimmed);
    const urResult = receiveUrBytesPartAsBase64(
      airgapUrDecoderRef.current,
      trimmed,
    );
    if (urResult.kind === 'error') {
      dbg('airgap scan: decoder error', parsed, trimmed.substring(0, 48));
      return;
    }
    if (urResult.kind === 'progress') {
      const rec = urResult.progress.received;
      if (rec !== airgapLastLoggedReceivedRef.current) {
        airgapLastLoggedReceivedRef.current = rec;
        dbg('airgap scan progress', {
          ...urResult.progress,
          seq: parsed?.seq,
          seqLen: parsed?.seqLen,
          mix: parsed != null && parsed.seq > parsed.seqLen,
        });
      }
      setAirgapUrProgress(urResult.progress);
      return;
    }
    if (urResult.kind === 'complete') {
      dbg('airgap scan complete', {
        ...urResult.progress,
        seq: parsed?.seq,
        seqLen: parsed?.seqLen,
        payloadChars: urResult.payload.length,
      });
      const envelope = airgapV2Envelope(urResult.payload);
      airgapImportingRef.current = true;
      airgapUrDecoderRef.current = null;
      setAirgapUrProgress(urResult.progress);
      setAirgapCipherBase64(envelope);
      // Stop the camera now. Import waits until this screen is active again
      // before the OS auth prompt — prompting during finish() never returns.
      stopAndroidContinuousScan();
      setIsAirgapScannerVisible(false);
      setIsImporting(true);
      importAirgapCipher(envelope, airgapPasswordRef.current);
    }
  }, [importAirgapCipher]);
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
    walletLoadedBanner: {
      marginBottom: 16,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.subPrimary + '15',
      borderWidth: 1,
      borderColor: theme.colors.border + '40',
      width: '100%',
    },
    walletLoadedBannerText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    walletLoadedActions: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    walletLoadedAction: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    walletLoadedActionPrimary: {
      backgroundColor: theme.colors.bitcoinOrange,
      borderColor: theme.colors.bitcoinOrange,
    },
    walletLoadedActionLabel: {fontWeight: '600'},
    walletLoadedActionPrimaryLabel: {color: '#FFFFFF', fontWeight: '700'},
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
      color: theme.colors.white,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
    },
    importingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.colors.blackOverlay50 || 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
    },
    importingCard: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      paddingVertical: 28,
      paddingHorizontal: 32,
      alignItems: 'center',
      minWidth: 220,
    },
    importingText: {
      marginTop: 12,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
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
        {walletAlreadyLoaded ? (
          <View style={styles.walletLoadedBanner}>
            <Text style={styles.walletLoadedBannerText}>
              A keyshare is already on this phone. Open it, or remove it to set
              up or restore a different wallet.
            </Text>
            <View style={styles.walletLoadedActions}>
              <AppPressable
                style={styles.walletLoadedAction}
                onPress={removeLoadedKeyshare}>
                <Text
                  style={[
                    styles.walletLoadedActionLabel,
                    {color: theme.colors.text},
                  ]}>
                  Remove
                </Text>
              </AppPressable>
              <AppPressable
                style={[styles.walletLoadedAction, styles.walletLoadedActionPrimary]}
                onPress={openLoadedWallet}>
                <Text style={styles.walletLoadedActionPrimaryLabel}>
                  Open wallet
                </Text>
              </AppPressable>
            </View>
          </View>
        ) : null}
        <View style={styles.ctaButtons}>
          <AppPressable
            style={[
              styles.ctaButtonPrimary,
              ((!agreeToTerms || !agreeToPrivacy) || walletAlreadyLoaded) &&
                styles.disabledButton,
            ]}
            onPress={() => {
              if (walletAlreadyLoaded) {
                showWalletAlreadyLoadedAlert();
                return;
              }
              navigation.navigate('Wallet Setup');
            }}
            disabled={!agreeToTerms || !agreeToPrivacy || walletAlreadyLoaded}>
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
              ((!agreeToTerms || !agreeToPrivacy) || walletAlreadyLoaded) &&
                styles.disabledButton,
            ]}
            onPress={() => {
              if (walletAlreadyLoaded) {
                showWalletAlreadyLoadedAlert();
                return;
              }
              handleRestoreWallet();
            }}
            disabled={!agreeToTerms || !agreeToPrivacy || walletAlreadyLoaded}>
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
          <AppPressable
            style={[
              styles.ctaButtonSecondary,
              ((!agreeToTerms || !agreeToPrivacy) || walletAlreadyLoaded) &&
                styles.disabledButton,
            ]}
            onPress={() => {
              if (walletAlreadyLoaded) {
                showWalletAlreadyLoadedAlert();
                return;
              }
              handleRestoreViaAirgap();
            }}
            disabled={!agreeToTerms || !agreeToPrivacy || walletAlreadyLoaded}>
            <View style={styles.ctaButtonIconContainer}>
              <Image
                source={require('../assets/qr-icon.png')}
                style={[
                  styles.ctaButtonIconLeft,
                  {tintColor: theme.colors.text},
                ]}
                resizeMode="contain"
              />
              <Text style={styles.ctaButtonSecondaryText}>
                Restore via Airgap QR
              </Text>
            </View>
          </AppPressable>
        </View>
      </View>
      <KeyshareImportPasswordModal
        visible={modalVisible}
        onClose={handleCloseModal}
        onSubmit={handlePasswordSubmit}
        isSubmitting={isImporting}
        title={
          restoreMode === 'airgap' ? 'Restore via Airgap QR' : 'Restore Keyshare'
        }
        description={
          restoreMode === 'airgap'
            ? airgapCipherBase64
              ? 'Enter the PIN from the other phone. Eyes on these two screens only.'
              : 'Enter the 6-digit PIN from the other phone, then scan. Eyes on these two screens only.'
            : undefined
        }
        submitLabel={
          restoreMode === 'airgap' && !airgapCipherBase64 ? 'Continue' : 'Import'
        }
        inputMode={restoreMode === 'airgap' ? 'pin' : 'password'}
      />
      <QRScanner
        visible={isAirgapScannerVisible}
        onClose={handleAirgapScannerClose}
        onScan={handleAirgapScan}
        mode="continuous"
        title="Scanning Animated QR..."
        subtitle={
          airgapUrProgress && airgapUrProgress.percentage >= 100
            ? 'Processing keyshare…'
            : 'Fountain can finish before every frame.'
        }
        showProgress={!!airgapUrProgress && airgapUrProgress.total > 1}
        progress={airgapUrProgress || undefined}
        closeButtonText="Cancel"
      />
      {/* Legal Modal */}
      <LegalModal
        visible={isLegalModalVisible}
        onClose={() => {
          setIsLegalModalVisible(false);
        }}
        type={legalModalType}
      />
      {isImporting && restoreMode === 'airgap' && !isAirgapScannerVisible ? (
        <View style={styles.importingOverlay} pointerEvents="auto">
          <View style={styles.importingCard}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.importingText}>Importing keyshare…</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
};
export default ShowcaseScreen;
