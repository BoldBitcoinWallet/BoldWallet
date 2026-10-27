import React, {useEffect, useState} from 'react';
import {showAppNotice} from '../services/appPrompt';
import {
  View,
  StyleSheet,

  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  TextInput,
} from 'react-native';
import {useRoute} from '@react-navigation/native';
import AppPressable from '../components/AppPressable';
import AppText from '../components/AppText';
import MempoolProvidersEditor from '../components/MempoolProvidersEditor';
import RestoringIndexesModal from '../components/RestoringIndexesModal';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {dbg, getResetToMainTabsWallet} from '../utils';
import {useUser} from '../context/UserContext';
import {WalletService, waitMS} from '../services/WalletService';
import mempoolClient from '../services/MempoolClient';
import database from '../services/Database';
import walletRepository from '../services/repositories/WalletRepository';
import balanceRepository from '../services/repositories/BalanceRepository';
import balanceSyncer from '../services/sync/BalanceSyncer';
import transactionSyncer from '../services/sync/TransactionSyncer';
import utxoSyncer from '../services/sync/UtxoSyncer';
import {clearCachesBeforeWalletSession} from '../services/walletSessionReset';
import appConfigRepository, {
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import {
  CANONICAL_TESTNET_MEMPOOL_API_BASE,
  resolveStoredMempoolApiBase,
  validateMempoolApiBaseReachable,
} from '../services/mempoolApiBase';
import {
  activeProviderUrls,
  exclusiveEnable,
  hostnameFromMempoolApiBase,
  isValidProviderUrl,
  loadDefaultMempoolProviderEntries,
  loadMempoolProviderEntries,
  normalizeProviderUrl,
  primaryProviderUrl,
  PROVIDER_SCHEME_ERROR,
  providerListSummary,
  providerNetworkKey,
  providerUrlMatchesNetwork,
  saveMempoolProviderEntries,
  type MempoolProviderEntry,
  type ProviderNetwork,
} from '../services/mempoolProvidersStore';

import {ensureFeeApisApplied} from '../services/apiConfigApply';

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
  const providerNetwork: ProviderNetwork = providerNetworkKey(activeNetwork);
  const isTestnet = providerNetwork === 'testnet4';
  const [entries, setEntries] = useState<MempoolProviderEntry[]>([]);
  const [curated, setCurated] = useState<MempoolProviderEntry[]>([]);
  const [providersReady, setProvidersReady] = useState(false);
  const [endpointsOpen, setEndpointsOpen] = useState(false);
  const [ownServerUrl, setOwnServerUrl] = useState('');
  const [ownServerError, setOwnServerError] = useState<string | null>(null);
  const [verifiedOwnUrl, setVerifiedOwnUrl] = useState<string | null>(null);
  const [verifyingOwn, setVerifyingOwn] = useState(false);
  const [isAPISaving, setIsAPISaving] = useState(false);
  const [isRestoringIndexes, setIsRestoringIndexes] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{
    chain?: 'external' | 'internal';
    index?: number;
    gapIndex?: number;
    phase?: string;
    progress?: {current: number; total: number};
  } | null>(null);

  const fallbackBase = isTestnet
    ? CANONICAL_TESTNET_MEMPOOL_API_BASE
    : 'https://mempool.space/api';

  useEffect(() => {
    let cancelled = false;
    setProvidersReady(false);
    Promise.all([
      loadDefaultMempoolProviderEntries(providerNetwork),
      loadMempoolProviderEntries(providerNetwork),
    ])
      .then(([defaults, stored]) => {
        if (cancelled) {
          return;
        }
        setCurated(defaults);
        setEntries(stored);
        setOwnServerUrl('');
        setOwnServerError(null);
        setVerifiedOwnUrl(null);
        setProvidersReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setProvidersReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [providerNetwork]);

  const seedClientFromEnabled = async (enabled: string[]) => {
    const bases = enabled.length > 0 ? enabled : [fallbackBase];
    mempoolClient.setPublicBases(bases);
    try {
      // Direct mint: the chosen endpoints are on screen in this flow.
      await ensureFeeApisApplied(bases, null);
    } catch {
      // no-op
    }
  };

  const persistAndProceed = async (list: MempoolProviderEntry[]) => {
    const saved = saveMempoolProviderEntries(list, providerNetwork);
    const enabled = activeProviderUrls(saved);
    const primary = primaryProviderUrl(saved, fallbackBase);
    await seedClientFromEnabled(enabled);
    await setActiveApiProvider(primary);
    dbg('=== API saved and propagated successfully:', primary);
    await handleProceed(primary);
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

  const runRestoreIfNeeded = async (apiUrl: string) => {
    if (!pendingRestore) {
      return;
    }
    dbg(
      'UserPreferenceScreen: Running full re-indexing (discovery + sync) with API:',
      apiUrl.slice(0, 40),
    );
    await clearCachesBeforeWalletSession();
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
      const agg = balanceRepository.getAggregateBalance(
        network,
        addressesWithPaths.map(a => a.address),
      );
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

  const verifyOwnServer = async (
    raw: string,
    list: MempoolProviderEntry[],
  ): Promise<MempoolProviderEntry[] | null> => {
    const url = normalizeProviderUrl(raw);
    if (!url || !isValidProviderUrl(url)) {
      setOwnServerError(PROVIDER_SCHEME_ERROR);
      return null;
    }
    if (!providerUrlMatchesNetwork(url, providerNetwork)) {
      setOwnServerError(
        isTestnet
          ? 'Testnet endpoints must be a testnet4 API, for example https://mempool.space/testnet4/api'
          : 'Mainnet endpoints must not be testnet or signet URLs.',
      );
      return null;
    }
    setVerifyingOwn(true);
    setOwnServerError(null);
    try {
      const reachable = await validateMempoolApiBaseReachable(url);
      if (!reachable) {
        setOwnServerError('This server did not answer');
        return null;
      }
      const next = exclusiveEnable(url, list);
      setEntries(next);
      setVerifiedOwnUrl(url);
      setOwnServerUrl('');
      return next;
    } finally {
      setVerifyingOwn(false);
    }
  };

  const handleContinue = async () => {
    if (isAPISaving || isRestoringIndexes || verifyingOwn || !providersReady) {
      return;
    }
    setIsAPISaving(true);
    try {
      let list = entries;
      const pending = ownServerUrl.trim();
      if (pending) {
        const verified = await verifyOwnServer(pending, entries);
        if (!verified) {
          return;
        }
        list = verified;
      }
      const enabled = activeProviderUrls(list);
      if (enabled.length === 0) {
        showAppNotice(
          'Keep one endpoint on',
          'At least one endpoint must stay on.',
        );
        return;
      }
      const checks = await Promise.all(
        enabled.map(async url => validateMempoolApiBaseReachable(url)),
      );
      if (!checks.some(Boolean)) {
        showAppNotice(
          'Invalid API Endpoint',
          'None of the enabled endpoints responded. Turn on another one, or check the address.',
        );
        return;
      }
      await persistAndProceed(list);
    } catch (error) {
      dbg('Error in handleContinue:', error);
      showAppNotice('Error', 'Failed to save API endpoint. Please try again.');
    } finally {
      setIsAPISaving(false);
    }
  };

  const handleProceed = async (resolvedApi?: string) => {
    try {
      const apiUrl =
        resolvedApi ||
        activeApiProvider ||
        resolveStoredMempoolApiBase(activeNetwork);
      await runRestoreIfNeeded(apiUrl);
      navigateToHome();
    } catch (e) {
      showAppNotice(
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
    },
    networkBadge: {
      alignSelf: 'flex-start',
      marginTop: 10,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    networkBadgeText: {
      fontSize: theme.fontSizes?.xs || 12,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    ownServerCard: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    ownServerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
    },
    ownServerInput: {
      flex: 1,
      minWidth: 0,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
      backgroundColor: theme.colors.background,
    },
    verifyButton: {
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    verifyButtonText: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.background,
    },
    ownServerError: {
      marginTop: 8,
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.danger,
      lineHeight: 18,
    },
    verifiedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
    },
    verifiedHost: {
      flexShrink: 1,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    reachableChip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: theme.colors.receivedOverlay15,
      borderWidth: 1,
      borderColor: theme.colors.success + '66',
    },
    reachableText: {
      fontSize: theme.fontSizes?.xs || 12,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.success,
    },
    changeAction: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    apiSection: {
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      backgroundColor: theme.colors.cardBackground,
      overflow: 'hidden',
    },
    collapseHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 12,
    },
    collapseHeaderText: {
      flex: 1,
      minWidth: 0,
    },
    apiSectionTitle: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 2,
    },
    collapseAction: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    collapseChevron: {
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
    editorWrap: {
      paddingHorizontal: 12,
      paddingBottom: 12,
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
      minHeight: 52,
      marginBottom: 0,
    },
    proceedButtonDisabled: {
      opacity: 0.5,
    },
    proceedButtonText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.background,
    },
    proceedButtonIcon: {
      width: 18,
      height: 18,
    },
    ctaBar: {
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 8,
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
              <AppText style={styles.infoCardTitle}>Lookup servers</AppText>
            </View>
            <AppText style={styles.infoCardDescription} tone="muted">
              Start with your Mempool endpoint. Public endpoints are listed
              below.
            </AppText>
            <View style={styles.networkBadge}>
              <AppText style={styles.networkBadgeText}>
                {isTestnet ? 'Testnet' : 'Mainnet'}
              </AppText>
            </View>
          </View>

          <View style={styles.ownServerCard}>
            <View style={styles.infoCardHeader}>
              <Image
                source={require('../assets/mempool-icon.png')}
                style={styles.infoCardIcon}
                resizeMode="contain"
              />
              <AppText style={styles.infoCardTitle}>
                Your Mempool endpoint
              </AppText>
            </View>
            <AppText style={styles.infoCardDescription} tone="muted">
              Public endpoints can collect your IP, location, and lookup
              metadata. Yours keeps that to you.
            </AppText>
            {verifiedOwnUrl ? (
              <View style={styles.verifiedRow}>
                <AppText style={styles.verifiedHost} numberOfLines={1}>
                  {hostnameFromMempoolApiBase(verifiedOwnUrl)}
                </AppText>
                <View style={styles.reachableChip}>
                  <AppText style={styles.reachableText}>Reachable</AppText>
                </View>
                <AppPressable
                  onPress={() => {
                    setOwnServerUrl(verifiedOwnUrl);
                    setVerifiedOwnUrl(null);
                    setOwnServerError(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Change your Mempool endpoint"
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <AppText style={styles.changeAction}>Change</AppText>
                </AppPressable>
              </View>
            ) : (
              <View style={styles.ownServerRow}>
                <TextInput
                  style={styles.ownServerInput}
                  value={ownServerUrl}
                  onChangeText={text => {
                    setOwnServerUrl(text);
                    if (ownServerError) {
                      setOwnServerError(null);
                    }
                  }}
                  placeholder={
                    isTestnet
                      ? 'https://mempool.example/testnet4/api'
                      : 'https://mempool.example/api'
                  }
                  placeholderTextColor={theme.colors.textSecondary + '80'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="done"
                  editable={!verifyingOwn}
                  onSubmitEditing={() => {
                    if (ownServerUrl.trim()) {
                      verifyOwnServer(ownServerUrl, entries);
                    }
                  }}
                />
                <AppPressable
                  style={[
                    styles.verifyButton,
                    (!ownServerUrl.trim() || verifyingOwn) &&
                      styles.proceedButtonDisabled,
                  ]}
                  disabled={!ownServerUrl.trim() || verifyingOwn}
                  onPress={() => verifyOwnServer(ownServerUrl, entries)}
                  accessibilityRole="button"
                  accessibilityLabel="Verify your Mempool endpoint"
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <AppText style={styles.verifyButtonText}>
                    {verifyingOwn ? 'Verifying…' : 'Verify'}
                  </AppText>
                </AppPressable>
              </View>
            )}
            {ownServerError ? (
              <AppText style={styles.ownServerError}>{ownServerError}</AppText>
            ) : null}
          </View>

          <View style={styles.apiSection}>
            <AppPressable
              style={styles.collapseHeader}
              onPress={() => setEndpointsOpen(open => !open)}
              accessibilityRole="button"
              accessibilityState={{expanded: endpointsOpen}}
              accessibilityLabel="Endpoints"
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <View style={styles.collapseHeaderText}>
                <AppText style={styles.apiSectionTitle}>Endpoints</AppText>
                <AppText tone="muted">
                  {providersReady
                    ? providerListSummary(entries)
                    : 'Loading…'}
                </AppText>
              </View>
              <AppText style={styles.collapseAction}>
                {endpointsOpen ? 'Hide' : 'Choose'}
              </AppText>
              <AppText
                style={styles.collapseChevron}
                accessibilityElementsHidden>
                {endpointsOpen ? '▼' : '▶'}
              </AppText>
            </AppPressable>
            {endpointsOpen ? (
              <View style={styles.editorWrap}>
                <MempoolProvidersEditor
                  network={providerNetwork}
                  curatedUrls={curated.map(entry => entry.url)}
                  entries={entries}
                  onChange={setEntries}
                  showSave={false}
                  showDefaults={false}
                />
              </View>
            ) : null}
          </View>
        </ScrollView>
        <View style={styles.ctaBar}>
          <AppPressable
            style={[
              styles.proceedButton,
              (isAPISaving ||
                isRestoringIndexes ||
                verifyingOwn ||
                !providersReady ||
                (activeProviderUrls(entries).length === 0 &&
                  ownServerUrl.trim().length === 0)) &&
                styles.proceedButtonDisabled,
            ]}
            onPress={handleContinue}
            disabled={
              isAPISaving ||
              isRestoringIndexes ||
              verifyingOwn ||
              !providersReady ||
              (activeProviderUrls(entries).length === 0 &&
                ownServerUrl.trim().length === 0)
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
                      : theme.colors.background,
                },
              ]}
            />
            <AppText style={styles.proceedButtonText}>
              {isAPISaving ? 'Checking…' : 'Continue'}
            </AppText>
          </AppPressable>
        </View>
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
