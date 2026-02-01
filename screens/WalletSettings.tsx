import React, {useEffect, useState, useRef, useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  Modal,
  NativeModules,
  Switch,
  ScrollView,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  useWindowDimensions,
  DeviceEventEmitter,
} from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  withSpring,
  useAnimatedStyle,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import {SafeAreaView} from 'react-native-safe-area-context';
import EncryptedStorage from 'react-native-encrypted-storage';
const {BBMTLibNativeModule} = NativeModules;
import DeviceInfo from 'react-native-device-info';
import {useUser} from '../context/UserContext';
// Predefined API endpoints
const MAINNET_APIS = ['https://mempool.space/api'];
const TESTNET_APIS = ['https://mempool.space/testnet/api'];
const {IconChanger} = NativeModules; // This is fine here, as it's not a Hook
import {
  dbg,
  HapticFeedback,
  setHapticsEnabled,
  areHapticsEnabled,
  getMainnetAPIList,
  getKeyshareLabel,
  getResetToMainTabsWallet,
} from '../utils';
import {useTheme} from '../theme';
import {WalletService} from '../services/WalletService';
import LocalCache from '../services/LocalCache';
import LegalModal from '../components/LegalModal';
import BackupKeyshareModal from '../components/BackupKeyshareModal';
import {fetchDynamicAPIEndpoints, getNostrRelays} from '../utils';
import FontComparisonScreen from '../components/FontComparisonScreen';
import {setDebugLoggingEnabled, isDebugLoggingEnabled} from '../App';
import Toast from 'react-native-toast-message';
interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  styles: any;
  theme: any;
}
const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  children,
  isExpanded,
  onToggle,
  styles,
  theme,
}) => {
  const rotationAnim = useSharedValue(isExpanded ? 1 : 0);
  useEffect(() => {
    // Sync rotation with isExpanded on mount or prop change
    rotationAnim.value = withTiming(isExpanded ? 1 : 0, {duration: 200});
  }, [isExpanded, rotationAnim]);
  const rotateAnimatedStyle = useAnimatedStyle(() => {
    const rotation = interpolate(rotationAnim.value, [0, 1], [0, 90]);
    return {
      transform: [{rotate: `${rotation}deg`}],
    };
  });
  const handlePress = () => {
    HapticFeedback.light();
    // Animate rotation immediately
    rotationAnim.value = withTiming(isExpanded ? 0 : 1, {duration: 200});
    // Toggle content
    onToggle();
  };
  const animatedStyle = useMemo(
    () => ({
      opacity: isExpanded ? 1 : 0,
      height: isExpanded ? 'auto' : 0,
      transform: [{scaleY: isExpanded ? 1 : 0.8}],
      padding: isExpanded ? 16 : 0,
    }),
    [isExpanded],
  );
  return (
    <View
      style={[styles.collapsibleSection, isExpanded && styles.sectionExpanded]}>
      <Pressable
        style={styles.sectionHeader}
        onPress={handlePress}
        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`${title} section, ${
          isExpanded ? 'expanded' : 'collapsed'
        }`}
        accessibilityHint={`Double tap to ${
          isExpanded ? 'collapse' : 'expand'
        } ${title} section`}>
        <View style={styles.sectionHeaderContent}>
          <Image
            source={getSectionIcon(title)}
            style={styles.sectionIcon}
            resizeMode="contain"
          />
          <Text style={styles.sectionHeaderTitle}>{title}</Text>
        </View>
        <Animated.Text
          style={[
            styles.expandIcon,
            rotateAnimatedStyle,
            {
              color: theme.colors.text,
            },
          ]}>
          ▶
        </Animated.Text>
      </Pressable>
      {/* Always render content, collapse with opacity/scale animation */}
      <Animated.View style={[styles.sectionContent, animatedStyle]}>
        {children}
      </Animated.View>
    </View>
  );
};
// API Endpoint Autocomplete Component
interface APIAutocompleteProps {
  value: string;
  onChangeText: (text: string) => void;
  isTestnet: boolean;
  styles: any;
  theme: any;
}
const APIAutocomplete: React.FC<APIAutocompleteProps> = ({
  value,
  onChangeText,
  isTestnet,
  styles,
  theme,
}) => {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [filteredOptions, setFilteredOptions] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [dynamicAPIs, setDynamicAPIs] = useState<string[]>([]);
  const [isLoadingAPIs, setIsLoadingAPIs] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const searchInputRef = useRef<TextInput>(null);
  const flatListRef = useRef<FlatList<string>>(null);
  const {height} = useWindowDimensions();
  const modalAnimation = useSharedValue(0);
  const reversedOptions = useMemo(
    () => [...filteredOptions].reverse(),
    [filteredOptions],
  );
  // Get the appropriate API list - filter by network
  const [predefinedAPIs, setPredefinedAPIs] = useState<string[]>([]);
  const [isLoadingPredefinedAPIs, setIsLoadingPredefinedAPIs] = useState(false);
  const lastLoadedNetworkRef = useRef<string | null>(null);
  // Load API lists - restrict testnet to only the hardcoded endpoint
  useEffect(() => {
    const currentNetwork = isTestnet ? 'testnet' : 'mainnet';
    // Only load if network changed
    if (lastLoadedNetworkRef.current === currentNetwork) {
      return; // Already loaded for this network
    }
    if (isLoadingPredefinedAPIs) return;
    const loadAPIList = async () => {
      setIsLoadingPredefinedAPIs(true);
      try {
        if (isTestnet) {
          // For testnet, only use the hardcoded TESTNET endpoint
          setPredefinedAPIs(TESTNET_APIS);
          dbg('Testnet API list loaded:', TESTNET_APIS);
        } else {
          // For mainnet, use dynamic loading
          const apiList = await getMainnetAPIList();
          setPredefinedAPIs(apiList);
          dbg('Mainnet API list loaded:', apiList);
        }
        lastLoadedNetworkRef.current = currentNetwork;
      } catch (error) {
        dbg('Failed to load API list:', error);
        // Fallback to hardcoded APIs
        setPredefinedAPIs(isTestnet ? TESTNET_APIS : MAINNET_APIS);
        lastLoadedNetworkRef.current = currentNetwork;
      } finally {
        setIsLoadingPredefinedAPIs(false);
      }
    };
    loadAPIList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestnet]);
  // Fetch dynamic APIs - load when in mainnet mode and not already loaded
  const dynamicAPIsLoadingRef = useRef(false);
  useEffect(() => {
    // Only load dynamic APIs for mainnet
    if (isTestnet) {
      return;
    }
    // If already loading or already have dynamic APIs, don't reload
    if (isLoadingAPIs || dynamicAPIs.length > 0) {
      return;
    }
    // Prevent multiple simultaneous load attempts
    if (dynamicAPIsLoadingRef.current) {
      return;
    }
    const loadDynamicAPIs = async () => {
      dynamicAPIsLoadingRef.current = true;
      setIsLoadingAPIs(true);
      try {
        const fetchedAPIs = await fetchDynamicAPIEndpoints();
        if (fetchedAPIs.length > 0) {
          setDynamicAPIs(fetchedAPIs);
          dbg('Dynamic APIs loaded:', fetchedAPIs);
        }
      } catch (error) {
        dbg('Failed to load dynamic APIs:', error);
      } finally {
        setIsLoadingAPIs(false);
        dynamicAPIsLoadingRef.current = false;
      }
    };
    loadDynamicAPIs();
  }, [isTestnet, dynamicAPIs.length, isLoadingAPIs]);
  // Compute available APIs based on network - use useMemo to prevent unnecessary recalculations
  const availableAPIs = useMemo(() => {
    if (isTestnet) {
      return predefinedAPIs;
    } else {
      // For mainnet, combine predefined and dynamic APIs, but filter out testnet URLs
      const combined = [...predefinedAPIs, ...dynamicAPIs];
      const filtered = combined.filter(
        api => !api.toLowerCase().includes('testnet'),
      );
      // Remove duplicates
      return [...new Set(filtered)];
    }
  }, [isTestnet, predefinedAPIs, dynamicAPIs]);
  // Filter options based on search query - only update when search query or available APIs change
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredOptions(availableAPIs);
    } else {
      const filtered = availableAPIs.filter(api =>
        api.toLowerCase().includes(searchQuery.toLowerCase()),
      );
      setFilteredOptions(filtered);
    }
  }, [searchQuery, availableAPIs]);
  // Reset search query when network changes
  useEffect(() => {
    setSearchQuery('');
  }, [isTestnet]);
  // Handle keyboard appearance - modal adjusts via KeyboardAvoidingView
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      'keyboardDidShow',
      () => {
        // Scroll list to top when keyboard shows to see more items
        setTimeout(() => {
          flatListRef.current?.scrollToOffset({offset: 0, animated: true});
        }, 100);
      },
    );
    return () => {
      keyboardDidShowListener.remove();
    };
  }, []);
  const handleTextChange = (text: string) => {
    onChangeText(text);
  };
  const handleFocus = () => {
    setIsFocused(true);
  };
  const handleBlur = () => {
    setIsFocused(false);
  };
  const openModal = () => {
    // Prevent modal opening in testnet mode
    if (isTestnet) return;
    HapticFeedback.light();
    // The filtered options will be set by the useEffect that handles API options
    setSearchQuery('');
    setIsModalVisible(true);
    inputRef.current?.blur();
    // Reset and animate modal entrance
    modalAnimation.value = 0;
    modalAnimation.value = withSpring(1, {
      damping: 11,
      stiffness: 65,
    });
  };
  const closeModal = () => {
    HapticFeedback.light();
    // Animate modal exit
    const finishCallback = () => {
      setIsModalVisible(false);
      setSearchQuery('');
    };
    modalAnimation.value = withTiming(0, {duration: 200}, () => {
      runOnJS(finishCallback)();
    });
  };
  const selectOption = async (option: string) => {
    dbg('selectOption called with:', option);
    HapticFeedback.selection();
    await onChangeText(option);
    closeModal();
  };
  const getNetworkIcon = (api: string) => {
    return api.toLowerCase().includes('testnet')
      ? require('../assets/testnet-icon.png')
      : require('../assets/mainnet-icon.png');
  };
  const renderApiItem = ({item}: {item: string}) => {
    const isSelected = item === value;
    return (
      <Pressable
        key={item}
        style={[
          styles.apiModalItem,
          {borderBottomColor: theme.colors.border},
          isSelected && styles.apiModalItemSelected,
        ]}
        onPress={() => selectOption(item)}
        android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
        <Image
          source={getNetworkIcon(item)}
          style={styles.apiModalItemIcon}
          resizeMode="contain"
        />
        <Text
          style={[
            styles.apiModalItemText,
            {color: theme.colors.text},
            isSelected && [
              styles.apiModalItemTextSelected,
              {
                color:
                  theme.colors.background === '#ffffff'
                    ? theme.colors.primary
                    : theme.colors.bitcoinOrange,
              },
            ],
          ]}
          numberOfLines={1}
          ellipsizeMode="middle">
          {item}
        </Text>
        {isSelected && (
          <View
            style={[
              styles.apiModalItemCheckContainer,
              {backgroundColor: theme.colors.primary},
            ]}>
            <Text style={styles.apiModalItemCheck}>✓</Text>
          </View>
        )}
      </Pressable>
    );
  };
  const renderListEmpty = () => {
    if (isLoadingAPIs && !isTestnet) {
      return (
        <View style={styles.apiModalLoading}>
          <Text
            style={[
              styles.apiModalLoadingText,
              {color: theme.colors.textSecondary},
            ]}>
            Loading API endpoints...
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.apiModalEmpty}>
        <Text
          style={[
            styles.apiModalEmptyText,
            {color: theme.colors.textSecondary},
          ]}>
          No endpoints found
        </Text>
      </View>
    );
  };
  const getInputContainerStyle = () => {
    const baseStyle = [styles.apiInputContainer];
    if (isFocused) {
      baseStyle.push(styles.apiInputContainerFocused);
    }
    return baseStyle;
  };
  // Animated style for modal
  const modalAnimatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(modalAnimation.value, [0, 1], [100, 0]);
    return {
      opacity: modalAnimation.value,
      transform: [{translateY}],
    };
  });
  return (
    <>
      <View style={styles.apiAutocompleteContainer}>
        <View style={styles.apiInputRow}>
          <View style={getInputContainerStyle()}>
            <TextInput
              ref={inputRef}
              style={styles.apiTextInput}
              returnKeyType="done"
              value={value}
              onChangeText={handleTextChange}
              onFocus={handleFocus}
              onBlur={handleBlur}
              placeholder="Your Mempool Endpoint"
              placeholderTextColor={theme.colors.textSecondary + '80'}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isTestnet}
            />
            <Pressable
              style={styles.apiDropdownButton}
              onPress={() => {
                if (!isTestnet) {
                  openModal();
                }
              }}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}
              disabled={isTestnet}>
              <Text
                style={[
                  styles.apiDropdownIcon,
                  {
                    color: isTestnet
                      ? theme.colors.textSecondary
                      : theme.colors.text,
                  },
                ]}>
                ▼
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
      <Modal
        visible={isModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={styles.apiModalKeyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}>
          <Pressable
            style={styles.apiModalBackdrop}
            onPress={() => {
              Keyboard.dismiss();
              closeModal();
            }}>
            <Pressable
              onPress={e => {
                e.stopPropagation();
              }}>
              <Animated.View
                style={[
                  styles.apiModalContent,
                  {maxHeight: height * 0.8},
                  modalAnimatedStyle,
                ]}>
                <View
                  style={[
                    styles.apiModalHeader,
                    {borderBottomColor: theme.colors.border},
                  ]}>
                  <View style={styles.apiModalHeaderTop}>
                    <View style={styles.apiModalHeaderTitleContainer}>
                      <Image
                        source={require('../assets/api-icon.png')}
                        style={[
                          styles.apiModalHeaderIcon,
                          {tintColor: theme.colors.text}, // Use text color for better visibility in dark mode
                        ]}
                        resizeMode="contain"
                      />
                      <Text
                        style={[
                          styles.apiModalTitle,
                          {color: theme.colors.text},
                        ]}>
                        Select Mempool.Space Provider
                      </Text>
                    </View>
                    <Pressable
                      onPress={closeModal}
                      style={[
                        styles.apiModalCloseButton,
                        {backgroundColor: theme.colors.cardBackground},
                      ]}
                      android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                      <Text
                        style={[
                          styles.apiModalCloseText,
                          {color: theme.colors.text},
                        ]}>
                        ✕
                      </Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.apiModalListWrapper}>
                  {isLoadingAPIs && !isTestnet ? (
                    <View style={styles.apiModalLoading}>
                      <Text
                        style={[
                          styles.apiModalLoadingText,
                          {color: theme.colors.textSecondary},
                        ]}>
                        Loading API endpoints...
                      </Text>
                    </View>
                  ) : filteredOptions.length === 0 ? (
                    <View style={styles.apiModalEmpty}>
                      <Text
                        style={[
                          styles.apiModalEmptyText,
                          {color: theme.colors.textSecondary},
                        ]}>
                        No endpoints found
                      </Text>
                    </View>
                  ) : (
                    <FlatList
                      ref={flatListRef}
                      data={reversedOptions}
                      renderItem={renderApiItem}
                      keyExtractor={item => item}
                      ListEmptyComponent={renderListEmpty}
                      keyboardShouldPersistTaps="always"
                      keyboardDismissMode="none"
                      showsVerticalScrollIndicator={true}
                      contentContainerStyle={styles.apiModalListContent}
                      removeClippedSubviews={false}
                      initialNumToRender={10}
                      maxToRenderPerBatch={10}
                      style={styles.apiModalFlatList}
                    />
                  )}
                </View>
                <View style={styles.apiModalFooter}>
                  <View
                    style={[
                      styles.apiModalSearchContainer,
                      {
                        backgroundColor: theme.colors.cardBackground,
                        borderColor: theme.colors.border,
                      },
                    ]}>
                    <Image
                      source={require('../assets/search-icon.png')}
                      style={styles.apiModalSearchIcon}
                      resizeMode="contain"
                    />
                    <TextInput
                      ref={searchInputRef}
                      style={[
                        styles.apiModalSearchInput,
                        {color: theme.colors.text},
                      ]}
                      placeholder="Search endpoints..."
                      placeholderTextColor={theme.colors.textSecondary + '80'}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      onSubmitEditing={() => Keyboard.dismiss()}
                      blurOnSubmit={false}
                    />
                    {searchQuery.length > 0 && (
                      <Pressable
                        onPress={() => setSearchQuery('')}
                        style={styles.apiModalSearchClear}
                        android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                        <Text
                          style={[
                            styles.apiModalSearchClearText,
                            {color: theme.colors.textSecondary},
                          ]}>
                          ✕
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              </Animated.View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
};
// Helper function to get section icons
const getSectionIcon = (title: string): any => {
  switch (title.toLowerCase()) {
    case 'theme':
      return require('../assets/theme-icon.png');
    case 'network providers':
      return require('../assets/api-icon.png');
    case 'security':
      return require('../assets/backup-icon.png');
    case 'advanced':
      return require('../assets/advanced-icon.png');
    case 'about':
      return require('../assets/about-icon.png');
    case 'legal':
      return require('../assets/legal-icon.png');
    case 'haptics':
      return require('../assets/phone-icon.png');
    case 'storage':
      return require('../assets/storage-icon.png');
    case 'nostr relays':
      return require('../assets/nostr-icon.png');
    case 'app icon':
      return require('../assets/spy-icon.png');
    case 'wallet mode':
      return require('../assets/mode-icon.png');
    case 'font testing':
      return require('../assets/font-icon.png');
    case 'balance display':
      return require('../assets/numbers-icon.png');
    default:
      return require('../assets/advanced-icon.png');
  }
};
const WalletSettings: React.FC<{navigation: any}> = ({navigation}) => {
  // Use UserContext for reactive network and API state
  const {setActiveNetwork, setActiveApiProvider, setActiveAddressType, activeAddressType} = useUser();
  const [selectedIcon, setSelectedIcon] = useState<
    'default' | 'alternative' | 'loading'
  >('loading');
  const [deleteInput, setDeleteInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isModalResetVisible, setIsModalResetVisible] = useState(false);
  const [isBackupModalVisible, setIsBackupModalVisible] = useState(false);
  const [isTestnet, setIsTestnet] = useState(true);
  const [party, setParty] = useState('');
  const [baseAPI, setBaseAPI] = useState('');
  const [pendingAPI, setPendingAPI] = useState('');
  const [isAPISaving, setIsAPISaving] = useState(false);
  const [nostrRelays, setNostrRelays] = useState<string>('');
  const [pendingNostrRelays, setPendingNostrRelays] = useState<string>('');
  const [hasNostr, setHasNostr] = useState(false);
  const [isLegalModalVisible, setIsLegalModalVisible] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy'>(
    'terms',
  );
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);
  const [balanceFormattingEnabled, setBalanceFormattingEnabledState] =
    useState(false); // Default to raw numbers (not formatted)
  const [isApiInfoVisible, setIsApiInfoVisible] = useState(false);
  const [debugLoggingEnabled, setDebugLoggingEnabledState] = useState(false);
  const [devDebugEnabled, setDevDebugEnabled] = useState(false);
  // Click tracking for build number (7 clicks to enable dev mode)
  const [buildNumberClickCount, setBuildNumberClickCount] = useState(0);
  const buildNumberClickCountRef = useRef(0);
  const buildNumberClickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Collapsible states
  const [expandedSections, setExpandedSections] = useState<{
    [key: string]: boolean;
  }>({
    theme: false,
    haptics: false,
    displayFormat: false,
    backup: false,
    advanced: false,
    nostr: false,
    about: false,
    legal: false,
    storage: false,
    appIcon: false,
    devicePairing: false,
    addressType: false,
    fontTesting: false,
    devDebug: false,
  });
  const {theme, themeMode, setThemeMode} = useTheme();
  // Force re-render on Android when theme changes
  const [themeUpdateKey, setThemeUpdateKey] = useState(0);
  const [appVersion, setAppVersion] = useState('');
  const [buildNumber, setBuildNumber] = useState('');
  const [usageSize, setUsageSize] = useState<{fileCount: number; mb: string}>({
    fileCount: 0,
    mb: '0.00 MB',
  });
  const toggleSection = (section: string) => {
    // Haptic feedback for section toggle
    HapticFeedback.light();
    setExpandedSections(prev => {
      const newState = Object.keys(prev).reduce((acc, key) => {
        acc[key] = false; // Close all sections
        return acc;
      }, {} as {[key: string]: boolean});
      newState[section] = !prev[section]; // Toggle the selected section
      return newState;
    });
  };
  useEffect(() => {
    setAppVersion(DeviceInfo.getVersion());
    setBuildNumber(DeviceInfo.getBuildNumber());
    setHapticsEnabledState(areHapticsEnabled());
    LocalCache.usageSize().then(size => {
      setUsageSize(size);
    });
    // Load balance formatting preference (default to disabled - raw numbers)
    EncryptedStorage.getItem('balance_formatting_enabled')
      .then(enabled => {
        if (enabled === null || enabled === undefined) {
          // Default to false (raw numbers, not formatted)
          setBalanceFormattingEnabledState(false);
        } else {
          setBalanceFormattingEnabledState(enabled === 'true');
        }
      })
      .catch(error => {
        dbg('Error loading balance_formatting_enabled from storage:', error);
        setBalanceFormattingEnabledState(false);
      });
    // Initialize debug logging state from module-level ref
    setDebugLoggingEnabledState(isDebugLoggingEnabled());
    // Load dev debug enabled preference
    EncryptedStorage.getItem('devDebugEnabled')
      .then(enabled => {
        if (enabled === 'true') {
          setDevDebugEnabled(true);
        } else {
          setDevDebugEnabled(false);
        }
      })
      .catch(error => {
        dbg('Error loading devDebugEnabled from storage:', error);
        setDevDebugEnabled(false);
      });
    // Cleanup timeout on unmount
    return () => {
      if (buildNumberClickTimeoutRef.current) {
        clearTimeout(buildNumberClickTimeoutRef.current);
      }
      buildNumberClickCountRef.current = 0;
      setBuildNumberClickCount(0);
    };
  }, []);
  // Load saved icon preference on component mount
  useEffect(() => {
    const loadIconPreference = async () => {
      try {
        const savedIcon = await EncryptedStorage.getItem('app_icon_preference');
        if (
          savedIcon &&
          (savedIcon === 'default' || savedIcon === 'alternative')
        ) {
          setSelectedIcon(savedIcon);
        } else {
          setSelectedIcon('default');
        }
      } catch (error) {
        dbg('Error loading icon preference:', error);
        setSelectedIcon('default');
      }
    };
    loadIconPreference();
  }, []);
  useEffect(() => {
    EncryptedStorage.getItem('keyshare').then(ks => {
      try {
        if (!ks) {
          return;
        }
        const json = JSON.parse(ks as string);
        // Get keyshare label (KeyShare1/2/3) or fallback to local_party_key
        const keyshareLabel = getKeyshareLabel(json);
        setParty(keyshareLabel || json.local_party_key || '');
        // Only show Nostr settings when the keyshare contains an npub
        setHasNostr(!!json.nostr_npub);
      } catch (error) {
        dbg('Failed to parse keyshare for settings screen:', error);
      }
    });
    // Load network and corresponding cached API
    LocalCache.getItem('network').then(async net => {
      dbg('=== Loading settings for network:', net);
      setIsTestnet(net !== 'mainnet');
      // Clear any pending API changes when switching networks
      setPendingAPI('');
      // Try to get the cached API for this network
      const cachedApi = await LocalCache.getItem(`api_${net}`);
      dbg(`Cached API for ${net}:`, cachedApi);
      if (cachedApi) {
        setBaseAPI(cachedApi);
        setPendingAPI(cachedApi); // Initialize pending API to current API
        // Update the current API cache
        await LocalCache.setItem('api', cachedApi);
        // Update native module with the cached API
        if (net) {
          await BBMTLibNativeModule.setAPI(net, cachedApi);
        }
        dbg(`=== Loaded cached API for ${net}:`, cachedApi);
      } else {
        // Fallback to current API or default
        const currentApi = await LocalCache.getItem('api');
        dbg('Current API (fallback):', currentApi);
        if (currentApi) {
          setBaseAPI(currentApi);
          setPendingAPI(currentApi); // Initialize pending API to current API
          // Cache it for this network
          await LocalCache.setItem(`api_${net}`, currentApi);
          // Update native module
          if (net) {
            await BBMTLibNativeModule.setAPI(net, currentApi);
          }
          dbg(`=== Cached current API for ${net}:`, currentApi);
        } else {
          // Use default API for the network
          const defaultApi =
            net === 'mainnet'
              ? 'https://mempool.space/api'
              : 'https://mempool.space/testnet/api';
          setBaseAPI(defaultApi);
          setPendingAPI(defaultApi); // Initialize pending API to default API
          await LocalCache.setItem('api', defaultApi);
          await LocalCache.setItem(`api_${net}`, defaultApi);
          if (net) {
            await BBMTLibNativeModule.setAPI(net, defaultApi);
          }
          dbg(`=== Using default API for ${net}:`, defaultApi);
        }
      }
    });
    // Load Nostr relays (from cache if available, otherwise fetch dynamically)
    getNostrRelays(false).then(relays => {
      const relaysCSV = relays.join(',');
      setNostrRelays(relaysCSV);
      // Convert CSV to newline-separated for multiline display
      const relaysForDisplay = relaysCSV.split(',').join('\n');
      setPendingNostrRelays(relaysForDisplay);
    });
  }, []);
  const toggleNetwork = async (value: boolean) => {
    // Haptic feedback for network toggle
    HapticFeedback.light();
    dbg('=== Network toggle started:', value ? 'testnet' : 'mainnet');
    const newNetwork = value ? 'testnet3' : 'mainnet';
    const networkName = value ? 'Testnet' : 'Mainnet';
    await setActiveNetwork(newNetwork);
    dbg('Network toggle: Navigating to Wallet tab');
    navigation.reset(getResetToMainTabsWallet());
    // Show brief feedback alert after a brief delay to ensure navigation completes
    setTimeout(() => {
      // warn user if test net bitcoin is not real
      // add i understand button to the alert
      if (newNetwork === 'mainnet') {
        Alert.alert(
          `Switched to ${networkName}`,
          'Mainnet Bitcoin is the real Bitcoin. It is the main network for all Bitcoin transactions.',
          [{text: 'I understand', onPress: () => {}}],
        );
      } else {
        Alert.alert(
          `Switched to ${networkName}`,
          'Testnet Bitcoin is not real Bitcoin. It is a test network for developers to test their applications. Do not use it for real transactions.',
          [{text: 'I understand', onPress: () => {}}],
        );
      }
    }, 300);
  };
  const resetAPI = async () => {
    dbg('resetAPI called');
    const net = await LocalCache.getItem('network');
    const api =
      net === 'mainnet'
        ? 'https://mempool.space/api' // MAINNET_APIS[0]
        : 'https://mempool.space/testnet/api'; // TESTNET_APIS[0]
    dbg('Resetting to default API for network:', net, 'API:', api);
    // Clear pending API selection and set to new API
    setPendingAPI(api);
    // Update local state
    setBaseAPI(api);
    dbg('Local state updated with API:', api);
    // Cache the API setting for the current network
    if (net) {
      await LocalCache.setItem(`api_${net}`, api);
      await LocalCache.setItem('api', api);
      dbg(`API cached for network ${net}:`, api);
    }
    // Update native module
    if (net) {
      await BBMTLibNativeModule.setAPI(net, api);
    }
    dbg('Native module updated with network:', net, 'API:', api);
    // Update WalletService if it has the method
    if (WalletService.getInstance().handleNetworkChange && net) {
      await WalletService.getInstance().handleNetworkChange(net, api);
      dbg('WalletService updated with reset API');
    }
    // Update API via UserContext
    await setActiveApiProvider(api);
    dbg('API reset and propagated successfully:', api);
    // Navigate to home after reset
    navigation.reset(getResetToMainTabsWallet());
    // Show success alert after navigation
    setTimeout(() => {
      Alert.alert('Success', 'API endpoint reset to default!');
    }, 300);
  };
  const normalizeAPIUrl = (url: string): string => {
    if (!url || url.trim() === '') {
      return url;
    }
    // Trim whitespace
    let normalized = url.trim();
    // Remove trailing slashes
    normalized = normalized.replace(/\/+$/, '');
    // Check if it ends with /api (case-insensitive)
    const apiPattern = /\/api$/i;
    if (!apiPattern.test(normalized)) {
      // If it doesn't end with /api, append it
      normalized = normalized + '/api';
    }
    return normalized;
  };
  const validateAPIEndpoint = async (api: string): Promise<boolean> => {
    try {
      const testUrl = `${api.replace(/\/$/, '')}/blocks/tip/hash`;
      dbg('Testing API endpoint:', testUrl);
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
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
      // Check if response looks like a valid block hash (64 character hex string)
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
  const saveAPI = async (api: string) => {
    if (!api || api.trim() === '') {
      Alert.alert('Error', 'Please select a valid API endpoint.');
      return;
    }
    // Normalize the URL to ensure it ends with /api
    const normalizedApi = normalizeAPIUrl(api);
    dbg('Original API URL:', api);
    dbg('Normalized API URL:', normalizedApi);
    setIsAPISaving(true);
    try {
      // Validate the API endpoint first (using normalized URL)
      const isValid = await validateAPIEndpoint(normalizedApi);
      if (!isValid) {
        Alert.alert(
          'Invalid API Endpoint',
          'The selected API endpoint is not responding correctly. Please choose a different endpoint.',
        );
        return;
      }
      // Update API via UserContext (using normalized URL)
      await setActiveApiProvider(normalizedApi);
      // Update local state (using normalized URL)
      setBaseAPI(normalizedApi);
      // Reset pending API to the saved API (using normalized URL)
      setPendingAPI(normalizedApi);
      dbg('Local state updated with API:', normalizedApi);
      Alert.alert('Success', 'API endpoint updated successfully!');
      dbg('=== API saved and propagated successfully:', normalizedApi);
      // Navigate to home after successful save
      navigation.reset(getResetToMainTabsWallet());
    } catch (error) {
      dbg('Error in saveAPI:', error);
      Alert.alert('Error', 'Failed to save API endpoint. Please try again.');
    } finally {
      setIsAPISaving(false);
    }
  };
  const handleAPISelection = (api: string) => {
    // Just update the pending API selection - don't save immediately
    setPendingAPI(api);
  };
  const handleResetWallet = async () => {
    if (deleteInput.trim().toLowerCase() === 'delete my wallet') {
      try {
        setIsDeleting(true);
        setIsModalResetVisible(false);
        dbg('clearing cache storage...');
        await LocalCache.clear();
        dbg('clearing encrypted storage...');
        await EncryptedStorage.removeItem('keyshare');
        // Trigger a full app reload so all providers/contexts re‑initialize
        navigation.reset({index: 0, routes: [{name: 'Welcome'}]});
        DeviceEventEmitter.emit('app:reload');
      } catch (error) {
        dbg('handleResetWallet', error);
        Alert.alert('Error', 'Failed to reset wallet. Please try again.');
      } finally {
        setIsDeleting(false);
        setDeleteInput('');
      }
    } else {
      Alert.alert(
        'Incorrect Input',
        'You must type "delete my wallet" exactly to reset your wallet.',
      );
    }
  };
  const handleToggleHaptics = (value: boolean) => {
    HapticFeedback.light();
    setHapticsEnabledState(value);
    setHapticsEnabled(value);
  };
  const handleToggleBalanceFormatting = async (value: boolean) => {
    HapticFeedback.light();
    setBalanceFormattingEnabledState(value);
    try {
      await EncryptedStorage.setItem(
        'balance_formatting_enabled',
        value.toString(),
      );
    } catch (error) {
      dbg('Error saving balance_formatting_enabled:', error);
    }
  };
  const handleToggleDebugLogging = (value: boolean) => {
    HapticFeedback.light();
    setDebugLoggingEnabledState(value);
    // Update module-level ref
    setDebugLoggingEnabled(value);
    // Reload the app to apply the change
    DeviceEventEmitter.emit('app:reload');
  };
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.colors.background,
        },
        scrollView: {
          flex: 1,
        },
        scrollContent: {
          flexGrow: 1,
          padding: 16,
          paddingBottom: 24,
        },
        header: {
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        },
        headerTitle: {
          fontSize: theme.fontSizes?.['3xl'] || 28,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
          textAlign: 'center',
        },
        collapsibleSection: {
          marginBottom: 6,
          backgroundColor: theme.colors.cardBackground,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          overflow: 'hidden',
          shadowColor: theme.colors.shadowColor,
          shadowOffset: {width: 0, height: 1},
          shadowOpacity: 0.1,
          shadowRadius: 2,
          elevation: 2,
        },
        sectionHeader: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 12,
          backgroundColor: theme.colors.cardBackground,
        },
        sectionHeaderContent: {
          flexDirection: 'row',
          alignItems: 'center',
          flex: 1,
        },
        sectionIcon: {
          width: 20,
          height: 20,
          marginRight: 8,
          tintColor: theme.colors.text,
        },
        sectionHeaderTitle: {
          fontSize: theme.fontSizes?.lg || 16,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
        },
        expandIcon: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
        },
        sectionContent: {
          paddingHorizontal: 12,
          borderTopWidth: 1,
          borderTopColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.accent
              : theme.colors.bitcoinOrange,
        },
        toggleContainer: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          paddingHorizontal: 4,
        },
        toggleLabel: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
        },
        toggleDescription: {
          fontSize: theme.fontSizes?.base || 13,
          color: theme.colors.textSecondary,
          marginTop: 12,
          textAlign: 'center',
          marginBottom: 12,
        },
        warningContainer: {
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          marginBottom: 16,
          marginTop: 8,
        },
        warningText: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          marginBottom: 8,
          textAlign: 'center',
        },
        warningDescription: {
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: theme.fontFamilies?.regular,
          lineHeight: 18,
          textAlign: 'left',
        },
        hintText: {
          fontSize: theme.fontSizes?.base || 13,
          fontFamily: theme.fontFamilies?.regular,
          color: theme.colors.textSecondary,
          lineHeight: 18,
          textAlign: 'left' as const,
        },
        hintBold: {
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
        },
        hintAmount: {
          fontFamily: theme.fontFamilies?.monospaceBold,
          color: theme.colors.text,
        },
        hintSpacing: {
          marginBottom: 12,
        },
        appIconHintRow: {
          flexDirection: 'row',
          alignItems: 'center',
        },
        appIconSpyIcon: {
          width: 28,
          height: 28,
          marginRight: 10,
        },
        appIconHintTextContainer: {
          flex: 1,
        },
        appIconHintTitle: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
          marginBottom: 2,
        },
        appIconHintSubtitle: {
          fontSize: theme.fontSizes?.sm || 12,
          color: theme.colors.textSecondary,
          lineHeight: 16,
        },
        inputAPI: {
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 6,
          padding: 10,
          fontSize: theme.fontSizes?.base || 13,
          backgroundColor: theme.colors.background,
          color: theme.colors.text,
          marginBottom: 8,
          flex: 1,
        },
        apiAutocompleteContainer: {
          position: 'relative',
          marginBottom: 8,
        },
        apiInputContainer: {
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          backgroundColor: theme.colors.background,
          minHeight: 44,
          shadowColor: theme.colors.shadowColor,
          shadowOffset: {width: 0, height: 1},
          shadowOpacity: 0.05,
          shadowRadius: 2,
          elevation: 1,
        },
        apiInputContainerFocused: {
          borderColor: theme.colors.primary,
          shadowColor: theme.colors.primary,
          shadowOffset: {width: 0, height: 0},
          shadowOpacity: 0.2,
          shadowRadius: 4,
          elevation: 3,
        },
        apiTextInput: {
          flex: 1,
          paddingHorizontal: 12,
          paddingVertical: 12,
          fontSize: theme.fontSizes?.base || 14,
          color: theme.colors.text,
          backgroundColor: 'transparent',
        },
        apiDropdownButton: {
          paddingHorizontal: 12,
          paddingVertical: 12,
          justifyContent: 'center',
          alignItems: 'center',
          borderLeftWidth: 1,
          borderLeftColor: theme.colors.border,
        },
        apiDropdownIcon: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
        },
        apiInputRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        apiInputWithButton: {
          flex: 1,
        },
        apiSaveButton: {
          backgroundColor: theme.colors.primary,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: 8,
          minHeight: 44,
          justifyContent: 'center',
          alignItems: 'center',
          shadowColor: theme.colors.shadowColor,
          shadowOffset: {width: 0, height: 1},
          shadowOpacity: 0.1,
          shadowRadius: 2,
          elevation: 2,
        },
        apiSaveButtonDisabled: {
          backgroundColor: theme.colors.disabled,
          shadowOpacity: 0.05,
        },
        apiSaveButtonText: {
          color: theme.colors.textOnPrimary,
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          textAlign: 'center',
        },
        apiSaveButtonTextDisabled: {
          color: theme.colors.textSecondary,
        },
        apiSaveButtonContainer: {
          marginTop: 8,
          alignItems: 'flex-start',
        },
        apiNetworkInfoContainer: {
          marginTop: 8,
          marginBottom: 12,
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: theme.colors.border,
        },
        apiNetworkModeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        },
        apiNetworkModeBadge: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: 6,
          gap: 6,
          minHeight: 36,
        },
        apiNetworkModeBadgeTestnet: {
          backgroundColor: theme.colors.warning + '26', // ~15% opacity
          borderWidth: 1,
          borderColor: theme.colors.warning + '4D', // ~30% opacity
        },
        apiNetworkModeBadgeMainnet: {
          backgroundColor: theme.colors.received + '26', // ~15% opacity
          borderWidth: 1,
          borderColor: theme.colors.received + '4D', // ~30% opacity
        },
        apiNetworkModeIcon: {
          width: 16,
          height: 16,
          marginRight: 6,
        },
        apiNetworkModeText: {
          fontSize: theme.fontSizes?.base || 13,
          fontFamily: theme.fontFamilies?.bold,
          letterSpacing: 0.2,
        },
        apiNetworkModeTextTestnet: {
          color:
            theme.colors.background === '#ffffff'
              ? theme.colors.accent
              : theme.colors.text,
        },
        apiNetworkModeTextMainnet: {
          color: theme.colors.received,
        },
        apiInfoButton: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: 6,
          backgroundColor: theme.colors.background,
          borderWidth: 1,
          borderColor: theme.colors.primary,
          gap: 6,
          minHeight: 40,
        },
        apiInfoButtonIcon: {
          width: 14,
          height: 14,
          tintColor: theme.colors.text, // Use text color for better visibility in dark mode
        },
        apiInfoButtonText: {
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: theme.fontFamilies?.bold,
          color:
            theme.colors.background === '#ffffff'
              ? theme.colors.primary
              : theme.colors.text,
        },
        apiNetworkDescription: {
          fontSize: theme.fontSizes?.sm || 12,
          lineHeight: 16,
          marginTop: 4,
        },
        apiNetworkDescriptionTestnet: {
          color: theme.colors.textSecondary,
        },
        apiNetworkDescriptionMainnet: {
          color: theme.colors.textSecondary,
        },
        apiActionButtonsRow: {
          flexDirection: 'row',
          gap: 12,
          marginTop: 8,
          alignItems: 'stretch',
        },
        apiActionButton: {
          flex: 1,
          minHeight: 44,
          height: 44,
        },
        apiModalContainer: {
          flex: 1,
          justifyContent: 'flex-end',
        },
        apiModalKeyboardView: {
          flex: 1,
          justifyContent: 'flex-end',
        },
        apiModalBackdrop: {
          flex: 1,
          backgroundColor: theme.colors.modalBackdrop,
          justifyContent: 'flex-end',
        },
        apiModalContent: {
          backgroundColor: theme.colors.background,
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
          paddingBottom: Platform.OS === 'ios' ? 17 : 10,
          paddingTop: 5,
          shadowColor: theme.colors.shadowColor,
          shadowOffset: {width: 0, height: -4},
          shadowOpacity: 0.2,
          shadowRadius: 12,
          elevation: 20,
          flexDirection: 'column',
          borderTopWidth: 1,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.blackOverlay10 // Light mode: subtle dark border
              : theme.colors.whiteOverlay20, // Dark mode: subtle light border
        },
        apiModalListWrapper: {
          height: 300,
          flexShrink: 0,
        },
        apiModalFlatList: {
          flex: 1,
        },
        apiModalListContainer: {
          minHeight: 200,
          paddingBottom: 20,
        },
        apiModalHeader: {
          paddingTop: 12,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.blackOverlay10 // Light mode: subtle dark border
              : theme.colors.whiteOverlay20, // Dark mode: subtle light border
        },
        apiModalHeaderTop: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingBottom: 0,
        },
        apiModalFooter: {
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: Platform.OS === 'ios' ? 32 : 24,
        },
        apiModalTitle: {
          fontSize: theme.fontSizes?.lg || 16,
          fontFamily: theme.fontFamilies?.bold,
          letterSpacing: -0.5,
        },
        apiModalHeaderTitleContainer: {
          flexDirection: 'row',
          alignItems: 'center',
          flex: 1,
        },
        apiModalHeaderIcon: {
          width: 20,
          height: 20,
          marginRight: 10,
        },
        apiModalCloseButton: {
          width: 32,
          height: 32,
          borderRadius: 16,
          justifyContent: 'center',
          alignItems: 'center',
        },
        apiModalCloseText: {
          fontSize: theme.fontSizes?.xl || 18,
          fontFamily: theme.fontFamilies?.bold,
        },
        apiModalSearchContainer: {
          flexDirection: 'row',
          alignItems: 'center',
          marginHorizontal: 16,
          marginTop: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 12,
          borderWidth: 1,
        },
        apiModalSearchIcon: {
          width: 16,
          height: 16,
          marginRight: 8,
          tintColor: theme.colors.text,
        },
        apiModalSearchInput: {
          flex: 1,
          fontSize: theme.fontSizes?.md || 15,
          padding: 0,
          margin: 0,
        },
        apiModalSearchClear: {
          padding: 4,
          marginLeft: 8,
        },
        apiModalSearchClearText: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
        },
        apiModalListContent: {
          paddingTop: 4,
          paddingBottom: 4,
        },
        apiModalItem: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 14,
          marginHorizontal: 16,
          marginVertical: 0,
          borderRadius: 0,
          borderBottomWidth: StyleSheet.hairlineWidth,
          minHeight: 56,
        },
        apiModalItemSelected: {
          backgroundColor: theme.colors.cardBackground,
        },
        apiModalItemIcon: {
          width: 18,
          height: 18,
          marginRight: 12,
          tintColor: theme.colors.text,
        },
        apiModalItemText: {
          flex: 1,
          fontSize: theme.fontSizes?.md || 15,
          lineHeight: 20,
          letterSpacing: -0.2,
        },
        apiModalItemTextSelected: {
          fontFamily: theme.fontFamilies?.bold,
        },
        apiModalItemCheckContainer: {
          width: 24,
          height: 24,
          borderRadius: 12,
          justifyContent: 'center',
          alignItems: 'center',
          marginLeft: 8,
        },
        apiModalItemCheck: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.white,
        },
        apiModalLoading: {
          padding: 48,
          alignItems: 'center',
        },
        apiModalLoadingText: {
          fontSize: theme.fontSizes?.base || 14,
          fontStyle: 'italic',
        },
        apiModalEmpty: {
          padding: 48,
          alignItems: 'center',
        },
        apiModalEmptyText: {
          fontSize: theme.fontSizes?.base || 14,
          fontStyle: 'italic',
        },
        button: {
          paddingVertical: 10,
          borderRadius: 6,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 6,
        },
        deleteButton: {
          backgroundColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.accent
              : theme.colors.bitcoinOrange,
        },
        backupButton: {
          backgroundColor: theme.colors.primary,
          marginBottom: 16, // Add spacing after backup button before delete section
        },
        resetButton: {
          backgroundColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.accent
              : theme.colors.bitcoinOrange,
        },
        buttonText: {
          color: theme.colors.textOnPrimary,
          fontSize: theme.fontSizes?.lg || 16,
          fontFamily: theme.fontFamilies?.bold,
          textAlign: 'center',
        },
        apiItem: {
          marginTop: 0, // Section padding handles first element spacing
          marginBottom: 0, // Consistent spacing
        },
        apiName: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text, // Use text color for better readability in dark mode
          marginBottom: 4,
        },
        apiDescription: {
          fontSize: theme.fontSizes?.base || 14,
          color: theme.colors.textSecondary,
          lineHeight: 20,
          marginBottom: 6,
        },
        linkText: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text, // Use text color for better readability in dark mode
          textDecorationLine: 'underline',
          textDecorationColor: theme.colors.text, // Match underline color
        },
        aboutInfoRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingVertical: 12,
          paddingHorizontal: 4,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        aboutLabel: {
          fontSize: theme.fontSizes?.md || 15,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
          letterSpacing: -0.2,
        },
        aboutValue: {
          fontSize: theme.fontSizes?.md || 15,
          fontFamily: theme.fontFamilies?.medium,
          color: theme.colors.textSecondary,
          letterSpacing: -0.2,
        },
        buildNumberContainer: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        },
        buildNumberBadge: {
          minWidth: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.primary
              : theme.colors.bitcoinOrange,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 8,
        },
        buildNumberBadgeText: {
          fontSize: theme.fontSizes?.xs || 11,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.white,
        },
        debugLoggingCard: {
          backgroundColor: theme.colors.cardBackground,
          borderRadius: 12,
          padding: 16,
          marginTop: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        debugLoggingHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        },
        debugLoggingTitle: {
          fontSize: theme.fontSizes?.md || 15,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
        },
        debugLoggingStatus: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        },
        debugLoggingStatusDot: {
          width: 8,
          height: 8,
          borderRadius: 4,
        },
        debugLoggingStatusText: {
          fontSize: theme.fontSizes?.xs || 11,
          fontFamily: theme.fontFamilies?.medium,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
        disableDevModeButton: {
          backgroundColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.accent
              : theme.colors.bitcoinOrange,
          borderRadius: 12,
          paddingVertical: 14,
          paddingHorizontal: 20,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          marginTop: 20,
          shadowColor: theme.colors.danger,
          shadowOffset: {width: 0, height: 2},
          shadowOpacity: 0.2,
          shadowRadius: 4,
          elevation: 3,
        },
        disableDevModeButtonText: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.white,
        },
        aboutSection: {
          marginTop: 20,
          padding: 16,
          backgroundColor: theme.colors.cardBackground,
          borderRadius: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        aboutSectionHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 10,
        },
        aboutSectionIcon: {
          width: 20,
          height: 20,
          marginRight: 10,
          tintColor: theme.colors.text,
        },
        aboutSectionTitle: {
          fontSize: theme.fontSizes?.lg || 16,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
          letterSpacing: -0.3,
        },
        aboutSectionDescription: {
          fontSize: theme.fontSizes?.base || 14,
          color: theme.colors.textSecondary,
          lineHeight: 22,
          letterSpacing: -0.1,
        },
        aboutLinkText: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text, // Use text color for better readability in dark mode
          textDecorationLine: 'underline',
          textDecorationColor: theme.colors.text, // Match underline color
        },
        termsLink: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text, // Use text color for better readability in dark mode
          textDecorationLine: 'underline',
          textDecorationColor: theme.colors.text, // Match underline color
          marginTop: 8,
        },
        modalOverlay: {
          flex: 1,
          backgroundColor: theme.colors.modalBackdrop,
          alignItems: 'center',
          justifyContent: 'center',
        },
        modalContent: {
          backgroundColor: theme.colors.background,
          padding: 20,
          borderRadius: 8,
          width: '80%',
          borderWidth: 1,
          borderColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.blackOverlay10 // Light mode: subtle dark border
              : theme.colors.whiteOverlay20, // Dark mode: subtle light border
        },
        modalHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        },
        modalIcon: {
          width: 24,
          height: 24,
          marginRight: 10,
          tintColor: theme.colors.text, // Use text color for better visibility in dark mode
        },
        modalTitle: {
          fontSize: theme.fontSizes?.['2xl'] || 20,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
        },
        modalDescription: {
          fontSize: theme.fontSizes?.base || 14,
          color: theme.colors.textSecondary,
          marginBottom: 20,
          textAlign: 'center',
        },
        passwordContainer: {
          marginBottom: 12,
        },
        passwordLabel: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
          marginBottom: 4,
        },
        passwordInputContainer: {
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 6,
        },
        passwordInput: {
          flex: 1,
          padding: 10,
          fontSize: theme.fontSizes?.base || 13,
          color: theme.colors.text,
        },
        eyeButton: {
          padding: 10,
        },
        eyeIcon: {
          width: 20,
          height: 20,
          tintColor: theme.colors.text,
        },
        passwordHint: {
          fontSize: theme.fontSizes?.sm || 12,
          color: theme.colors.textSecondary,
        },
        modalActions: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 20,
          gap: 12,
        },
        modalButton: {
          flex: 1,
          paddingVertical: 14,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
        },
        cancelButton: {
          backgroundColor: theme.colors.secondary,
        },
        cancelButtonText: {
          color:
            theme.colors.background === '#ffffff'
              ? theme.colors.white
              : theme.colors.text,
          fontSize: theme.fontSizes?.lg || 16,
          fontFamily: theme.fontFamilies?.bold,
          textAlign: 'center',
        },
        confirmButton: {
          backgroundColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.accent
              : theme.colors.bitcoinOrange,
        },
        confirmButtonText: {
          color: theme.colors.white,
          fontSize: theme.fontSizes?.lg || 16,
          fontFamily: theme.fontFamilies?.bold,
          textAlign: 'center',
        },
        disabledButton: {
          backgroundColor: theme.colors.disabled,
        },
        disabledButtonText: {
          color: theme.colors.disabledText || theme.colors.textSecondary,
          fontSize: theme.fontSizes?.lg || 16,
          fontFamily: theme.fontFamilies?.bold,
          textAlign: 'center',
        },
        apiInfoModalContent: {
          backgroundColor: theme.colors.background,
          borderRadius: 16,
          width: '85%',
          maxWidth: 400,
          shadowColor: theme.colors.shadowColor,
          shadowOffset: {width: 0, height: 4},
          shadowOpacity: 0.3,
          shadowRadius: 12,
          elevation: 20,
          borderWidth: 1,
          borderColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.blackOverlay10 // Light mode: subtle dark border
              : theme.colors.whiteOverlay20, // Dark mode: subtle light border
        },
        apiInfoModalHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: 16,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        apiInfoModalIconContainer: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.colors.cardBackground,
          justifyContent: 'center',
          alignItems: 'center',
        },
        apiInfoModalIcon: {
          width: 20,
          height: 20,
          tintColor: theme.colors.text,
        },
        apiInfoModalTitle: {
          flex: 1,
          fontSize: theme.fontSizes?.xl || 18,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
          marginLeft: 12,
          letterSpacing: -0.3,
        },
        apiInfoModalCloseButton: {
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: theme.colors.cardBackground,
          justifyContent: 'center',
          alignItems: 'center',
        },
        apiInfoModalCloseText: {
          fontSize: theme.fontSizes?.xl || 18,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.textSecondary,
        },
        apiInfoModalBody: {
          padding: 20,
        },
        apiInfoSection: {
          marginBottom: 20,
        },
        apiInfoSectionRow: {
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 8,
        },
        apiInfoSectionIcon: {
          width: 20,
          height: 20,
          marginRight: 10,
          tintColor: theme.colors.text,
        },
        apiInfoSectionTitle: {
          fontSize: theme.fontSizes?.lg || 16,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
          letterSpacing: -0.2,
        },
        apiInfoSectionText: {
          fontSize: theme.fontSizes?.base || 14,
          color: theme.colors.textSecondary,
          lineHeight: 22,
          letterSpacing: -0.1,
          marginLeft: 30,
        },
        apiInfoModalButton: {
          marginHorizontal: 20,
          marginBottom: 20,
          paddingVertical: 14,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
        },
        apiInfoModalButtonText: {
          fontSize: theme.fontSizes?.lg || 16,
          fontFamily: theme.fontFamilies?.bold,
          letterSpacing: -0.2,
          textAlign: 'center',
        },
        networkOption: {
          flexDirection: 'row',
          alignItems: 'center',
        },
        networkIcon: {
          width: 20,
          height: 20,
          marginRight: 8,
          tintColor: theme.colors.text, // Use text color for visibility in dark mode
        },
        input: {
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          padding: 14,
          marginBottom: 16,
          textAlign: 'center',
          fontSize: theme.fontSizes?.lg || 16,
          color: theme.colors.text,
          backgroundColor: theme.colors.cardBackground,
        },
        halfOpacity: {
          opacity: 0.5,
        },
        strengthContainer: {
          flexDirection: 'row',
          alignItems: 'center',
          marginTop: 8,
          marginBottom: 8,
        },
        strengthBar: {
          flex: 1,
          height: 8,
          backgroundColor: theme.colors.border,
          borderRadius: 4,
          marginRight: 12,
          overflow: 'hidden',
        },
        strengthFill: {
          height: '100%',
          borderRadius: 4,
        },
        strengthText: {
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: theme.fontFamilies?.bold,
          minWidth: 60,
          textAlign: 'right',
          color: theme.colors.textSecondary,
        },
        requirementsContainer: {
          marginTop: 4,
        },
        requirementText: {
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: theme.fontFamilies?.medium,
          color: theme.colors.warningAccent,
        },
        nostrRelaysInput: {
          minHeight: 120,
          textAlignVertical: 'top',
          textAlign: 'left', // Align text entries to the left
          paddingTop: 12,
          backgroundColor: theme.colors.cardBackground,
        },
        errorInput: {
          borderColor: theme.colors.danger,
        },
        errorText: {
          color: theme.colors.danger,
          fontSize: theme.fontSizes?.sm || 12,
          marginTop: 4,
        },
        buttonContent: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        },
        buttonIcon: {
          width: 20,
          height: 20,
          marginRight: 12,
          tintColor: theme.colors.white,
        },
        buttonIconOnColored: {
          width: 20,
          height: 20,
          marginRight: 12,
          tintColor: theme.colors.white,
        },
        buttonIconOnSecondary: {
          width: 20,
          height: 20,
          marginRight: 12,
          tintColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.white
              : theme.colors.text,
        },
        flexContainer: {
          flex: 1,
        },
        whiteTint: {
          tintColor: theme.colors.white,
        },
        networkStatusContainer: {
          marginBottom: 8,
        },
        networkStatusTitle: {
          fontSize: theme.fontSizes?.sm || 12,
          marginBottom: 2,
        },
        networkStatusText: {
          fontSize: theme.fontSizes?.sm || 12,
        },
        appIconCheckStatesButton: {
          marginBottom: 10,
          backgroundColor: theme.colors.secondary,
        },
        walletModeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          paddingHorizontal: 4,
        },
        walletModeLabel: {
          fontSize: theme.fontSizes?.base || 14,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
        },
        walletModeDescription: {
          fontSize: theme.fontSizes?.base || 13,
          color: theme.colors.textSecondary,
          marginBottom: 12,
        },
        addressTypeOptionsContainer: {
          gap: 8,
        },
        addressTypeOption: {
          flexDirection: 'row',
          alignItems: 'center',
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.background,
          gap: 10,
        },
        addressTypeOptionSelected: {
          borderColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.accent
              : theme.colors.bitcoinOrange,
          borderWidth: 2,
          backgroundColor: theme.colors.cardBackground,
        },
        addressTypeCheckIcon: {
          width: 20,
          height: 20,
          marginLeft: 'auto',
          tintColor: theme.colors.primary,
        },
        themeOptionContainer: {
          gap: 8,
          marginBottom: 8,
        },
        themeOption: {
          backgroundColor: theme.colors.background,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: 12,
          marginBottom: 4,
        },
        themeOptionSelected: {
          borderColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.accent
              : theme.colors.bitcoinOrange,
          borderWidth: 2,
          backgroundColor: theme.colors.cardBackground,
        },
        themeOptionContent: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        themeOptionLabel: {
          fontSize: theme.fontSizes?.md || 15,
          fontFamily: theme.fontFamilies?.medium,
          color: theme.colors.text,
        },
        themeOptionLabelSelected: {
          fontFamily: theme.fontFamilies?.bold,
          color:
            theme.colors.background === '#ffffff'
              ? theme.colors.accent
              : theme.colors.bitcoinOrange,
        },
        themeOptionCheck: {
          width: 18,
          height: 18,
          tintColor:
            theme.colors.background === '#ffffff'
              ? theme.colors.accent
              : theme.colors.bitcoinOrange,
        },
      }),
    [theme],
  );
  // Force re-render on Android when theme changes
  useEffect(() => {
    setThemeUpdateKey(prev => prev + 1);
  }, [theme.colors.background, themeMode]);
  return (
    <SafeAreaView
      style={styles.container}
      edges={['left', 'right']}
      key={themeUpdateKey}>
      <ScrollView
        key={themeUpdateKey}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled={true}
        bounces={true}
        scrollEventThrottle={16}>
        {/* Theme Section - First for better UX */}
        <CollapsibleSection
          title="Theme"
          isExpanded={expandedSections.theme}
          onToggle={() => toggleSection('theme')}
          styles={styles}
          theme={theme}>
          <Text style={styles.toggleDescription}>
            Choose your preferred color theme. OS Default follows your system
            settings.
          </Text>
          <View style={styles.themeOptionContainer}>
            <Pressable
              style={[
                styles.themeOption,
                themeMode === 'os' && styles.themeOptionSelected,
              ]}
              onPress={() => {
                HapticFeedback.light();
                setThemeMode('os');
              }}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <View style={styles.themeOptionContent}>
                <Text
                  style={[
                    styles.themeOptionLabel,
                    themeMode === 'os' && styles.themeOptionLabelSelected,
                  ]}>
                  OS Default
                </Text>
                {themeMode === 'os' && (
                  <Image
                    source={require('../assets/check-icon.png')}
                    style={styles.themeOptionCheck}
                    resizeMode="contain"
                  />
                )}
              </View>
            </Pressable>
            <Pressable
              style={[
                styles.themeOption,
                themeMode === 'light' && styles.themeOptionSelected,
              ]}
              onPress={() => {
                HapticFeedback.light();
                setThemeMode('light');
              }}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <View style={styles.themeOptionContent}>
                <Text
                  style={[
                    styles.themeOptionLabel,
                    themeMode === 'light' && styles.themeOptionLabelSelected,
                  ]}>
                  Light
                </Text>
                {themeMode === 'light' && (
                  <Image
                    source={require('../assets/check-icon.png')}
                    style={styles.themeOptionCheck}
                    resizeMode="contain"
                  />
                )}
              </View>
            </Pressable>
            <Pressable
              style={[
                styles.themeOption,
                themeMode === 'dark' && styles.themeOptionSelected,
              ]}
              onPress={() => {
                HapticFeedback.light();
                setThemeMode('dark');
              }}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <View style={styles.themeOptionContent}>
                <Text
                  style={[
                    styles.themeOptionLabel,
                    themeMode === 'dark' && styles.themeOptionLabelSelected,
                  ]}>
                  Dark
                </Text>
                {themeMode === 'dark' && (
                  <Image
                    source={require('../assets/check-icon.png')}
                    style={styles.themeOptionCheck}
                    resizeMode="contain"
                  />
                )}
              </View>
            </Pressable>
          </View>
        </CollapsibleSection>
        {/* Haptics Section */}
        <CollapsibleSection
          title="Haptics"
          isExpanded={expandedSections.haptics}
          onToggle={() => toggleSection('haptics')}
          styles={styles}
          theme={theme}>
          <Text style={styles.toggleDescription}>
            Enable vibration feedback. OS settings may override this.
          </Text>
          <View style={styles.toggleContainer}>
            <Text style={styles.toggleLabel}>Haptics Off</Text>
            <Switch
              onValueChange={handleToggleHaptics}
              value={hapticsEnabled}
              trackColor={{
                false: theme.colors.switchTrackFalse,
                true: theme.colors.switchTrackTrue,
              }}
              thumbColor={theme.colors.switchThumb}
              ios_backgroundColor={theme.colors.switchIosBackground}
            />
            <Text style={styles.toggleLabel}>Haptics On</Text>
          </View>
        </CollapsibleSection>
        {/* Display Format Section */}
        <CollapsibleSection
          title="Balance Display"
          isExpanded={expandedSections.displayFormat}
          onToggle={() => toggleSection('displayFormat')}
          styles={styles}
          theme={theme}>
          <Text style={styles.hintText}>
            Bitcoin uses <Text style={styles.hintBold}>8 decimal places</Text>{' '}
            for full accuracy.
          </Text>

          <Text style={[styles.hintText, styles.hintSpacing]}>
            <Text style={styles.hintAmount}>1 BTC</Text> ={' '}
            <Text style={styles.hintAmount}>100,000,000 satoshis (sats)</Text>
          </Text>

          <Text style={[styles.hintText, styles.hintSpacing]}>
            You can choose how your balance is shown:
          </Text>

          <Text style={[styles.hintText, styles.hintSpacing]}>
            <Text style={styles.hintBold}>Formatted:</Text> Thousand separators
            make large numbers easier to read and verify decimal precision.
            Example: <Text style={styles.hintAmount}>1,234.56,789,010 ₿</Text>{' '}
            or <Text style={styles.hintAmount}>123,456,789,010 sats</Text>
          </Text>

          <Text style={[styles.hintText, styles.hintSpacing]}>
            <Text style={styles.hintBold}>Raw Numbers:</Text> Exact values
            without separators. Example:{' '}
            <Text style={styles.hintAmount}>1234.56789 ₿</Text> or{' '}
            <Text style={styles.hintAmount}>123456789000 sats</Text>
          </Text>
          <View style={styles.toggleContainer}>
            <Text style={styles.toggleLabel}>Raw Numbers</Text>
            <Switch
              onValueChange={handleToggleBalanceFormatting}
              value={balanceFormattingEnabled}
              trackColor={{
                false: theme.colors.switchTrackFalse,
                true: theme.colors.switchTrackTrue,
              }}
              thumbColor={theme.colors.switchThumb}
              ios_backgroundColor={theme.colors.switchIosBackground}
            />
            <Text style={styles.toggleLabel}>Formatted</Text>
          </View>
        </CollapsibleSection>
        {/* App Icon Section - Android Only */}
        {Platform.OS === 'android' && (
          <CollapsibleSection
            title="App Icon"
            isExpanded={expandedSections.appIcon}
            onToggle={() => toggleSection('appIcon')}
            styles={styles}
            theme={theme}>
            <View style={styles.appIconHintRow}>
              <View style={styles.appIconHintTextContainer}>
                <Text style={styles.appIconHintTitle}>
                  Blend in when you need to.
                </Text>
                <Text style={styles.appIconHintSubtitle}>
                  Switch to the calculator icon when you want your wallet to
                  look like just another app on your home screen.
                </Text>
              </View>
            </View>
            <Text style={styles.toggleDescription}>
              Change the app's launcher icon on your device.
            </Text>
            <View style={styles.toggleContainer}>
              <Text style={styles.toggleLabel}>Bold Wallet</Text>
              <Switch
                value={selectedIcon === 'alternative'}
                trackColor={{
                  false: theme.colors.switchTrackFalse,
                  true: theme.colors.switchTrackTrue,
                }}
                thumbColor={theme.colors.switchThumb}
                ios_backgroundColor={theme.colors.switchIosBackground}
                onValueChange={async value => {
                  try {
                    HapticFeedback.light();
                    const newIcon = value ? 'alternative' : 'default';
                    // Check if IconChanger module is available
                    if (!IconChanger || !IconChanger.changeIcon) {
                      Alert.alert(
                        'Error',
                        'Icon switching is not available on this device.',
                        [{text: 'OK'}],
                      );
                      return;
                    }
                    // Update UI state
                    setSelectedIcon(newIcon);
                    // Save preference
                    await EncryptedStorage.setItem(
                      'app_icon_preference',
                      newIcon,
                    );
                    // Change the icon
                    await IconChanger.changeIcon(newIcon);
                    // Show success message
                    const iconName =
                      newIcon === 'alternative' ? 'QuickCalc' : 'Bold Wallet';
                    Alert.alert(
                      'Icon Changed',
                      `App icon switched to ${iconName}.\n\nYou may need to refresh your launcher to see the change.`,
                      [{text: 'OK'}],
                    );
                  } catch (error: any) {
                    dbg('Error changing icon:', error);
                    // Revert UI state on error
                    setSelectedIcon(value ? 'default' : 'alternative');
                    Alert.alert(
                      'Error',
                      error?.message ||
                        'Failed to change app icon. Please try again.',
                      [{text: 'OK'}],
                    );
                  }
                }}
                disabled={selectedIcon === 'loading'}
              />
              <Text style={styles.toggleLabel}>QuickCalc</Text>
            </View>
          </CollapsibleSection>
        )}
        {/* Address Type Section */}
        <CollapsibleSection
          title="Address Type"
          isExpanded={expandedSections.addressType}
          onToggle={() => toggleSection('addressType')}
          styles={styles}
          theme={theme}>
          <Text style={styles.walletModeDescription}>
            Choose the receive address format. Native SegWit (bech32) is
            recommended. Changing this updates your receive address on the
            Wallet tab.
          </Text>
          <View style={styles.addressTypeOptionsContainer}>
            <Pressable
              style={[
                styles.addressTypeOption,
                activeAddressType === 'legacy' && styles.addressTypeOptionSelected,
              ]}
              onPress={async () => {
                HapticFeedback.selection();
                try {
                  await setActiveAddressType('legacy');
                  navigation.reset(getResetToMainTabsWallet());
                } catch (e) {
                  dbg('Error setting address type:', e);
                }
              }}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Image
                source={require('../assets/bricks-icon.png')}
                style={styles.networkIcon}
                resizeMode="contain"
              />
              <Text style={styles.toggleLabel}>Legacy (P2PKH)</Text>
              {activeAddressType === 'legacy' && (
                <Image
                  source={require('../assets/check-icon.png')}
                  style={styles.addressTypeCheckIcon}
                  resizeMode="contain"
                />
              )}
            </Pressable>
            <Pressable
              style={[
                styles.addressTypeOption,
                activeAddressType === 'segwit-native' && styles.addressTypeOptionSelected,
              ]}
              onPress={async () => {
                HapticFeedback.selection();
                try {
                  await setActiveAddressType('segwit-native');
                  navigation.reset(getResetToMainTabsWallet());
                } catch (e) {
                  dbg('Error setting address type:', e);
                }
              }}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Image
                source={require('../assets/dna-icon.png')}
                style={styles.networkIcon}
                resizeMode="contain"
              />
              <Text style={styles.toggleLabel}>Native SegWit (bech32)</Text>
              {activeAddressType === 'segwit-native' && (
                <Image
                  source={require('../assets/check-icon.png')}
                  style={styles.addressTypeCheckIcon}
                  resizeMode="contain"
                />
              )}
            </Pressable>
            <Pressable
              style={[
                styles.addressTypeOption,
                activeAddressType === 'segwit-compatible' && styles.addressTypeOptionSelected,
              ]}
              onPress={async () => {
                HapticFeedback.selection();
                try {
                  await setActiveAddressType('segwit-compatible');
                  navigation.reset(getResetToMainTabsWallet());
                } catch (e) {
                  dbg('Error setting address type:', e);
                }
              }}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Image
                source={require('../assets/recycle-icon.png')}
                style={styles.networkIcon}
                resizeMode="contain"
              />
              <Text style={styles.toggleLabel}>Nested SegWit (P2SH-WPKH)</Text>
              {activeAddressType === 'segwit-compatible' && (
                <Image
                  source={require('../assets/check-icon.png')}
                  style={styles.addressTypeCheckIcon}
                  resizeMode="contain"
                />
              )}
            </Pressable>
          </View>
        </CollapsibleSection>
        {/* Security Section */}
        <CollapsibleSection
          title="Security"
          isExpanded={expandedSections.backup}
          onToggle={() => toggleSection('backup')}
          styles={styles}
          theme={theme}>
          <Text style={styles.apiName}>Backup Wallet Keyshare</Text>
          <Pressable
            style={[styles.button, styles.backupButton]}
            onPress={() => {
              HapticFeedback.light();
              setIsBackupModalVisible(true);
            }}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <View style={styles.buttonContent}>
              <Image
                source={require('../assets/upload-icon.png')}
                style={[styles.buttonIcon, styles.whiteTint]}
                resizeMode="contain"
              />
              <Text style={styles.buttonText}>Backup {party}</Text>
            </View>
          </Pressable>
          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Delete Wallet Keyshare</Text>
          </View>
          <Pressable
            style={[styles.button, styles.deleteButton]}
            onPress={() => {
              HapticFeedback.light();
              setIsModalResetVisible(true);
            }}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <View style={styles.buttonContent}>
              <Image
                source={require('../assets/delete-icon.png')}
                style={[styles.buttonIcon, styles.whiteTint]}
                resizeMode="contain"
              />
              <Text style={styles.buttonText}>Delete {party}</Text>
            </View>
          </Pressable>
        </CollapsibleSection>
        {/* Network Providers Section */}
        <CollapsibleSection
          title="Network Providers"
          isExpanded={expandedSections.advanced}
          onToggle={() => toggleSection('advanced')}
          styles={styles}
          theme={theme}>
          {/* Network Settings */}
          <View style={styles.toggleContainer}>
            <View style={styles.networkOption}>
              <Image
                source={require('../assets/mainnet-icon.png')}
                style={styles.networkIcon}
                resizeMode="contain"
              />
              <Text style={styles.toggleLabel}>Mainnet</Text>
            </View>
            <Switch
              onValueChange={toggleNetwork}
              value={isTestnet}
              trackColor={{
                false: theme.colors.switchTrackFalse,
                true: theme.colors.switchTrackTrue,
              }}
              thumbColor={theme.colors.switchThumb}
              ios_backgroundColor={theme.colors.switchIosBackground}
            />
            <View style={styles.networkOption}>
              <Image
                source={require('../assets/testnet-icon.png')}
                style={styles.networkIcon}
                resizeMode="contain"
              />
              <Text style={styles.toggleLabel}>Testnet3</Text>
            </View>
          </View>
          {/* Network mode indicator and info */}
          <View style={styles.apiNetworkInfoContainer}>
            <View style={styles.apiNetworkModeRow}>
              <View
                style={[
                  styles.apiNetworkModeBadge,
                  isTestnet
                    ? styles.apiNetworkModeBadgeTestnet
                    : styles.apiNetworkModeBadgeMainnet,
                ]}>
                <Image
                  source={
                    isTestnet
                      ? require('../assets/locker-icon.png')
                      : require('../assets/privacy-icon.png')
                  }
                  style={[
                    styles.apiNetworkModeIcon,
                    {
                      tintColor: isTestnet
                        ? theme.colors.background === '#ffffff'
                          ? theme.colors.accent
                          : theme.colors.bitcoinOrange
                        : theme.colors.received,
                    },
                  ]}
                  resizeMode="contain"
                />
                <Text
                  style={[
                    styles.apiNetworkModeText,
                    isTestnet
                      ? styles.apiNetworkModeTextTestnet
                      : styles.apiNetworkModeTextMainnet,
                  ]}>
                  {isTestnet ? 'Testnet Mode' : 'Mainnet Mode'}
                </Text>
              </View>
              {!isTestnet && (
                <Pressable
                  style={styles.apiInfoButton}
                  onPress={() => {
                    HapticFeedback.light();
                    setIsApiInfoVisible(true);
                  }}
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <Image
                    source={require('../assets/about-icon.png')}
                    style={styles.apiInfoButtonIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.apiInfoButtonText}>Change Provider?</Text>
                </Pressable>
              )}
            </View>
            <Text
              style={[
                styles.apiNetworkDescription,
                isTestnet
                  ? styles.apiNetworkDescriptionTestnet
                  : styles.apiNetworkDescriptionMainnet,
              ]}>
              {isTestnet
                ? 'Testnet Provider is restricted to mempool.space/testnet'
                : 'Mainnet Providers are customizable.'}
            </Text>
          </View>
          <APIAutocomplete
            value={pendingAPI || baseAPI}
            onChangeText={handleAPISelection}
            isTestnet={isTestnet}
            styles={styles}
            theme={theme}
          />
          {/* Action buttons side by side */}
          <View style={styles.apiActionButtonsRow}>
            {/* Test & Save button - always show in mainnet, disabled when no changes */}
            {!isTestnet && (
              <Pressable
                style={[
                  styles.button,
                  styles.backupButton,
                  styles.apiActionButton,
                  (isAPISaving || !pendingAPI || pendingAPI === baseAPI) &&
                    styles.disabledButton,
                  isAPISaving && styles.halfOpacity,
                ]}
                onPress={() => {
                  HapticFeedback.light();
                  saveAPI(pendingAPI);
                }}
                disabled={isAPISaving || !pendingAPI || pendingAPI === baseAPI}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <View style={styles.buttonContent}>
                  <Image
                    source={require('../assets/check-icon.png')}
                    style={[styles.buttonIcon, styles.whiteTint]}
                    resizeMode="contain"
                  />
                  <Text
                    style={[
                      styles.buttonText,
                      (isAPISaving || !pendingAPI || pendingAPI === baseAPI) &&
                        styles.disabledButtonText,
                    ]}>
                    {isAPISaving ? 'Verifying...' : 'Verify & Save'}
                  </Text>
                </View>
              </Pressable>
            )}
            {/* Reset Default API button - only show in mainnet */}
            {!isTestnet && (
              <Pressable
                style={[
                  styles.button,
                  styles.resetButton,
                  styles.apiActionButton,
                ]}
                onPress={() => {
                  HapticFeedback.light();
                  resetAPI();
                }}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <View style={styles.buttonContent}>
                  <Image
                    source={require('../assets/refresh-icon.png')}
                    style={[styles.buttonIcon, styles.whiteTint]}
                    resizeMode="contain"
                  />
                  <Text style={styles.buttonText}>Defaults</Text>
                </View>
              </Pressable>
            )}
          </View>
        </CollapsibleSection>
        {/* Nostr Relays Section - only show when keyshare has an npub */}
        {hasNostr && (
          <CollapsibleSection
            title="Nostr Relays"
            isExpanded={expandedSections.nostr}
            onToggle={() => toggleSection('nostr')}
            styles={styles}
            theme={theme}>
            <View style={styles.apiItem}>
              <Text style={styles.apiName}>Nostr Relay Configuration</Text>
              <Text style={styles.apiDescription}>
                Configure Nostr relays for device pairing and transaction
                signing. Enter relay URLs, one per line or comma-separated
                (wss://...).
              </Text>
            </View>
            <TextInput
              style={[styles.input, styles.nostrRelaysInput]}
              value={pendingNostrRelays}
              onChangeText={setPendingNostrRelays}
              placeholder={
                'wss://relay1.com\nwss://relay2.com\nwss://relay3.com'
              }
              placeholderTextColor={theme.colors.textSecondary + '80'}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              numberOfLines={6}
            />
            <View style={styles.apiActionButtonsRow}>
              <Pressable
                style={[
                  styles.button,
                  styles.backupButton,
                  styles.apiActionButton,
                  (!pendingNostrRelays || pendingNostrRelays === nostrRelays) &&
                    styles.disabledButton,
                ]}
                onPress={async () => {
                  HapticFeedback.light();
                  try {
                    // Parse relays - support both newline and comma separation
                    const relays = pendingNostrRelays
                      .split(/[,\n]/)
                      .map(r => r.trim())
                      .filter(Boolean);
                    if (relays.length === 0) {
                      Alert.alert(
                        'Error',
                        'Please enter at least one relay URL',
                      );
                      return;
                    }
                    // Basic validation - check if starts with wss:// or ws://
                    const invalid = relays.find(
                      r => !r.startsWith('wss://') && !r.startsWith('ws://'),
                    );
                    if (invalid) {
                      Alert.alert(
                        'Error',
                        `Invalid relay URL: ${invalid}\nRelay URLs must start with wss:// or ws://`,
                      );
                      return;
                    }
                    // Convert to CSV format for storage
                    const relaysCSV = relays.join(',');
                    // Save to cache as CSV
                    await LocalCache.setItem('nostr_relays', relaysCSV);
                    setNostrRelays(relaysCSV);
                    Alert.alert('Success', 'Nostr relays saved successfully!');
                  } catch (error) {
                    dbg('Error saving Nostr relays:', error);
                    Alert.alert('Error', 'Failed to save Nostr relays');
                  }
                }}
                disabled={
                  !pendingNostrRelays || pendingNostrRelays === nostrRelays
                }
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <View style={styles.buttonContent}>
                  <Image
                    source={require('../assets/check-icon.png')}
                    style={[styles.buttonIcon, styles.whiteTint]}
                    resizeMode="contain"
                  />
                  <Text
                    style={[
                      styles.buttonText,
                      (!pendingNostrRelays ||
                        pendingNostrRelays === nostrRelays) &&
                        styles.disabledButtonText,
                    ]}>
                    Save Relays
                  </Text>
                </View>
              </Pressable>
              <Pressable
                style={[
                  styles.button,
                  styles.resetButton,
                  styles.apiActionButton,
                ]}
                onPress={async () => {
                  HapticFeedback.light();
                  // Fetch dynamic relays (force fetch, same as first time)
                  const fetchedRelays = await getNostrRelays(true);
                  const relaysCSV = fetchedRelays.join(',');
                  // Convert CSV to newline-separated for multiline display
                  const relaysForDisplay = relaysCSV.split(',').join('\n');
                  setPendingNostrRelays(relaysForDisplay);
                }}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <View style={styles.buttonContent}>
                  <Image
                    source={require('../assets/refresh-icon.png')}
                    style={[styles.buttonIcon, styles.whiteTint]}
                    resizeMode="contain"
                  />
                  <Text style={styles.buttonText}>Defaults</Text>
                </View>
              </Pressable>
            </View>
          </CollapsibleSection>
        )}
        {/* Storage Section */}
        <CollapsibleSection
          title="Storage"
          isExpanded={expandedSections.storage}
          onToggle={() => toggleSection('storage')}
          styles={styles}
          theme={theme}>
          {/* Clear Address Cache (balances + transactions only) */}
          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Cache Maintenance</Text>
            <Text style={styles.apiDescription}>
              Clear cached balances and history.
            </Text>
          </View>
          <Pressable
            style={[styles.button, styles.deleteButton]}
            onPress={async () => {
              HapticFeedback.light();
              try {
                await LocalCache.clear();
                setUsageSize(await LocalCache.usageSize());
                Alert.alert('Cache Cleared', 'Cache cleared successfully.');
                navigation.reset(getResetToMainTabsWallet());
              } catch (e) {
                dbg('Error clearing cache', e);
                Alert.alert(
                  'Error',
                  'Failed to clear cache. Please try again.',
                );
              }
            }}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <View style={styles.buttonContent}>
              <Image
                source={require('../assets/delete-icon.png')}
                style={[styles.buttonIcon, styles.whiteTint]}
                resizeMode="contain"
              />
              <Text style={styles.buttonText}>
                Clear Cache ({usageSize.mb})
              </Text>
            </View>
          </Pressable>
        </CollapsibleSection>

        {/* Dev Debug Section - Only visible on Android if enabled via build number clicks */}
        {Platform.OS === 'android' && devDebugEnabled && (
          <CollapsibleSection
            title="Dev Debug"
            isExpanded={expandedSections.devDebug}
            onToggle={() => toggleSection('devDebug')}
            styles={styles}
            theme={theme}>
            <View
              style={[
                styles.warningContainer,
                {
                  backgroundColor: theme.colors.warningBg,
                  borderColor: theme.colors.warningBorder,
                },
              ]}>
              <Text
                style={[styles.warningText, {color: theme.colors.warningText}]}>
                ⚠️ Developers Only
              </Text>
              <Text
                style={[
                  styles.warningDescription,
                  {color: theme.colors.warningText},
                ]}>
                Debug logs may contain sensitive information. Use only on
                trusted devices, and only if you know what you are doing. View
                detailed logs in logcat (Android only, requires USB debugging).
                Session-only setting - resets on app restart.
              </Text>
            </View>
            {/* Enhanced Debug Logging Card */}
            <View style={styles.debugLoggingCard}>
              <View style={styles.debugLoggingHeader}>
                <Text style={styles.debugLoggingTitle}>Debug Logging</Text>
                <View style={styles.debugLoggingStatus}>
                  <View
                    style={[
                      styles.debugLoggingStatusDot,
                      {
                        backgroundColor: debugLoggingEnabled
                          ? theme.colors.success
                          : theme.colors.textSecondary,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.debugLoggingStatusText,
                      {
                        color: debugLoggingEnabled
                          ? theme.colors.success
                          : theme.colors.textSecondary,
                      },
                    ]}>
                    {debugLoggingEnabled ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>
              <View style={styles.toggleContainer}>
                <Text style={styles.toggleLabel}>Enable Logging</Text>
                <Switch
                  onValueChange={handleToggleDebugLogging}
                  value={debugLoggingEnabled}
                  trackColor={{
                    false: theme.colors.switchTrackFalse,
                    true: theme.colors.switchTrackTrue,
                  }}
                  thumbColor={theme.colors.switchThumb}
                  ios_backgroundColor={theme.colors.switchIosBackground}
                />
              </View>
            </View>

            {/* Enhanced Disable Dev Mode Button */}
            <Pressable
              style={styles.disableDevModeButton}
              onPress={() => {
                HapticFeedback.medium();
                Alert.alert(
                  'Disable Dev Mode',
                  'Are you sure you want to hide the Dev Debug section? You can enable it again by clicking the build number 7 times.',
                  [
                    {
                      text: 'Cancel',
                      style: 'cancel',
                    },
                    {
                      text: 'Disable',
                      style: 'destructive',
                      onPress: () => {
                        setDevDebugEnabled(false);
                        EncryptedStorage.setItem(
                          'devDebugEnabled',
                          'false',
                        ).catch(error => {
                          dbg('Error saving devDebugEnabled:', error);
                        });
                        Toast.show({
                          type: 'info',
                          text1: 'Dev Mode Disabled',
                          text2: 'Dev Debug section is now hidden',
                          position: 'top',
                        });
                      },
                    },
                  ],
                );
              }}
              android_ripple={{color: 'rgba(255,255,255,0.2)'}}>
              <Text style={styles.disableDevModeButtonText}>
                Disable Dev Mode
              </Text>
            </Pressable>
          </CollapsibleSection>
        )}

        {/* Legal Section */}
        <CollapsibleSection
          title="Legal"
          isExpanded={expandedSections.legal}
          onToggle={() => toggleSection('legal')}
          styles={styles}
          theme={theme}>
          <Text style={styles.toggleDescription}>
            Terms of Service and Privacy Policy
          </Text>
          <Text
            style={styles.termsLink}
            onPress={() => {
              HapticFeedback.light();
              setLegalModalType('terms');
              setIsLegalModalVisible(true);
            }}>
            Read Terms of Use
          </Text>
          <Text
            style={styles.termsLink}
            onPress={() => {
              HapticFeedback.light();
              setLegalModalType('privacy');
              setIsLegalModalVisible(true);
            }}>
            Read Privacy Policy
          </Text>
        </CollapsibleSection>
        {/* About Section */}
        <CollapsibleSection
          title="About"
          isExpanded={expandedSections.about}
          onToggle={() => toggleSection('about')}
          styles={styles}
          theme={theme}>
          <View style={styles.aboutInfoRow}>
            <Text style={styles.aboutLabel}>App Version</Text>
            <Text style={styles.aboutValue}>{appVersion}</Text>
          </View>
          <View style={styles.aboutInfoRow}>
            <Text style={styles.aboutLabel}>Build Number</Text>
            <Pressable
              onPress={() => {
                HapticFeedback.light();
                // Only enable on Android (iOS prod builds don't support logs)
                if (Platform.OS !== 'android') {
                  return;
                }

                // Check if dev mode is already enabled
                if (devDebugEnabled) {
                  Toast.show({
                    type: 'info',
                    text1: 'Dev Mode Already Enabled',
                    text2: 'Developer debug section is already visible',
                    position: 'top',
                    visibilityTime: 2000,
                  });
                  return;
                }

                // Increment click count
                buildNumberClickCountRef.current += 1;
                const currentCount = buildNumberClickCountRef.current;
                setBuildNumberClickCount(currentCount);

                // Clear existing timeout
                if (buildNumberClickTimeoutRef.current) {
                  clearTimeout(buildNumberClickTimeoutRef.current);
                }
                // Reset count after 3 seconds of inactivity
                buildNumberClickTimeoutRef.current = setTimeout(() => {
                  buildNumberClickCountRef.current = 0;
                  setBuildNumberClickCount(0);
                }, 3000);

                // Show progress toast starting from 2 clicks
                if (currentCount >= 2 && currentCount < 7) {
                  const stepsRemaining = 7 - currentCount;
                  Toast.show({
                    type: 'info',
                    text1: `You're now ${stepsRemaining} step${
                      stepsRemaining > 1 ? 's' : ''
                    } to enable dev mode`,
                    position: 'top',
                    visibilityTime: 2000,
                  });
                }

                // Check if we've reached 7 clicks
                if (currentCount >= 7) {
                  // Enable dev debug mode
                  setDevDebugEnabled(true);
                  EncryptedStorage.setItem('devDebugEnabled', 'true').catch(
                    error => {
                      dbg('Error saving devDebugEnabled:', error);
                    },
                  );
                  // Open devDebug section and close about section
                  setExpandedSections(prev => ({
                    ...prev,
                    about: false,
                    devDebug: true,
                  }));
                  // Show toast
                  Toast.show({
                    type: 'success',
                    text1: 'Dev Mode Enabled',
                    text2: 'Developer debug section is now visible',
                    position: 'top',
                  });
                  // Reset counter
                  buildNumberClickCountRef.current = 0;
                  setBuildNumberClickCount(0);
                  if (buildNumberClickTimeoutRef.current) {
                    clearTimeout(buildNumberClickTimeoutRef.current);
                    buildNumberClickTimeoutRef.current = null;
                  }
                }
              }}
              style={styles.buildNumberContainer}>
              {buildNumberClickCount >= 2 ? (
                <View style={styles.buildNumberBadge}>
                  <Text style={styles.buildNumberBadgeText}>{buildNumber}</Text>
                </View>
              ) : (
                <Text style={styles.aboutValue}>{buildNumber}</Text>
              )}
            </Pressable>
          </View>
          <Text style={styles.toggleDescription}>
            Make sure that your wallet keyshares devices are running the latest
            version for optimal compatibility and security.
          </Text>
        </CollapsibleSection>

        {/* Font Testing Section - Development Only */}
        {__DEV__ && (
          <CollapsibleSection
            title="Font Testing"
            isExpanded={expandedSections.fontTesting}
            onToggle={() => toggleSection('fontTesting')}
            styles={styles}
            theme={theme}>
            <Text style={styles.toggleDescription}>
              Visual font comparison tool to verify unified fonts across
              platforms. This section only appears in development builds. Note
              that rendered fonts may differ from the actual fonts on your
              device. Also, the font testing section is only visible in
              development builds.
            </Text>
            <FontComparisonScreen />
          </CollapsibleSection>
        )}
      </ScrollView>
      {/* Modals */}
      <BackupKeyshareModal
        visible={isBackupModalVisible}
        onClose={() => setIsBackupModalVisible(false)}
        description="Store your keyshares in separate private locations e.g. cloud, emails, external drives, etc. Do not keep them together so no one can access them all and steal your funds."
      />
      <Modal
        visible={isModalResetVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsModalResetVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Image
                source={require('../assets/warning-icon.png')}
                style={styles.modalIcon}
                resizeMode="contain"
              />
              <Text style={styles.modalTitle}>Confirm Wallet Deletion</Text>
            </View>
            <Text style={styles.modalDescription}>
              Type <Text style={styles.apiName}>"delete my wallet"</Text> to
              confirm. This erases all local data on this device and cannot be
              undone. Make sure you have backups first.
            </Text>
            <TextInput
              style={styles.input}
              placeholder='"delete my wallet"'
              placeholderTextColor={theme.colors.textSecondary + '80'}
              value={deleteInput}
              onChangeText={setDeleteInput}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  HapticFeedback.light();
                  setIsModalResetVisible(false);
                }}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalButton,
                  styles.confirmButton,
                  isDeleting && styles.halfOpacity,
                ]}
                onPress={() => {
                  HapticFeedback.light();
                  handleResetWallet();
                }}
                disabled={isDeleting}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Text
                  style={[
                    styles.confirmButtonText,
                    isDeleting && styles.disabledButtonText,
                  ]}>
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <LegalModal
        visible={isLegalModalVisible}
        onClose={() => {
          HapticFeedback.light();
          setIsLegalModalVisible(false);
        }}
        type={legalModalType}
      />
      {/* API Info Modal */}
      <Modal
        visible={isApiInfoVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsApiInfoVisible(false)}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setIsApiInfoVisible(false)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={styles.apiInfoModalContent}>
              <View style={styles.apiInfoModalHeader}>
                <View style={styles.apiInfoModalIconContainer}>
                  <Image
                    source={require('../assets/api-icon.png')}
                    style={styles.apiInfoModalIcon}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.apiInfoModalTitle}>
                  Mempool.Space Providers
                </Text>
                <Pressable
                  style={styles.apiInfoModalCloseButton}
                  onPress={() => {
                    HapticFeedback.light();
                    setIsApiInfoVisible(false);
                  }}
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <Text style={styles.apiInfoModalCloseText}>✕</Text>
                </Pressable>
              </View>
              <View style={styles.apiInfoModalBody}>
                <View style={styles.apiInfoSection}>
                  <View style={styles.apiInfoSectionRow}>
                    <Image
                      source={require('../assets/privacy-icon.png')}
                      style={styles.apiInfoSectionIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.apiInfoSectionTitle}>
                      Privacy & Control
                    </Text>
                  </View>
                  <Text style={styles.apiInfoSectionText}>
                    Using your own mempool.space server can improve privacy by
                    keeping your wallet queries off public servers.
                  </Text>
                </View>
                <View style={styles.apiInfoSection}>
                  <View style={styles.apiInfoSectionRow}>
                    <Image
                      source={require('../assets/eye-on-icon.png')}
                      style={styles.apiInfoSectionIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.apiInfoSectionTitle}>
                      Reduce Tracking
                    </Text>
                  </View>
                  <Text style={styles.apiInfoSectionText}>
                    This reduces third‑party insight into your addresses and
                    activity.
                  </Text>
                </View>
                <View style={styles.apiInfoSection}>
                  <View style={styles.apiInfoSectionRow}>
                    <Image
                      source={require('../assets/info-icon.png')}
                      style={styles.apiInfoSectionIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.apiInfoSectionTitle}>How to Use</Text>
                  </View>
                  <Text style={styles.apiInfoSectionText}>
                    Enter your self‑hosted URL above or pick from the
                    suggestions.
                  </Text>
                </View>
              </View>
              <Pressable
                style={[
                  styles.apiInfoModalButton,
                  {backgroundColor: theme.colors.primary},
                ]}
                onPress={() => {
                  HapticFeedback.light();
                  setIsApiInfoVisible(false);
                }}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Text
                  style={[
                    styles.apiInfoModalButtonText,
                    {color: theme.colors.textOnPrimary},
                  ]}>
                  Got it
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};
export default WalletSettings;
