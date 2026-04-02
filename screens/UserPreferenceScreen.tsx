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
import {dbg, getMainnetAPIList, getResetToMainTabsWallet} from '../utils';
import {useUser} from '../context/UserContext';
import {WalletService, waitMS} from '../services/WalletService';
import mempoolClient from '../services/MempoolClient';
import database from '../services/Database';
import walletRepository from '../services/repositories/WalletRepository';
import balanceRepository from '../services/repositories/BalanceRepository';
import balanceSyncer from '../services/sync/BalanceSyncer';
import transactionSyncer from '../services/sync/TransactionSyncer';
import utxoSyncer from '../services/sync/UtxoSyncer';
import syncCoordinator from '../services/sync/SyncCoordinator';
import apiQueue from '../services/ApiQueue';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import {
  CANONICAL_TESTNET_MEMPOOL_API_BASE,
  isKnownPublicMempoolMainnetBase,
  isTestnetNetworkKey,
  normalizeUserMempoolApiInput,
  resolveStoredMempoolApiBase,
  validateMempoolApiBaseReachable,
} from '../services/mempoolApiBase';

const UserPreferenceScreen: React.FC<{navigation: any}> = ({navigation}) => {
  const route = useRoute();
  const pendingRestore = (route.params as any)?.pendingRestore === true;

  const {theme} = useTheme();
  const {
    setActiveApiProvider,
    activeApiProvider,
    activeNetwork,
    showMempoolPlayground,
    showUtxosTab,
    showAddressesTab,
    showPsbtTab,
    showWalletTab,
  } = useUser();
  const [pendingAPI, setPendingAPI] = useState('');
  const [isAPISaving, setIsAPISaving] = useState(false);
  const [isRestoringIndexes, setIsRestoringIndexes] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{
    chain?: 'external' | 'internal';
    index?: number;
    gapIndex?: number;
    phase?: string;
    progress?: {current: number; total: number};
  } | null>(null);

  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Save API and proceed
  const saveAPIAndProceed = async (api: string) => {
    // If no API entered, just proceed
    if (!api || api.trim() === '') {
      await handleProceed();
      return;
    }

    const normalizedApi = isTestnetNetworkKey(activeNetwork)
      ? CANONICAL_TESTNET_MEMPOOL_API_BASE
      : normalizeUserMempoolApiInput(api);
    dbg('Original API URL:', api);
    dbg('Normalized API URL:', normalizedApi);
    setIsAPISaving(true);
    try {
      const isValid = await validateMempoolApiBaseReachable(normalizedApi);
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
      const useRR = await isKnownPublicMempoolMainnetBase(normalizedApi);
      await handleProceed(normalizedApi, useRR);
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
      getResetToMainTabsWallet(
        {},
        {
          showPlay: activeNetwork === 'mainnet' && showMempoolPlayground,
          showUtxos: showUtxosTab,
          showAddresses: showAddressesTab,
          showPsbt: showPsbtTab,
          showWallet: showWalletTab,
        },
      ),
    );
  };

  const runRestoreIfNeeded = async (
    apiUrl: string,
    useRoundRobin: boolean,
  ) => {
    if (!pendingRestore) {
      return;
    }
    dbg(
      'UserPreferenceScreen: Running full re-indexing (discovery + sync) with API:',
      apiUrl.slice(0, 40),
    );
    syncCoordinator.stop();
    apiQueue.clear();
    setIsRestoringIndexes(true);
    setRestoreProgress(null);
    await waitMS(250);
    const network = 'mainnet';
    const addressType = 'segwit-native';
    appConfigRepository.set(CONFIG_KEYS.NETWORK, network);
    appConfigRepository.set(CONFIG_KEYS.ADDRESS_TYPE, addressType);
    appConfigRepository.set('api', apiUrl);
    appConfigRepository.set(`api_${network}`, apiUrl);
    try {
      const ws = WalletService.getInstance();

      // Round-robin: only seed the public mirror pool when restoring via that pool.
      // Private / self-hosted bases must clear the pool so MempoolClient never fails over off-host.
      if (useRoundRobin) {
        const publicBases = await getMainnetAPIList();
        mempoolClient.setPublicBases(publicBases);
      } else {
        mempoolClient.setPublicBases([]);
      }

      // ── Discovery: gap-limit scan for native segwit only ──────────────────
      await ws.discoverHdIndexesForNetwork(
        network,
        addressType,
        apiUrl,
        (chain, index, gapIndex) =>
          setRestoreProgress({chain, index, gapIndex}),
      );
      dbg('UserPreferenceScreen: HD index discovery complete');

      const hdState = walletRepository.getHdState(network, addressType);
      if (!hdState?.restoreDone) {
        throw new Error(
          'Index discovery incomplete — network may be unreachable. Please try again.',
        );
      }

      // Invalidate sync metadata so balance/tx/UTXO sync re-fetches; keep existing DB rows.
      database.invalidateSyncMetadataForAddressType(network, addressType);
      mempoolClient.invalidateAll();
      ws.invalidateAddressCache();

      const addressesWithPaths = await ws.getHdAddressesWithPaths(
        network,
        addressType,
      );

      // ── Full sync: balances, transactions, UTXOs ───────────────────────
      setRestoreProgress({phase: 'Syncing balances…'});
      await balanceSyncer.syncAddresses(
        addressesWithPaths.map(a => ({address: a.address, network})),
        apiUrl,
        (current, total) =>
          setRestoreProgress(prev =>
            prev ? {...prev, progress: {current, total}} : null,
          ),
      );
      const agg = balanceRepository.getAggregateBalance(network);
      balanceRepository.setBalance({
        address: `aggregate_${network}_${addressType}`,
        network,
        balanceSats: agg.balanceSats,
        pendingSats: agg.pendingSats,
        hasNonzero: agg.hasNonzero,
        fetchedAt: agg.fetchedAt || Date.now(),
      });

      setRestoreProgress({phase: 'Syncing transactions…'});
      await transactionSyncer.syncAddressesAtomic(
        addressesWithPaths.map(a => ({address: a.address, network})),
        apiUrl,
        (current, total) =>
          setRestoreProgress(prev =>
            prev ? {...prev, progress: {current, total}} : null,
          ),
      );

      setRestoreProgress({phase: 'Syncing UTXOs…'});
      await utxoSyncer.syncAddresses(
        addressesWithPaths.map(a => ({
          address: a.address,
          network,
          derivationPath: a.derivationPath,
        })),
        apiUrl,
        (current, total) =>
          setRestoreProgress(prev =>
            prev ? {...prev, progress: {current, total}} : null,
          ),
      );

      dbg('UserPreferenceScreen: Full re-indexing complete');
      mempoolClient.invalidateAll();
    } catch (e) {
      dbg('UserPreferenceScreen: Restore failed', e);
      throw e;
    } finally {
      setIsRestoringIndexes(false);
      setRestoreProgress(null);
    }
  };

  const handleSkip = async () => {
    const fallbackApi =
      activeApiProvider || resolveStoredMempoolApiBase(activeNetwork);
    try {
      const useRoundRobin =
        await isKnownPublicMempoolMainnetBase(fallbackApi);
      await runRestoreIfNeeded(fallbackApi, useRoundRobin);
      navigateToHome();
    } catch (e) {
      Alert.alert(
        'Restore failed',
        e instanceof Error
          ? e.message
          : 'Index discovery or sync failed. Please try again.',
      );
    }
  };

  /**
   * @param useRoundRobin - When true, seed public mirror list for MempoolClient failover (public pool only).
   */
  const handleProceed = async (
    resolvedApi?: string,
    useRoundRobin?: boolean,
  ) => {
    try {
      const apiUrl =
        resolvedApi ||
        activeApiProvider ||
        resolveStoredMempoolApiBase(activeNetwork);
      const rr =
        useRoundRobin ??
        (await isKnownPublicMempoolMainnetBase(apiUrl));
      await runRestoreIfNeeded(apiUrl, rr);
      navigateToHome();
    } catch (e) {
      Alert.alert(
        'Restore failed',
        e instanceof Error
          ? e.message
          : 'Index discovery or sync failed. Please try again.',
      );
    }
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
              address, Geolocation or Device Agent. For that, you can point to
              your own self-hosted mempool.space to protect privacy.
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
            disabled={
              isAPISaving || isRestoringIndexes || pendingAPI.trim() === ''
            }
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
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
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <AppText style={styles.skipButtonText}>Skip for now</AppText>
          </AppPressable>
        </ScrollView>
      </KeyboardAvoidingView>
      <RestoringIndexesModal
        visible={isRestoringIndexes}
        chain={restoreProgress?.chain}
        index={restoreProgress?.index ?? 0}
        gapIndex={restoreProgress?.gapIndex ?? 0}
        phase={restoreProgress?.phase}
        progress={restoreProgress?.progress}
      />
    </SafeAreaView>
  );
};

export default UserPreferenceScreen;
