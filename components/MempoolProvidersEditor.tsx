import React, {useEffect, useMemo, useState} from 'react';
import {confirmAppPrompt, showAppNotice} from '../services/appPrompt';
import {
  Image,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import AppPressable from './AppPressable';
import AppSwitch from './AppSwitch';
import {useTheme, type ThemeColors} from '../theme';
import {
  getHostLatestAttempt,
  getHostQuality,
  qualityFromAttempt,
  subscribeMempoolHealth,
  type MempoolHealthQuality,
} from '../services/mempoolHealth';
import {
  isValidProviderUrl,
  loadDefaultMempoolProviderEntries,
  normalizeProviderUrl,
  PROVIDER_SCHEME_ERROR,
  providerListSummary,
  providerNetworkKey,
  providerUrlMatchesNetwork,
  type MempoolProviderEntry,
  type ProviderNetwork,
} from '../services/mempoolProvidersStore';
import {normalizeMempoolApiRoot} from '../services/mempoolApiBase';
import {probeMempoolApiBasesOnce} from '../services/providerHealthPoller';
import {useWalletOnline} from '../services/walletOnlineStore';

function hostRoot(url: string): string {
  return normalizeMempoolApiRoot(url);
}

type Props = {
  entries: MempoolProviderEntry[];
  onChange: (next: MempoolProviderEntry[]) => void;
  /** Which chain this list belongs to. Public rows and URL checks follow it. */
  network?: ProviderNetwork;
  /** Curated public URLs. Rows whose root is in this set show a Public chip. */
  curatedUrls?: string[];
  showSave?: boolean;
  saveDisabled?: boolean;
  onSave?: () => void | Promise<void>;
  showDefaults?: boolean;
};

function qualityBadge(
  q: MempoolHealthQuality | null,
  colors: ThemeColors,
): {
  label: string;
  bg: string;
  border: string;
  text: string;
  dot: string;
} | null {
  if (q === 'fine') {
    return {
      label: 'Healthy',
      bg: colors.receivedOverlay15,
      border: colors.success + '66',
      text: colors.success,
      dot: colors.success,
    };
  }
  if (q === 'slow') {
    return {
      label: 'Slow',
      bg: colors.warningBg,
      border: colors.warningBorder,
      text: colors.warningText,
      dot: colors.bitcoinOrange,
    };
  }
  if (q === 'bad') {
    return {
      label: 'Unreachable',
      bg: colors.dangerOverlay15,
      border: colors.danger + '66',
      text: colors.danger,
      dot: colors.danger,
    };
  }
  return null;
}

function formatDuration(durationMs: number): string {
  return durationMs >= 1000
    ? `${(durationMs / 1000).toFixed(1)} s`
    : `${Math.round(durationMs)} ms`;
}

function ProviderRow({
  entry,
  index,
  curated,
  walletOnline,
  busy,
  accent,
  muted,
  onToggle,
  onRemove,
  onRefresh,
}: {
  entry: MempoolProviderEntry;
  index: number;
  curated: boolean;
  walletOnline: boolean;
  /** A health probe for this row is running (its own, or Check all). */
  busy: boolean;
  accent: string;
  muted: string;
  onToggle: (index: number, value: boolean) => void;
  onRemove: (index: number) => void;
  onRefresh: (entry: MempoolProviderEntry) => void;
}) {
  const {theme} = useTheme();
  const root = hostRoot(entry.url);
  const spin = useSharedValue(0);
  const sweep = useSharedValue(0);
  const trackWidth = useSharedValue(0);
  const sample = getHostLatestAttempt(root);
  const badge = qualityBadge(
    sample ? qualityFromAttempt(sample) : getHostQuality(root),
    theme.colors,
  );
  const badgeLabel = badge
    ? sample
      ? `${badge.label} · ${formatDuration(sample.durationMs)}`
      : badge.label
    : null;

  useEffect(() => {
    if (busy) {
      spin.value = 0;
      sweep.value = 0;
      spin.value = withRepeat(
        withTiming(1, {duration: 700, easing: Easing.linear}),
        -1,
      );
      sweep.value = withRepeat(
        withTiming(1, {duration: 900, easing: Easing.inOut(Easing.quad)}),
        -1,
      );
      return;
    }
    cancelAnimation(spin);
    cancelAnimation(sweep);
    spin.value = 0;
    sweep.value = 0;
  }, [busy, spin, sweep]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{rotate: `${spin.value * 360}deg`}],
  }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{translateX: (sweep.value * 1.4 - 0.4) * trackWidth.value}],
  }));

  return (
    <View
      style={[
        styles.row,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.cardBackground,
        },
      ]}>
      <Text
        style={[
          styles.url,
          {
            color: entry.enabled ? theme.colors.text : muted,
            fontFamily: theme.fontFamilies?.regular,
          },
        ]}
        selectable>
        {entry.url}
      </Text>
      <View style={styles.controls}>
        <View
          style={[
            styles.badge,
            curated
              ? {borderColor: theme.colors.border}
              : {backgroundColor: accent + '22', borderColor: accent},
            !entry.enabled && styles.badgeDimmed,
          ]}>
          <Text
            style={[
              styles.badgeText,
              {
                color: curated ? muted : accent,
                fontFamily: theme.fontFamilies?.medium,
              },
            ]}>
            {curated ? 'Public' : 'Yours'}
          </Text>
        </View>
        {busy ? (
          <View
            style={[
              styles.badge,
              {
                borderColor: accent,
                backgroundColor: accent + '22',
              },
            ]}
            accessibilityLabel="Checking provider health">
            <View style={[styles.badgeDot, {backgroundColor: accent}]} />
            <Text
              style={[
                styles.badgeText,
                {color: accent, fontFamily: theme.fontFamilies?.medium},
              ]}>
              Checking
            </Text>
          </View>
        ) : badge ? (
          <View
            style={[
              styles.badge,
              {backgroundColor: badge.bg, borderColor: badge.border},
              !entry.enabled && styles.badgeDimmed,
            ]}
            accessibilityLabel={`Provider ${badgeLabel}`}>
            <View style={[styles.badgeDot, {backgroundColor: badge.dot}]} />
            <Text
              style={[
                styles.badgeText,
                {color: badge.text, fontFamily: theme.fontFamilies?.medium},
              ]}>
              {badgeLabel}
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.badge,
              {borderColor: theme.colors.border},
              !entry.enabled && styles.badgeDimmed,
            ]}
            accessibilityLabel="Provider not checked yet">
            <View style={[styles.badgeDot, {backgroundColor: muted}]} />
            <Text
              style={[
                styles.badgeText,
                {color: muted, fontFamily: theme.fontFamilies?.medium},
              ]}>
              Not checked
            </Text>
          </View>
        )}
        <View style={styles.controlsTail}>
          <AppSwitch
            value={entry.enabled}
            onValueChange={value => onToggle(index, value)}
            accessibilityLabel={`Use ${entry.url}`}
          />
          <AppPressable
            onPress={() => onRefresh(entry)}
            disabled={!walletOnline || busy}
            style={[styles.refreshBtn, !walletOnline && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel={`Refresh ${entry.url}`}
            accessibilityHint="Checks this endpoint once"
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Animated.View style={busy ? spinStyle : undefined}>
              <Image
                source={require('../assets/refresh-icon.png')}
                style={[styles.refreshIcon, {tintColor: theme.colors.text}]}
                resizeMode="contain"
              />
            </Animated.View>
          </AppPressable>
          <AppPressable
            onPress={() => onRemove(index)}
            style={styles.deleteBtn}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${entry.url}`}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Image
              source={require('../assets/delete-icon.png')}
              style={[styles.deleteIcon, {tintColor: theme.colors.text}]}
              resizeMode="contain"
            />
          </AppPressable>
        </View>
      </View>
      {busy ? (
        <View
          onLayout={event => {
            trackWidth.value = event.nativeEvent.layout.width;
          }}
          style={[styles.progressTrack, {backgroundColor: theme.colors.border}]}>
          <Animated.View
            style={[
              styles.progressFill,
              {backgroundColor: accent},
              sweepStyle,
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function MempoolProvidersEditor({
  entries,
  onChange,
  network = 'mainnet',
  curatedUrls = [],
  showSave = false,
  saveDisabled = false,
  onSave,
  showDefaults = true,
}: Props) {
  const {theme} = useTheme();
  const walletOnline = useWalletOnline();
  const [addUrl, setAddUrl] = useState('');
  const [checkingRoots, setCheckingRoots] = useState<Set<string>>(
    () => new Set(),
  );
  const [refreshingRoots, setRefreshingRoots] = useState<Set<string>>(
    () => new Set(),
  );
  const [checkSummary, setCheckSummary] = useState<string | null>(null);
  const [, setHealthTick] = useState(0);
  const checking = checkingRoots.size > 0;
  const summary = useMemo(() => providerListSummary(entries), [entries]);
  const chain = providerNetworkKey(network);
  const isLight = theme.colors.background === '#ffffff';
  const accent = isLight ? theme.colors.primary : theme.colors.bitcoinOrange;
  const onAccent = theme.colors.white;
  const curatedRoots = useMemo(
    () => new Set(curatedUrls.map(url => normalizeMempoolApiRoot(url))),
    [curatedUrls],
  );
  const placeholder =
    chain === 'testnet4'
      ? 'https://mempool.example/testnet4/api'
      : 'https://mempool.example/api';

  useEffect(() => {
    return subscribeMempoolHealth(() => {
      setHealthTick(t => t + 1);
    });
  }, []);

  const rejectWrongChain = (url: string): boolean => {
    if (providerUrlMatchesNetwork(url, chain)) {
      return false;
    }
    showAppNotice(
      'Wrong network',
      chain === 'testnet4'
        ? 'Testnet endpoints must be a testnet4 API, for example https://mempool.space/testnet4/api'
        : 'Mainnet endpoints must not be testnet or signet URLs.',
    );
    return true;
  };

  const emitChange = (next: MempoolProviderEntry[]) => {
    setCheckSummary(null);
    onChange(next);
  };

  const refreshProvider = async (entry: MempoolProviderEntry) => {
    const root = hostRoot(entry.url);
    if (
      !walletOnline ||
      !root ||
      refreshingRoots.has(root) ||
      checkingRoots.has(root)
    ) {
      return;
    }
    setRefreshingRoots(prev => new Set(prev).add(root));
    try {
      await probeMempoolApiBasesOnce([entry.url]);
    } finally {
      setRefreshingRoots(prev => {
        const next = new Set(prev);
        next.delete(root);
        return next;
      });
    }
  };

  const checkProviders = async () => {
    if (checking || !walletOnline || entries.length === 0) {
      return;
    }
    // Rows already being probed on their own are left out of this pass.
    const targets = entries.filter(
      e => !refreshingRoots.has(hostRoot(e.url)),
    );
    if (targets.length === 0) {
      return;
    }
    setCheckSummary(null);
    setCheckingRoots(new Set(targets.map(e => hostRoot(e.url))));
    try {
      await probeMempoolApiBasesOnce(targets.map(e => e.url));
      let fine = 0;
      let slow = 0;
      let bad = 0;
      for (const e of targets) {
        const q = getHostQuality(hostRoot(e.url));
        if (q === 'fine') {
          fine += 1;
        } else if (q === 'slow') {
          slow += 1;
        } else {
          bad += 1;
        }
      }
      const parts = [`Checked ${targets.length}`];
      if (fine > 0) {
        parts.push(`${fine} healthy`);
      }
      if (slow > 0) {
        parts.push(`${slow} slow`);
      }
      if (bad > 0) {
        parts.push(`${bad} unreachable`);
      }
      setCheckSummary(parts.join(' · '));
    } finally {
      setCheckingRoots(new Set());
    }
  };

  const addProvider = (raw: string) => {
    const url = normalizeProviderUrl(raw);
    if (!url) {
      return;
    }
    if (!isValidProviderUrl(url)) {
      showAppNotice(
        'Error',
        `Invalid provider URL: ${url}\n${PROVIDER_SCHEME_ERROR}`,
      );
      return;
    }
    if (rejectWrongChain(url)) {
      return;
    }
    if (entries.some(e => normalizeMempoolApiRoot(e.url) === normalizeMempoolApiRoot(url))) {
      showAppNotice('Already added', 'That provider is already in the list.');
      return;
    }
    emitChange([...entries, {url, enabled: true}]);
    setAddUrl('');
  };

  const setEnabled = (index: number, value: boolean) => {
    const next = entries.map((e, i) =>
      i === index ? {...e, enabled: value} : e,
    );
    if (!value && next.every(e => !e.enabled)) {
      showAppNotice(
        'Keep one endpoint on',
        'At least one endpoint must stay on.',
      );
      return;
    }
    emitChange(next);
  };

  const removeAt = (index: number) => {
    const target = entries[index];
    const remaining = entries.filter((_, i) => i !== index);
    const enabledLeft = remaining.filter(e => e.enabled).length;
    if (remaining.length === 0 || (target?.enabled && enabledLeft === 0)) {
      showAppNotice(
        'Keep one endpoint on',
        'At least one endpoint must stay on.',
      );
      return;
    }
    emitChange(remaining);
  };

  const muted = theme.colors.textSecondary;

  return (
    <View>
      <View style={styles.addRow}>
        <TextInput
          style={[
            styles.addInput,
            {
              color: theme.colors.text,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.cardBackground,
              fontFamily: theme.fontFamilies?.regular,
            },
          ]}
          value={addUrl}
          onChangeText={setAddUrl}
          placeholder={placeholder}
          placeholderTextColor={muted + '80'}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={() => addProvider(addUrl)}
        />
        <AppPressable
          style={[
            styles.addBtn,
            {backgroundColor: accent},
            !addUrl.trim() && styles.disabled,
          ]}
          disabled={!addUrl.trim()}
          onPress={() => addProvider(addUrl)}
          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
          <Text style={[styles.addBtnText, {color: onAccent}]}>
            Add
          </Text>
        </AppPressable>
      </View>

      <Text style={[styles.summary, {color: muted}]}>{summary}</Text>
      {entries.length === 0 ? (
        <Text style={[styles.empty, {color: muted}]}>
          No endpoints yet. Add one above.
        </Text>
      ) : null}
      {entries.map((entry, index) => (
        <ProviderRow
          key={entry.url}
          entry={entry}
          index={index}
          curated={curatedRoots.has(hostRoot(entry.url))}
          walletOnline={walletOnline}
          busy={
            checkingRoots.has(hostRoot(entry.url)) ||
            refreshingRoots.has(hostRoot(entry.url))
          }
          accent={accent}
          muted={muted}
          onToggle={setEnabled}
          onRemove={removeAt}
          onRefresh={refreshProvider}
        />
      ))}
      {checkSummary ? (
        <Text
          style={[
            styles.checkSummary,
            {color: muted, fontFamily: theme.fontFamilies?.medium},
          ]}>
          {checkSummary}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <AppPressable
          style={[
            styles.secondaryBtn,
            {borderColor: theme.colors.border},
            (checking || !walletOnline || entries.length === 0) &&
              styles.disabled,
          ]}
          disabled={checking || !walletOnline || entries.length === 0}
          onPress={checkProviders}
          accessibilityLabel="Check all mempool endpoints"
          accessibilityHint="Checks every listed endpoint once, on or off"
          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
          <Text style={[styles.secondaryBtnText, {color: theme.colors.text}]}>
            {checking ? 'Checking…' : 'Check all'}
          </Text>
        </AppPressable>
        {showSave ? (
          <AppPressable
            style={[
              styles.primaryBtn,
              {backgroundColor: accent},
              saveDisabled && styles.disabled,
            ]}
            disabled={saveDisabled}
            onPress={() => onSave?.()}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Text style={[styles.primaryBtnText, {color: onAccent}]}>
              Save Providers
            </Text>
          </AppPressable>
        ) : null}
        {showDefaults ? (
          <AppPressable
            style={[styles.secondaryBtn, {borderColor: theme.colors.border}]}
            onPress={async () => {
              const defaults = await loadDefaultMempoolProviderEntries(chain);
              const sameAsDefaults =
                entries.length === defaults.length &&
                entries.every((e, i) => {
                  const d = defaults[i];
                  return (
                    d &&
                    normalizeMempoolApiRoot(e.url) ===
                      normalizeMempoolApiRoot(d.url) &&
                    e.enabled === d.enabled
                  );
                });
              if (sameAsDefaults) {
                return;
              }
              confirmAppPrompt({
                icon: 'network',
                title: 'Reset endpoints?',
                hint: 'Your added servers and on/off choices are replaced.',
                cancelLabel: 'Cancel',
                confirmLabel: 'Reset',
                tone: 'danger',
              }).then(ok => {
                if (ok) {
                  emitChange(defaults);
                }
              });
            }}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Text style={[styles.secondaryBtnText, {color: theme.colors.text}]}>
              Defaults
            </Text>
          </AppPressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    fontSize: 12,
    marginTop: 10,
    marginBottom: 8,
  },
  empty: {
    fontSize: 13,
    marginBottom: 8,
  },
  checkSummary: {
    fontSize: 12,
    marginTop: 2,
  },
  row: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
  },
  url: {
    fontSize: 13,
    lineHeight: 18,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  controlsTail: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    width: '45%',
    height: 3,
    borderRadius: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    gap: 5,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  badgeDimmed: {
    opacity: 0.72,
  },
  deleteBtn: {
    padding: 6,
  },
  refreshBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshIcon: {
    width: 16,
    height: 16,
  },
  deleteIcon: {
    width: 16,
    height: 16,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  addBtn: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  primaryBtn: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.45,
  },
});
