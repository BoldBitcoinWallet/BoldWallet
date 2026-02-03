import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Modal,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
  interpolate,
} from 'react-native-reanimated';
import AppPressable from '../components/AppPressable';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import LocalCache from '../services/LocalCache';
import {
  HeaderPriceButton,
  HeaderProvider,
  HeaderNetwork,
} from '../components/Header';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-toast-message';
import {
  MEMPOOL_PLAYGROUND_SECTIONS,
  type PlaygroundEndpoint,
  type PlaygroundSection,
  type EndpointParam,
} from '../constants/mempoolPlaygroundEndpoints';
import {HapticFeedback} from '../utils';

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  theme: any;
  cardBg: string;
  borderColor: string;
  styles: {
    collapsibleSection: any;
    sectionExpanded: any;
    sectionHeader: any;
    sectionHeaderTitle: any;
    expandIcon: any;
    sectionContent: any;
  };
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  children,
  isExpanded,
  onToggle,
  theme,
  cardBg,
  borderColor,
  styles: sectionStyles,
}) => {
  const rotationAnim = useSharedValue(isExpanded ? 1 : 0);
  useEffect(() => {
    rotationAnim.value = withTiming(isExpanded ? 1 : 0, {duration: 200});
  }, [isExpanded, rotationAnim]);
  const rotateAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{rotate: `${interpolate(rotationAnim.value, [0, 1], [0, 90])}deg`}],
  }));
  const contentStyle = useMemo(
    () => ({
      opacity: isExpanded ? 1 : 0,
      maxHeight: isExpanded ? 9999 : 0,
      paddingTop: isExpanded ? 16 : 0,
      paddingBottom: isExpanded ? 16 : 0,
      paddingHorizontal: isExpanded ? 16 : 0,
      overflow: 'hidden' as const,
    }),
    [isExpanded],
  );
  const handlePress = () => {
    HapticFeedback.light();
    rotationAnim.value = withTiming(isExpanded ? 0 : 1, {duration: 200});
    onToggle();
  };
  return (
    <View
      style={[
        sectionStyles.collapsibleSection,
        {backgroundColor: cardBg, borderColor},
        isExpanded && sectionStyles.sectionExpanded,
      ]}>
      <AppPressable
        style={sectionStyles.sectionHeader}
        onPress={handlePress}
        android_ripple={{color: 'rgba(0,0,0,0.08)'}}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`${title} section, ${isExpanded ? 'expanded' : 'collapsed'}`}
        accessibilityHint={`Double tap to ${isExpanded ? 'collapse' : 'expand'} ${title} section`}>
        <Text style={[sectionStyles.sectionHeaderTitle, {color: theme.colors.text}]}>
          {title}
        </Text>
        <Animated.Text
          style={[sectionStyles.expandIcon, {color: theme.colors.text}, rotateAnimatedStyle]}>
          ▶
        </Animated.Text>
      </AppPressable>
      <View
        style={[
          sectionStyles.sectionContent,
          {borderTopColor: theme.colors.border + '60'},
          contentStyle,
        ]}>
        {children}
      </View>
    </View>
  );
};

/** Base URL for API (strip /api suffix from context apiBase). */
const API_REQUEST_TIMEOUT_MS = 10000;

function getBaseUrl(apiBase: string): string {
  if (!apiBase) return 'https://mempool.space';
  return apiBase.replace(/\/api\/?$/, '') || 'https://mempool.space';
}

/** Resolve placeholder for a param based on network (testnet uses placeholderTestnet when set). */
function getPlaceholder(p: EndpointParam, network: string): string {
  return network === 'testnet' && p.placeholderTestnet ? p.placeholderTestnet : p.placeholder;
}

/** Build path from template and path params; optional empty params remove their segment. */
function buildPath(
  pathTemplate: string,
  pathParams?: EndpointParam[],
  values: Record<string, string> = {},
  network?: string,
): string {
  if (!pathParams?.length) return pathTemplate;
  let path = pathTemplate;
  for (const p of pathParams) {
    const v = (values[p.name] ?? '').trim();
    if (p.optional && !v) {
      path = path
        .replace(new RegExp(`/:${p.name}(?=/|$)`, 'g'), '')
        .replace(/\/+/g, '/')
        .replace(/\/$/, '');
    } else {
      const fallback = network ? getPlaceholder(p, network) : p.placeholder;
      path = path.replace(
        new RegExp(`:${p.name}`, 'g'),
        encodeURIComponent(v || fallback),
      );
    }
  }
  return path.replace(/\/+/g, '/').replace(/\/$/, '') || path;
}

/** Build query string from query params. */
function buildQuery(
  queryParams?: EndpointParam[],
  values: Record<string, string> = {},
): string {
  if (!queryParams?.length) return '';
  const pairs: string[] = [];
  for (const p of queryParams) {
    const v = (values[p.name] ?? '').trim();
    if (v || !p.optional) {
      if (p.name === 'txId[]') {
        v.split(',').forEach(txid => {
          const t = txid.trim();
          if (t) pairs.push(`txId[]=${encodeURIComponent(t)}`);
        });
      } else {
        pairs.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(v)}`);
      }
    }
  }
  return pairs.length ? `?${pairs.join('&')}` : '';
}

const MempoolPlaygroundScreen: React.FC<{navigation: any}> = ({navigation}) => {
  const {theme} = useTheme();
  const {
    activeApiProvider: apiBase,
    activeNetwork: network,
  } = useUser();

  const [btcPrice, setBtcPrice] = useState<string>('');
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [sectionSelected, setSectionSelected] = useState<Record<string, string>>({});
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({});
  const [postBodies, setPostBodies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const first = MEMPOOL_PLAYGROUND_SECTIONS[0]?.id;
    return first ? {[first]: true} : {};
  });
  const [endpointPickerSectionId, setEndpointPickerSectionId] = useState<string | null>(null);

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const willBeOpen = !prev[sectionId];
      if (willBeOpen) {
        return {[sectionId]: true};
      }
      return {...prev, [sectionId]: false};
    });
  }, []);

  const baseUrl = getBaseUrl(apiBase || '');

  // Header: same as WalletHome – price (left), provider (center), network (right)
  useEffect(() => {
    LocalCache.getItem('currency').then(c => setSelectedCurrency(c || 'USD'));
  }, []);
  useEffect(() => {
    if (!apiBase) return;
    const url = `${getBaseUrl(apiBase)}/api/v1/prices`;
    fetch(url)
      .then(r => r.json())
      .then((data: Record<string, number>) => {
        const currency = selectedCurrency || 'USD';
        const raw = data[currency];
        if (typeof raw === 'number') setBtcPrice(String(raw));
        else setBtcPrice('');
      })
      .catch(() => setBtcPrice(''));
  }, [apiBase, selectedCurrency]);

  const headerLeft = useCallback(
    () => (
      <HeaderPriceButton
        btcPrice={btcPrice}
        selectedCurrency={selectedCurrency}
        onCurrencyPress={() => {}}
      />
    ),
    [btcPrice, selectedCurrency],
  );
  const headerTitle = useCallback(
    () => <HeaderProvider apiBase={apiBase} />,
    [apiBase],
  );
  const headerRight = useCallback(
    () => (
      <HeaderNetwork
        network={network}
        onPress={() =>
          navigation.navigate('Settings', {expandSection: 'advanced'})
        }
      />
    ),
    [network, navigation],
  );

  useEffect(() => {
    navigation.setOptions({
      headerLeft,
      headerTitle,
      headerRight,
      headerTitleAlign: 'center',
      headerStyle: {backgroundColor: theme.colors.background},
      headerTitleContainerStyle: {flex: 1, minWidth: 0, marginHorizontal: 0},
    });
  }, [
    navigation,
    headerLeft,
    headerTitle,
    headerRight,
    theme.colors.background,
  ]);

  const setParam = useCallback(
    (sectionId: string, name: string, value: string) => {
      setParamValues(prev => ({
        ...prev,
        [sectionId]: { ...(prev[sectionId] || {}), [name]: value },
      }));
    },
    [],
  );
  const setPostBody = useCallback((sectionId: string, value: string) => {
    setPostBodies(prev => ({...prev, [sectionId]: value}));
  }, []);

  const runRequest = useCallback(
    async (section: PlaygroundSection, endpoint: PlaygroundEndpoint) => {
      const sid = section.id;
      setLoading(prev => ({...prev, [sid]: true}));
      setResponses(prev => ({...prev, [sid]: ''}));

      const path = buildPath(
        endpoint.pathTemplate,
        endpoint.pathParams,
        paramValues[sid] || {},
        network,
      );
      const query = buildQuery(
        endpoint.queryParams,
        paramValues[sid] || {},
      );
      const url = `${baseUrl}${path}${query}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

      try {
        if (endpoint.method === 'GET') {
          const res = await fetch(url, {signal: controller.signal});
          const text = await res.text();
          let body = text;
          try {
            const json = JSON.parse(text);
            body = JSON.stringify(json, null, 2);
          } catch {
            // keep raw text
          }
          const line = `HTTP ${res.status}\n${body}`;
          setResponses(prev => ({...prev, [sid]: line}));
        } else {
          const rawBody = (postBodies[sid] || '').trim();
          const res = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: endpoint.bodyIsRawHex
              ? {'Content-Type': 'text/plain'}
              : {'Content-Type': 'application/json'},
            body: endpoint.bodyIsRawHex ? rawBody : rawBody || '{}',
          });
          const text = await res.text();
          let body = text;
          try {
            const json = JSON.parse(text);
            body = JSON.stringify(json, null, 2);
          } catch {
            // keep raw
          }
          setResponses(prev => ({
            ...prev,
            [sid]: `HTTP ${res.status}\n${body}`,
          }));
        }
      } catch (e: any) {
        const message =
          e?.name === 'AbortError'
            ? `Request timed out after ${API_REQUEST_TIMEOUT_MS / 1000} seconds`
            : e?.message || String(e);
        setResponses(prev => ({
          ...prev,
          [sid]: `Error: ${message}`,
        }));
      } finally {
        clearTimeout(timeoutId);
        setLoading(prev => ({...prev, [sid]: false}));
      }
    },
    [baseUrl, paramValues, postBodies, network],
  );

  const copyResponse = useCallback((sectionId: string) => {
    const text = responses[sectionId];
    if (text) {
      Clipboard.setString(text);
      HapticFeedback.light();
      Toast.show({
        type: 'success',
        text1: 'Copied',
        text2: 'Response copied to clipboard',
        position: 'top',
      });
    }
  }, [responses]);

  const isDarkMode = theme.colors.background !== '#ffffff';
  const cardBg = isDarkMode
    ? theme.colors.cardBackground
    : theme.colors.blackOverlay06;
  const borderColor = isDarkMode
    ? theme.colors.border + '80'
    : theme.colors.blackOverlay10;
  const inputStyle = {
    backgroundColor: isDarkMode ? theme.colors.background : '#fff',
    borderWidth: 1,
    borderColor,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: theme.fontSizes?.sm || 14,
    color: theme.colors.text,
    minHeight: 44,
  };
  const responseStyle = {
    ...inputStyle,
    minHeight: 120,
    textAlignVertical: 'top' as const,
    fontFamily: theme.fontFamilies?.monospace || undefined,
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        mainContainer: {flex: 1},
        scroll: {flex: 1},
        scrollContent: {padding: 16, paddingBottom: 32},
        topDescription: {
          fontSize: theme.fontSizes?.base || 14,
          textAlign: 'center',
          marginBottom: 20,
          paddingHorizontal: 8,
        },
        collapsibleSection: {
          marginBottom: 12,
          borderRadius: 12,
          borderWidth: 1,
          overflow: 'hidden',
        },
        sectionExpanded: {},
        sectionHeader: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingVertical: 14,
          paddingHorizontal: 16,
        },
        sectionHeaderTitle: {
          fontSize: theme.fontSizes?.lg || 18,
          fontFamily: theme.fontFamilies?.bold,
          flex: 1,
        },
        expandIcon: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
        },
        sectionContent: {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: 'rgba(0,0,0,0.08)',
        },
        pickerWrap: {marginBottom: 8},
        dropdown: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 12,
          minHeight: 44,
        },
        dropdownLabel: {
          fontSize: theme.fontSizes?.md || 15,
          flex: 1,
          marginRight: 8,
        },
        dropdownChevron: {
          fontSize: theme.fontSizes?.sm || 12,
        },
        modalOverlay: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          padding: 24,
        },
        modalContent: {
          borderRadius: 12,
          borderWidth: 1,
          maxHeight: '70%',
          padding: 16,
        },
        modalTitle: {
          fontSize: theme.fontSizes?.lg || 18,
          fontFamily: theme.fontFamilies?.bold,
          marginBottom: 12,
          textAlign: 'center',
        },
        modalList: {
          maxHeight: 320,
          marginBottom: 12,
        },
        modalItem: {
          paddingVertical: 14,
          paddingHorizontal: 12,
          borderRadius: 8,
          marginBottom: 4,
        },
        modalItemText: {
          fontSize: theme.fontSizes?.md || 15,
        },
        modalItemTextSelected: {
          fontFamily: theme.fontFamilies?.medium,
        },
        modalCancelBtn: {
          paddingVertical: 12,
          borderRadius: 8,
          borderWidth: 1,
          alignItems: 'center',
        },
        modalCancelText: {
          fontSize: theme.fontSizes?.lg || 16,
          fontFamily: theme.fontFamilies?.medium,
        },
        label: {
          fontSize: theme.fontSizes?.sm || 12,
          marginBottom: 4,
        },
        hint: {
          fontSize: theme.fontSizes?.sm || 12,
          marginBottom: 12,
          fontStyle: 'italic',
        },
        inputRow: {marginBottom: 12},
        submitBtn: {
          paddingVertical: 12,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 8,
          minHeight: 44,
        },
        submitBtnText: {
          color: '#fff',
          fontFamily: theme.fontFamilies?.medium,
          fontSize: theme.fontSizes?.lg || 16,
        },
        responseWrap: {marginTop: 16},
        responseHeader: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        },
        copyText: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.medium,
        },
      }),
    [theme],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.mainContainer, {backgroundColor: theme.colors.background}]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <Text style={[styles.topDescription, {color: theme.colors.textSecondary}]}>
          This is a mempool playground for some utility APIs.
        </Text>
        {MEMPOOL_PLAYGROUND_SECTIONS.map(section => {
          const selectedId = sectionSelected[section.id] ?? section.endpoints[0]?.id;
          const endpoint = section.endpoints.find(e => e.id === selectedId) ?? section.endpoints[0];
          const values = paramValues[section.id] || {};
          const loadingThis = loading[section.id];
          const responseText = responses[section.id];
          const isExpanded = expandedSections[section.id] ?? false;

          return (
            <CollapsibleSection
              key={section.id}
              title={section.title}
              isExpanded={isExpanded}
              onToggle={() => toggleSection(section.id)}
              theme={theme}
              cardBg={cardBg}
              borderColor={borderColor}
              styles={styles}>
              <View style={styles.pickerWrap}>
                <Text style={[styles.label, {color: theme.colors.textSecondary}]}>
                  Endpoint
                </Text>
                <AppPressable
                  onPress={() => {
                    HapticFeedback.light();
                    setEndpointPickerSectionId(section.id);
                  }}
                  style={[styles.dropdown, {borderColor, backgroundColor: theme.colors.background}]}>
                  <Text
                    style={[styles.dropdownLabel, {color: theme.colors.text}]}
                    numberOfLines={1}>
                    {endpoint?.label ?? 'Select endpoint'}
                  </Text>
                  <Text style={[styles.dropdownChevron, {color: theme.colors.textSecondary}]}>
                    ▼
                  </Text>
                </AppPressable>
                <Modal
                  visible={endpointPickerSectionId === section.id}
                  transparent
                  animationType="fade"
                  onRequestClose={() => setEndpointPickerSectionId(null)}>
                  <TouchableOpacity
                    activeOpacity={1}
                    style={styles.modalOverlay}
                    onPress={() => setEndpointPickerSectionId(null)}>
                    <TouchableOpacity
                      activeOpacity={1}
                      onPress={() => {}}
                      style={[
                        styles.modalContent,
                        {
                          backgroundColor: theme.colors.cardBackground ?? theme.colors.background,
                          borderColor: theme.colors.border,
                        },
                      ]}>
                      <Text style={[styles.modalTitle, {color: theme.colors.text}]}>
                        Select endpoint
                      </Text>
                      <FlatList
                        data={section.endpoints}
                        keyExtractor={item => item.id}
                        style={styles.modalList}
                        renderItem={({item: ep}) => (
                          <AppPressable
                            onPress={() => {
                              HapticFeedback.light();
                              setSectionSelected(prev => ({...prev, [section.id]: ep.id}));
                              setEndpointPickerSectionId(null);
                            }}
                            style={[
                              styles.modalItem,
                              ep.id === selectedId && {
                                backgroundColor: theme.colors.primary + '18',
                              },
                            ]}>
                            <Text
                              style={[
                                styles.modalItemText,
                                {color: theme.colors.text},
                                ep.id === selectedId && [
                                  {color: theme.colors.primary},
                                  styles.modalItemTextSelected,
                                ],
                              ]}
                              numberOfLines={1}>
                              {ep.label}
                            </Text>
                          </AppPressable>
                        )}
                      />
                      <AppPressable
                        onPress={() => setEndpointPickerSectionId(null)}
                        style={[styles.modalCancelBtn, {borderColor: theme.colors.border}]}>
                        <Text style={[styles.modalCancelText, {color: theme.colors.text}]}>
                          Cancel
                        </Text>
                      </AppPressable>
                    </TouchableOpacity>
                  </TouchableOpacity>
                </Modal>
              </View>
              {endpoint && (
                <>
                  <Text style={[styles.hint, {color: theme.colors.textSecondary}]}>
                    {endpoint.description}
                  </Text>
                  {endpoint.pathParams?.map(p => (
                    <View key={p.name} style={styles.inputRow}>
                      <Text style={[styles.label, {color: theme.colors.textSecondary}]}>
                        {p.name}{p.optional ? ' (optional)' : ''}
                      </Text>
                      <TextInput
                        style={inputStyle}
                        placeholder={getPlaceholder(p, network)}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={values[p.name] ?? ''}
                        onChangeText={t => setParam(section.id, p.name, t)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                  ))}
                  {endpoint.queryParams?.map(p => (
                    <View key={p.name} style={styles.inputRow}>
                      <Text style={[styles.label, {color: theme.colors.textSecondary}]}>
                        {p.name}{p.optional ? ' (optional)' : ''}
                      </Text>
                      <TextInput
                        style={inputStyle}
                        placeholder={getPlaceholder(p, network)}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={values[p.name] ?? ''}
                        onChangeText={t => setParam(section.id, p.name, t)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                  ))}
                  {endpoint.method === 'POST' && endpoint.postBodyHint && (
                    <View style={styles.inputRow}>
                      <Text style={[styles.label, {color: theme.colors.textSecondary}]}>
                        {endpoint.postBodyHint}
                      </Text>
                      <TextInput
                        style={responseStyle}
                        placeholder="Paste hex here"
                        placeholderTextColor={theme.colors.textSecondary}
                        value={postBodies[section.id] ?? ''}
                        onChangeText={t => setPostBody(section.id, t)}
                        multiline
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                  )}
                  <AppPressable
                    onPress={() => endpoint && runRequest(section, endpoint)}
                    disabled={loadingThis}
                    style={[
                      styles.submitBtn,
                      {backgroundColor: theme.colors.primary},
                    ]}>
                    {loadingThis ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.submitBtnText}>Submit</Text>
                    )}
                  </AppPressable>
                  {(responseText || loadingThis) && (
                    <View style={styles.responseWrap}>
                      <View style={styles.responseHeader}>
                        <Text style={[styles.label, {color: theme.colors.textSecondary}]}>
                          Response
                        </Text>
                        {responseText ? (
                          <AppPressable onPress={() => copyResponse(section.id)}>
                            <Text style={[styles.copyText, {color: theme.colors.primary}]}>
                              Copy
                            </Text>
                          </AppPressable>
                        ) : null}
                      </View>
                      <TextInput
                        style={responseStyle}
                        value={responseText}
                        editable={false}
                        multiline
                        selectTextOnFocus
                      />
                    </View>
                  )}
                </>
              )}
            </CollapsibleSection>
          );
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default MempoolPlaygroundScreen;
