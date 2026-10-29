import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {BlurView} from '@sbaiahmed1/react-native-blur';
import Toast from 'react-native-toast-message';
import AppSwitch from './AppSwitch';
import AppPressable from './AppPressable';
import ModalToastHost from './ModalToastHost';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import {
  notifyWalletOnlineToggle,
  setWalletOnline,
  useWalletOnline,
} from '../services/walletOnlineStore';
import {
  activeProviderUrls,
  isTestnetMempoolApiBase,
  loadMempoolProviderEntries,
  primaryProviderUrl,
  saveMempoolProviderEntries,
  subscribeMempoolProviders,
  type MempoolProviderEntry,
} from '../services/mempoolProvidersStore';
import mempoolClient from '../services/MempoolClient';
import {ensureFeeApisApplied} from '../services/apiConfigApply';
import {dbg} from '../utils';
import {
  getMempoolRequestLog,
  subscribeMempoolRequestLog,
  type MempoolRequestLogEntry,
  type MempoolRequestSource,
} from '../services/mempoolRequestLog';

type TabId = 'status' | 'providers' | 'calls';

type Anchor = {x: number; y: number; width: number; height: number};

type Props = {
  visible: boolean;
  onClose: () => void;
  apiBase?: string;
  /** Pill position from measureInWindow. */
  anchor: Anchor | null;
};

const SOURCE_LABEL: Record<MempoolRequestSource, string> = {
  cache: 'Cached',
  joined: 'Shared',
  live: 'Live',
  timeout: 'Timed out',
  native: 'On device',
};

function callUrl(entry: MempoolRequestLogEntry): string {
  if (entry.host) {
    const path = entry.path && entry.path !== '/' ? entry.path : '';
    return `${entry.host}${path}`;
  }
  return entry.path || '—';
}

function statusLabel(entry: MempoolRequestLogEntry): string {
  if (entry.source === 'timeout') {
    return '';
  }
  if (!entry.status) {
    return 'Failed';
  }
  return String(entry.status);
}

function formatTime(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function CallRow({
  entry,
  accent,
  danger,
  text,
  muted,
  border,
  cardBg,
  mono,
}: {
  entry: MempoolRequestLogEntry;
  accent: string;
  danger: string;
  text: string;
  muted: string;
  border: string;
  cardBg: string;
  mono?: string;
}) {
  const ok = entry.status >= 200 && entry.status < 300;
  const rail = ok ? accent : danger;
  const status = statusLabel(entry);
  const body =
    entry.source === 'timeout' && entry.bodyPreview.trim().toLowerCase() === 'timeout'
      ? ''
      : entry.bodyPreview;
  return (
    <View style={[styles.callRow, {borderColor: border}]}>
      <View style={[styles.callRail, {backgroundColor: rail}]} />
      <View style={styles.callMain}>
        <View style={styles.callMeta}>
          <Text style={[styles.callTime, {color: muted}]}>{formatTime(entry.at)}</Text>
          {entry.method ? (
            <Text style={[styles.callMethod, {color: text}]}>{entry.method}</Text>
          ) : null}
          <View style={[styles.badge, {backgroundColor: rail + '22'}]}>
            <Text style={[styles.badgeText, {color: rail}]}>
              {SOURCE_LABEL[entry.source]}
            </Text>
          </View>
          {status ? (
            <Text style={[styles.callStatus, {color: ok ? accent : danger}]}>
              {status}
            </Text>
          ) : null}
          {entry.durationMs != null ? (
            <Text style={[styles.callDur, {color: muted}]}>
              {entry.durationMs} ms
            </Text>
          ) : null}
        </View>
        <Text
          selectable
          style={[styles.callUrl, {color: text, fontFamily: mono}]}>
          {callUrl(entry)}
        </Text>
        {body ? (
          <View style={[styles.callBodyBox, {borderColor: border, backgroundColor: cardBg}]}>
            <Text style={[styles.callBodyLabel, {color: muted}]}>Response</Text>
            <Text
              selectable
              style={[styles.callBody, {color: text, fontFamily: mono}]}>
              {body}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function HeaderProviderCard({
  visible,
  onClose,
  apiBase,
  anchor,
}: Props) {
  const {theme} = useTheme();
  const {setActiveApiProvider} = useUser();
  const {width: winW, height: winH} = useWindowDimensions();
  const online = useWalletOnline();
  const [tab, setTab] = useState<TabId>('status');
  const [providersRev, setProvidersRev] = useState(0);
  const [entries, setEntries] = useState<MempoolProviderEntry[]>([]);
  const [toggling, setToggling] = useState(false);
  const [calls, setCalls] = useState<MempoolRequestLogEntry[]>(() =>
    getMempoolRequestLog(),
  );

  const providerNet = isTestnetMempoolApiBase(apiBase || '')
    ? 'testnet4'
    : 'mainnet';

  useEffect(
    () => subscribeMempoolProviders(() => setProvidersRev(n => n + 1)),
    [],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }
    return subscribeMempoolRequestLog(setCalls);
  }, [visible]);

  useEffect(() => {
    if (visible) {
      setTab('status');
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    let cancelled = false;
    loadMempoolProviderEntries(providerNet).then(list => {
      if (!cancelled) {
        setEntries(list);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible, providerNet, providersRev]);

  const primaryUrl = useMemo(
    () => (entries.length ? primaryProviderUrl(entries) : ''),
    [entries],
  );

  const onToggleProvider = useCallback(
    async (index: number, enabled: boolean) => {
      if (toggling) {
        return;
      }
      const next = entries.map((e, i) =>
        i === index ? {...e, enabled} : e,
      );
      if (activeProviderUrls(next).length === 0) {
        Toast.show({
          type: 'info',
          text1: 'Keep at least one provider on',
          position: 'top',
        });
        return;
      }
      setToggling(true);
      try {
        const saved = saveMempoolProviderEntries(next, providerNet);
        setEntries(saved);
        const enabledUrls = activeProviderUrls(saved);
        mempoolClient.setPublicBases(enabledUrls);
        const primary = primaryProviderUrl(saved);
        await setActiveApiProvider(primary);
        try {
          await ensureFeeApisApplied(enabledUrls, null);
        } catch {
          // no-op
        }
      } catch (err) {
        dbg('HeaderProviderCard: toggle provider failed', err);
        Toast.show({
          type: 'error',
          text1: 'Could not update providers',
          position: 'top',
        });
      } finally {
        setToggling(false);
      }
    },
    [entries, providerNet, setActiveApiProvider, toggling],
  );

  const isDark = theme.colors.background !== '#ffffff';
  const accent = isDark ? theme.colors.bitcoinOrange : theme.colors.primary;
  const cardBg = theme.colors.cardBackground;
  const border = theme.colors.border;
  const text = theme.colors.text;
  const muted = theme.colors.textSecondary;

  const cardWidth = Math.min(400, Math.max(280, winW - 24));
  const cardMaxH = Math.min(520, Math.max(300, winH - 24));
  const left = useMemo(() => {
    if (!anchor) {
      return Math.max(12, (winW - cardWidth) / 2);
    }
    const centered = anchor.x + anchor.width / 2 - cardWidth / 2;
    return Math.min(Math.max(12, centered), Math.max(12, winW - cardWidth - 12));
  }, [anchor, cardWidth, winW]);

  const top = useMemo(() => {
    const below = anchor ? anchor.y + anchor.height + 6 : 80;
    return Math.min(Math.max(12, below), Math.max(12, winH - cardMaxH - 12));
  }, [anchor, cardMaxH, winH]);

  const tabs: {id: TabId; label: string}[] = [
    {id: 'status', label: 'Status'},
    {id: 'providers', label: 'Providers'},
    {id: 'calls', label: 'Calls'},
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView
            style={StyleSheet.absoluteFill}
            blurType={
              isDark
                ? 'systemUltraThinMaterialDark'
                : 'systemUltraThinMaterialLight'
            }
            blurAmount={22}
            overlayColor={
              isDark ? 'rgba(18,18,20,0.14)' : 'rgba(255,255,255,0.22)'
            }
            reducedTransparencyFallbackColor={
              isDark ? 'rgba(18,18,20,0.55)' : 'rgba(255,255,255,0.72)'
            }
          />
        </View>
        <AppPressable
          variant="none"
          haptic={false}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View
          style={[
            styles.card,
            {
              left,
              top,
              width: cardWidth,
              maxHeight: cardMaxH,
              backgroundColor: cardBg,
              borderColor: border,
            },
          ]}>
          <View style={[styles.tabRow, {borderColor: border}]}>
            {tabs.map(t => {
              const selected = tab === t.id;
              return (
                <AppPressable
                  key={t.id}
                  style={[
                    styles.tab,
                    selected && styles.tabSelected,
                    selected && {borderBottomColor: accent},
                  ]}
                  onPress={() => setTab(t.id)}
                  accessibilityRole="tab"
                  accessibilityState={{selected}}>
                  <Text
                    style={[
                      styles.tabLabel,
                      {
                        color: selected ? text : muted,
                        fontFamily: theme.fontFamilies?.bold,
                      },
                    ]}>
                    {t.label}
                  </Text>
                </AppPressable>
              );
            })}
          </View>

          <View style={styles.body}>
            {tab === 'status' ? (
              <View>
                <View style={styles.statusRow}>
                  <Text
                    style={[
                      styles.statusLabel,
                      {color: text, fontFamily: theme.fontFamilies?.bold},
                    ]}>
                    {online ? 'Online' : 'Offline'}
                  </Text>
                  <AppSwitch
                    value={online}
                    onValueChange={value => {
                      setWalletOnline(value);
                      notifyWalletOnlineToggle(value);
                    }}
                  />
                </View>
                <Text
                  style={[
                    styles.hint,
                    {color: muted, fontFamily: theme.fontFamilies?.regular},
                  ]}>
                  {online
                    ? 'Online. Requests go to the providers that are switched on.'
                    : 'Offline sandbox. No request is sent to the internet. Balances, coins, and history stay on this device.'}
                </Text>
              </View>
            ) : null}

            {tab === 'providers' ? (
              entries.length === 0 ? (
                <Text style={[styles.empty, {color: muted}]}>
                  No providers yet. Add some in Settings.
                </Text>
              ) : (
                <ScrollView
                  style={{maxHeight: Math.max(180, cardMaxH - 150)}}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}>
                  {entries.map((entry, i) => {
                    const isPrimary =
                      entry.enabled &&
                      primaryUrl === entry.url;
                    return (
                      <View
                        key={`${entry.url}-${i}`}
                        style={[
                          styles.providerRow,
                          entry.enabled
                            ? styles.providerRowEnabled
                            : styles.providerRowDisabled,
                          {borderColor: border},
                        ]}>
                        <View style={styles.providerTitleRow}>
                          <View style={styles.providerTextCol}>
                            <Text
                              style={[
                                styles.providerUrl,
                                {
                                  color: text,
                                  fontFamily: theme.fontFamilies?.monospace,
                                },
                              ]}
                              numberOfLines={2}>
                              {entry.url}
                            </Text>
                            {isPrimary ? (
                              <View
                                style={[
                                  styles.primaryBadge,
                                  {backgroundColor: accent + '22'},
                                ]}>
                                <Text
                                  style={[
                                    styles.primaryBadgeText,
                                    {color: accent},
                                  ]}>
                                  Primary
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <AppSwitch
                            value={entry.enabled}
                            disabled={toggling}
                            onValueChange={value =>
                              onToggleProvider(i, value)
                            }
                            accessibilityLabel={`Use ${entry.url}`}
                          />
                        </View>
                      </View>
                    );
                  })}
                  <Text
                    style={[
                      styles.providersHint,
                      {color: muted, fontFamily: theme.fontFamilies?.regular},
                    ]}>
                    At least one stays on. Add or remove endpoints in Settings.
                  </Text>
                </ScrollView>
              )
            ) : null}

            {tab === 'calls' ? (
              calls.length === 0 ? (
                <Text style={[styles.empty, {color: muted}]}>
                  {online
                    ? 'No calls yet. Refresh the wallet and they will show up here, newest first.'
                    : 'No calls yet. The offline sandbox sends nothing to the internet, so this list stays quiet until you go online.'}
                </Text>
              ) : (
                <ScrollView
                  style={{maxHeight: Math.max(180, cardMaxH - 150)}}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}>
                  <Text
                    style={[
                      styles.callsHint,
                      {color: muted, fontFamily: theme.fontFamilies?.regular},
                    ]}>
                    Newest first. The full address is kept. Long responses are shortened.
                  </Text>
                  {calls.map(entry => (
                    <CallRow
                      key={entry.id}
                      entry={entry}
                      accent={accent}
                      danger={theme.colors.danger}
                      text={text}
                      muted={muted}
                      border={border}
                      cardBg={isDark ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.04)'}
                      mono={theme.fontFamilies?.monospace}
                    />
                  ))}
                </ScrollView>
              )
            ) : null}
          </View>
        </View>
        <ModalToastHost />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  card: {
    position: 'absolute',
    maxHeight: 520,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 6},
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSelected: {
    borderBottomWidth: 2,
  },
  tabLabel: {
    fontSize: 13,
  },
  body: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusLabel: {
    fontSize: 16,
  },
  hint: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
  },
  empty: {
    fontSize: 13,
    lineHeight: 18,
  },
  providerRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
  },
  providerRowEnabled: {opacity: 1},
  providerRowDisabled: {opacity: 0.72},
  providerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  providerTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  providerUrl: {
    fontSize: 12,
    lineHeight: 16,
  },
  primaryBadge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  primaryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  providersHint: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    marginBottom: 4,
  },
  callsHint: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
  },
  callRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  callRail: {
    width: 4,
  },
  callMain: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  callMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  callTime: {
    fontSize: 11,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  callStatus: {
    fontSize: 12,
    fontWeight: '700',
  },
  callDur: {
    fontSize: 11,
  },
  callMethod: {
    fontSize: 11,
    fontWeight: '700',
  },
  callUrl: {
    fontSize: 12,
    lineHeight: 17,
  },
  callBodyBox: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  callBodyLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  callBody: {
    fontSize: 11,
    lineHeight: 16,
  },
});
