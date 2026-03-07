import React, {useState, useRef} from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import {useRoute} from '@react-navigation/native';
import AppPressable from '../components/AppPressable';
import AppText from '../components/AppText';
import RestoringIndexesModal from '../components/RestoringIndexesModal';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {dbg, getResetToMainTabsWallet} from '../utils';
import {useUser} from '../context/UserContext';
import {WalletService} from '../services/WalletService';
import mempoolClient from '../services/MempoolClient';

const UserPreferenceScreen: React.FC<{navigation: any}> = ({navigation}) => {
  const route = useRoute();
  const pendingRestore = (route.params as any)?.pendingRestore === true;

  const {theme} = useTheme();
  const {setActiveApiProvider, activeApiProvider, activeNetwork, showMempoolPlayground, showUtxosTab, showPsbtTab, showWalletTab} = useUser();
  const [pendingAPI, setPendingAPI] = useState('');
  const [isAPISaving, setIsAPISaving] = useState(false);
  const [isRestoringIndexes, setIsRestoringIndexes] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{
    chain: 'external' | 'internal';
    index: number;
    gapIndex: number;
  } | null>(null);

  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Normalize API URL
  const normalizeAPIUrl = (url: string): string => {
    if (!url || url.trim() === '') {
      return url;
    }
    let normalized = url.trim();
    normalized = normalized.replace(/\/+$/, '');
    const apiPattern = /\/api$/i;
    if (!apiPattern.test(normalized)) {
      normalized = normalized + '/api';
    }
    return normalized;
  };

  // Validate API endpoint
  const validateAPIEndpoint = async (api: string): Promise<boolean> => {
    try {
      const testUrl = `${api.replace(/\/$/, '')}/blocks/tip/hash`;
      dbg('Testing API endpoint:', testUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        dbg('API validation failed: HTTP', response.status);
        return false;
      }
      const blockHash = await response.text();
      const isValidBlockHash = /^[a-f0-9]{64}$/i.test(blockHash.trim());
      if (!isValidBlockHash) {
        dbg('API validation failed: Invalid block hash format:', blockHash);
        return false;
      }
      dbg('API validation successful:', blockHash);
      return true;
    } catch (error) {
      dbg('API validation error:', error);
      return false;
    }
  };

  // Save API and proceed
  const saveAPIAndProceed = async (api: string) => {
    // If no API entered, just proceed
    if (!api || api.trim() === '') {
      handleProceed();
      return;
    }

    const normalizedApi = normalizeAPIUrl(api);
    dbg('Original API URL:', api);
    dbg('Normalized API URL:', normalizedApi);
    setIsAPISaving(true);
    try {
      const isValid = await validateAPIEndpoint(normalizedApi);
      if (!isValid) {
        Alert.alert(
          'Invalid API Endpoint',
          'The selected API endpoint is not responding correctly. Please choose a different endpoint or skip.',
        );
        return;
      }
      await setActiveApiProvider(normalizedApi);
      setPendingAPI(normalizedApi);
      dbg('=== API saved and propagated successfully:', normalizedApi);
      // Proceed to home after successful save — pass the resolved API so the
      // restore uses the endpoint the user just configured, not the stale state.
      handleProceed(normalizedApi);
    } catch (error) {
      dbg('Error in saveAPIAndProceed:', error);
      Alert.alert('Error', 'Failed to save API endpoint. Please try again.');
    } finally {
      setIsAPISaving(false);
    }
  };

  const handleAPISelection = (api: string) => {
    setPendingAPI(api);
  };

  const getInputContainerStyle = () => {
    if (isFocused) {
      return [
        styles.apiInputContainer,
        {
          borderColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.primary
              : theme.colors.bitcoinOrange,
        },
      ];
    }
    return styles.apiInputContainer;
  };

  const navigateToHome = () => {
    navigation.reset(
      getResetToMainTabsWallet({}, {
        showPlay: activeNetwork === 'mainnet' && showMempoolPlayground,
        showUtxos: showUtxosTab,
        showPsbt: showPsbtTab,
        showWallet: showWalletTab,
      }),
    );
  };

  const runRestoreIfNeeded = async (apiUrl: string) => {
    if (!pendingRestore) {
      return;
    }
    dbg('UserPreferenceScreen: Running HD index restore with API:', apiUrl.slice(0, 40));
    setIsRestoringIndexes(true);
    setRestoreProgress(null);
    try {
      const ws = WalletService.getInstance();
      for (const addrType of ['legacy', 'segwit-native', 'segwit-compatible']) {
        await ws.discoverHdIndexesForNetwork(
          'mainnet',
          addrType,
          apiUrl,
          (chain, index, gapIndex) => setRestoreProgress({chain, index, gapIndex}),
        );
      }
      dbg('UserPreferenceScreen: HD index restore complete');

      // Pre-warm the in-memory HD address cache for the default address type.
      // discoverHdIndexesForNetwork sets the indexes but never calls
      // getHdAddressesWithPaths, so hdAddressCache is cold when WalletHome loads.
      // A cold cache forces sequential native-module derivation (2-5 s), during
      // which TransactionList fires in single-address mode and shows stale/partial
      // results.  Pre-warming here means getHdAddressesWithPaths returns from the
      // in-memory Map in microseconds — walletAddresses is ready before the first
      // TransactionList render.
      await ws.getHdAddressesWithPaths('mainnet', 'segwit-native');

      // Wipe all HTTP cache entries populated by isAddressUsed() during discovery.
      // Those entries share the same /address/{addr}/txs URLs that the transaction
      // list fetches.  Leaving them causes pull-to-refresh (within the 30 s TTL)
      // to serve discovery-era snapshots instead of fresh network data.
      mempoolClient.invalidateAll();
    } finally {
      setIsRestoringIndexes(false);
      setRestoreProgress(null);
    }
  };

  const handleSkip = async () => {
    const fallbackApi =
      activeApiProvider || 'https://mempool.space/api';
    await runRestoreIfNeeded(fallbackApi);
    navigateToHome();
  };

  const handleProceed = async (resolvedApi?: string) => {
    await runRestoreIfNeeded(resolvedApi || activeApiProvider || 'https://mempool.space/api');
    navigateToHome();
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollContainer: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 24,
    },
    header: {
      marginBottom: 20,
      alignItems: 'center',
    },
    headerIcon: {
      width: 36,
      height: 36,
    },
    headerTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 24,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    headerSubtitle: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    infoCard: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    infoCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    infoCardIcon: {
      width: 20,
      height: 20,
      marginRight: 10,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    infoCardTitle: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    infoCardDescription: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      lineHeight: 18,
      marginBottom: 4,
    },
    infoCardTechNote: {
      fontSize: theme.fontSizes?.xs || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      lineHeight: 16,
      marginTop: 6,
      fontStyle: 'italic',
    },
    apiSection: {
      marginBottom: 20,
    },
    apiSectionTitle: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 8,
    },
    apiSectionDescription: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      marginBottom: 12,
      lineHeight: 18,
    },
    apiInputContainer: {
      borderWidth: 1.5,
      borderColor: theme.colors.border,
      borderRadius: 12,
      backgroundColor: theme.colors.cardBackground,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    apiTextInput: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
      padding: 0,
    },
    proceedButton: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
      minHeight: 48,
    },
    proceedButtonDisabled: {
      opacity: 0.5,
    },
    proceedButtonText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.text,
    },
    proceedButtonIcon: {
      width: 20,
      height: 20,
      marginRight: 8,
    },
    skipButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
    },
    skipButtonText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
      textDecorationLine: 'underline',
    },
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          overScrollMode="never"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Image
              source={
                theme.colors.background === '#ffffff'
                  ? require('../assets/bold-icon.png')
                  : require('../assets/bold-icon-inverted.png')
              }
              style={styles.headerIcon}
              resizeMode="contain"
            />
          </View>

          <View style={styles.infoCard}>
            <View style={styles.infoCardHeader}>
              <Image
                source={require('../assets/privacy-icon.png')}
                style={styles.infoCardIcon}
                resizeMode="contain"
              />
              <AppText style={styles.infoCardTitle}>
                Privacy / Mempool.Space
              </AppText>
            </View>
            <AppText style={styles.infoCardDescription} tone="muted">
              Bold collects zero user data. Users are anonymous and no personal
              data is collected or shared. However, public mempool servers can
              see your Bitcoin addresses, potentially link them to your IP
              address, Geolocation or Device Agent. For that, you can point to your own
              self-hosted mempool.space to protect privacy.
            </AppText>
            <AppText style={styles.infoCardTechNote} tone="muted">
              Enter a mempool.space API endpoint (mainnet) or just skip that.
              {'\n'}
              You can change this later from Settings.
            </AppText>
          </View>

          <View style={styles.apiSection}>
            <AppText style={styles.apiSectionTitle}>
              Mempool Provider URL
            </AppText>
            <AppText style={styles.apiSectionDescription} tone="muted">
              Enter your endpoint URL (e.g., https://mempool.space/api)
            </AppText>
            <View style={getInputContainerStyle()}>
              <TextInput
                ref={inputRef}
                style={styles.apiTextInput}
                returnKeyType="done"
                value={pendingAPI}
                onChangeText={handleAPISelection}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="https://mempool.space/api"
                placeholderTextColor={theme.colors.textSecondary + '80'}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          <AppPressable
            style={[
              styles.proceedButton,
              (isAPISaving || isRestoringIndexes || pendingAPI.trim() === '') &&
                styles.proceedButtonDisabled,
            ]}
            onPress={() => {
              saveAPIAndProceed(pendingAPI);
            }}
            disabled={isAPISaving || isRestoringIndexes || pendingAPI.trim() === ''}
            android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
            <Image
              source={require('../assets/check-icon.png')}
              resizeMode="contain"
              style={[
                styles.proceedButtonIcon,
                {
                  tintColor:
                    theme.colors.background === '#ffffff'
                      ? theme.colors.white
                      : theme.colors.text,
                },
              ]}
            />
            <AppText style={styles.proceedButtonText} tone="onPrimary">
              {isAPISaving ? 'Validating...' : 'Validate and Proceed'}
            </AppText>
          </AppPressable>

          <AppPressable
            style={styles.skipButton}
            onPress={handleSkip}
            disabled={isAPISaving || isRestoringIndexes}
            android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
            <AppText style={styles.skipButtonText}>Skip for now</AppText>
          </AppPressable>
        </ScrollView>
      </KeyboardAvoidingView>
      <RestoringIndexesModal
        visible={isRestoringIndexes}
        chain={restoreProgress?.chain}
        index={restoreProgress?.index}
        gapIndex={restoreProgress?.gapIndex}
      />
    </SafeAreaView>
  );
};

export default UserPreferenceScreen;
