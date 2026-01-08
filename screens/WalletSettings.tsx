import React, {useEffect, useState, useRef, useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  NativeModules,
  Switch,
  Linking,
  ScrollView,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  useWindowDimensions,
  DeviceEventEmitter,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
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
} from '../utils';
import {useTheme} from '../theme';
import {WalletService} from '../services/WalletService';
import LocalCache from '../services/LocalCache';
import LegalModal from '../components/LegalModal';
import {fetchDynamicAPIEndpoints, getNostrRelays} from '../utils';

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
  const rotationAnim = useRef(new Animated.Value(isExpanded ? 1 : 0)).current;

  useEffect(() => {
    // Sync rotation with isExpanded on mount or prop change
    Animated.timing(rotationAnim, {
      toValue: isExpanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isExpanded, rotationAnim]);

  const rotateInterpolate = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  const handlePress = () => {
    HapticFeedback.light();

    // Animate rotation immediately
    Animated.timing(rotationAnim, {
      toValue: isExpanded ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

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
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={handlePress}
        activeOpacity={0.7}
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
            {
              transform: [{rotate: rotateInterpolate}],
              color: theme.colors.text,
            },
          ]}>
          ▶
        </Animated.Text>
      </TouchableOpacity>

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
  const modalAnimation = useRef(new Animated.Value(0)).current;

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
    modalAnimation.setValue(0);
    Animated.spring(modalAnimation, {
      toValue: 1,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  };

  const closeModal = () => {
    HapticFeedback.light();
    // Animate modal exit
    Animated.timing(modalAnimation, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setIsModalVisible(false);
      setSearchQuery('');
    });
  };

  const selectOption = async (option: string) => {
    dbg('selectOption called with:', option);
    HapticFeedback.selection();
    await onChangeText(option);
    closeModal();
  };

  const getNetworkIcon = (api: string) => {
    return api.toLowerCase().includes('testnet') ? '🧪' : '🌐';
  };

  const renderApiItem = ({item}: {item: string}) => {
    const isSelected = item === value;

    return (
      <TouchableOpacity
        key={item}
        style={[
          styles.apiModalItem,
          {borderBottomColor: theme.colors.border},
          isSelected && styles.apiModalItemSelected,
        ]}
        onPress={() => selectOption(item)}
        activeOpacity={0.7}>
        <Text style={styles.apiModalItemIcon}>{getNetworkIcon(item)}</Text>
        <Text
          style={[
            styles.apiModalItemText,
            {color: theme.colors.text},
            isSelected && [
              styles.apiModalItemTextSelected,
              {color: theme.colors.primary},
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
      </TouchableOpacity>
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
            <TouchableOpacity
              style={styles.apiDropdownButton}
              onPress={isTestnet ? undefined : openModal}
              activeOpacity={isTestnet ? 1 : 0.6}
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
            </TouchableOpacity>
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
          <TouchableOpacity
            style={styles.apiModalBackdrop}
            activeOpacity={1}
            onPress={() => {
              Keyboard.dismiss();
              closeModal();
            }}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={e => e.stopPropagation()}>
              <Animated.View
                style={[
                  styles.apiModalContent,
                  {
                    maxHeight: height * 0.8,
                    opacity: modalAnimation,
                    transform: [
                      {
                        translateY: modalAnimation.interpolate({
                          inputRange: [0, 1],
                          outputRange: [100, 0],
                        }),
                      },
                    ],
                  },
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
                    <TouchableOpacity
                      onPress={closeModal}
                      style={[
                        styles.apiModalCloseButton,
                        {backgroundColor: theme.colors.cardBackground},
                      ]}
                      activeOpacity={0.6}>
                      <Text
                        style={[
                          styles.apiModalCloseText,
                          {color: theme.colors.text},
                        ]}>
                        ✕
                      </Text>
                    </TouchableOpacity>
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
                    <Text style={styles.apiModalSearchIcon}>🔍</Text>
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
                      <TouchableOpacity
                        onPress={() => setSearchQuery('')}
                        style={styles.apiModalSearchClear}
                        activeOpacity={0.6}>
                        <Text
                          style={[
                            styles.apiModalSearchClearText,
                            {color: theme.colors.textSecondary},
                          ]}>
                          ✕
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </Animated.View>
            </TouchableOpacity>
          </TouchableOpacity>
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
    case 'network':
      return require('../assets/network-icon.png');
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
    default:
      return require('../assets/advanced-icon.png');
  }
};

const WalletSettings: React.FC<{navigation: any}> = ({navigation}) => {
  // Use UserContext for reactive network and API state
  const {setActiveNetwork, setActiveApiProvider} = useUser();
  const [selectedIcon, setSelectedIcon] = useState<
    'default' | 'alternative' | 'loading'
  >('loading');
  const [deleteInput, setDeleteInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
  const [walletMode, setWalletMode] = useState<'full' | 'psbt'>('full');

  const [hasNostr, setHasNostr] = useState(false);
  const [isLegalModalVisible, setIsLegalModalVisible] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy'>(
    'terms',
  );
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);
  const [isApiInfoVisible, setIsApiInfoVisible] = useState(false);

  // Password validation states
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  // Collapsible states
  const [expandedSections, setExpandedSections] = useState<{
    [key: string]: boolean;
  }>({
    theme: false,
    haptics: false,
    backup: false,
    advanced: false,
    nostr: false,
    about: false,
    legal: false,
    storage: false,
    appIcon: false,
    devicePairing: false,
    walletMode: false,
  });

  const {theme, themeMode, setThemeMode} = useTheme();
  const [appVersion, setAppVersion] = useState('');
  const [buildNumber, setBuildNumber] = useState('');
  const [usageSize, setUsageSize] = useState<{fileCount: number; mb: string}>({
    fileCount: 0,
    mb: '0.00 MB',
  });
  // Password validation functions
  const validatePassword = (pass: string) => {
    const errors: string[] = [];
    const checks = {
      length: pass.length >= 12,
      uppercase: /[A-Z]/.test(pass),
      lowercase: /[a-z]/.test(pass),
      number: /\d/.test(pass),
      symbol: /[!@#$%^&*(),.?":{}|<>]/.test(pass),
    };

    if (!checks.length) {
      errors.push('12+ characters');
    }
    if (!checks.uppercase) {
      errors.push('Uppercase letter (A-Z)');
    }
    if (!checks.lowercase) {
      errors.push('Lowercase letter (a-z)');
    }
    if (!checks.number) {
      errors.push('Number (0-9)');
    }
    if (!checks.symbol) {
      errors.push('Special character (!@#$...)');
    }

    setPasswordErrors(errors);

    // Calculate strength (0-4)
    const strength = Object.values(checks).filter(Boolean).length;
    setPasswordStrength(strength);

    return errors.length === 0;
  };

  const getPasswordStrengthText = () => {
    if (passwordStrength <= 1) {
      return 'Very Weak';
    }
    if (passwordStrength <= 2) {
      return 'Weak';
    }
    if (passwordStrength <= 3) {
      return 'Medium';
    }
    return 'Strong';
  };

  const getPasswordStrengthColor = () => {
    if (passwordStrength <= 1) {
      return theme.colors.danger;
    }
    if (passwordStrength <= 2) {
      return theme.colors.accent;
    }
    if (passwordStrength <= 3) {
      return theme.colors.accent;
    }
    return theme.colors.received;
  };

  const clearBackupModal = () => {
    setPassword('');
    setConfirmPassword('');
    setPasswordVisible(false);
    setConfirmPasswordVisible(false);
    setPasswordStrength(0);
    setPasswordErrors([]);
    setIsBackupModalVisible(false);
  };

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

    // Load wallet mode preference (default to full mode)
    EncryptedStorage.getItem('wallet_mode')
      .then(mode => {
        if (mode === 'psbt') {
          setWalletMode('psbt');
        } else {
          setWalletMode('full');
        }
      })
      .catch(error => {
        dbg('Error loading wallet_mode from storage:', error);
        setWalletMode('full');
      });
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
        console.warn('Error loading icon preference:', error);
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
    const networkIcon = value ? '🧪' : '🌐';

    await setActiveNetwork(newNetwork);

    // Check user's wallet mode preference before navigating
    let targetRoute = 'Home';
    try {
      targetRoute = walletMode === 'psbt' ? 'PSBT' : 'Home';
      dbg(
        'Network toggle: Navigating to',
        targetRoute,
        'based on wallet_mode:',
        walletMode,
      );
    } catch (error) {
      dbg('Error loading wallet_mode during network toggle:', error);
      // Default to 'Home' if there's an error
    }

    // Navigate to the appropriate screen based on user preference
    navigation.reset({index: 0, routes: [{name: targetRoute}]});

    // Show brief feedback alert after a brief delay to ensure navigation completes
    setTimeout(() => {
      // warn user if test net bitcoin is not real
      // add i understand button to the alert
      if (newNetwork === 'mainnet') {
        Alert.alert(
          `${networkIcon} Switched to ${networkName}`,
          'Mainnet Bitcoin is the real Bitcoin. It is the main network for all Bitcoin transactions.',
          [{text: 'I understand', onPress: () => {}}],
        );
      } else {
        Alert.alert(
          `${networkIcon} Switched to ${networkName}`,
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
    navigation.reset({index: 0, routes: [{name: 'Home'}]});
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
      navigation.reset({index: 0, routes: [{name: 'Home'}]});
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

  const handleBackupWallet = async () => {
    if (!validatePassword(password)) {
      const missingRequirements = passwordErrors.join('\n• ');
      Alert.alert(
        'Password Requirements Not Met',
        `Your password must meet all of the following requirements:\n\n• ${missingRequirements}\n\nPlease update your password and try again.`,
      );
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(
        'Passwords Do Not Match',
        'The password and confirmation password must be identical. Please check both fields and try again.',
      );
      return;
    }

    try {
      HapticFeedback.medium();

      const storedKeyshare = await EncryptedStorage.getItem('keyshare');
      if (storedKeyshare) {
        const json = JSON.parse(storedKeyshare);
        const encryptedKeyshare = await BBMTLibNativeModule.aesEncrypt(
          storedKeyshare,
          await BBMTLibNativeModule.sha256(password),
        );

        // Create filename based on pub_key hash and keyshare number
        if (!json.pub_key) {
          Alert.alert('Error', 'Keyshare missing pub_key.');
          return;
        }
        
        // Get SHA256 hash of pub_key and take first 4 characters
        const pubKeyHash = await BBMTLibNativeModule.sha256(json.pub_key);
        const hashPrefix = pubKeyHash.substring(0, 4).toLowerCase();
        
        // Extract keyshare number from label (KeyShare1 -> 1, KeyShare2 -> 2, etc.)
        const keyshareLabel = getKeyshareLabel(json);
        let keyshareNumber = '1'; // default
        if (keyshareLabel) {
          const match = keyshareLabel.match(/KeyShare(\d+)/);
          if (match) {
            keyshareNumber = match[1];
          }
        } else if (json.keygen_committee_keys && json.local_party_key) {
          // Fallback: compute from position in sorted keygen_committee_keys
          const sortedKeys = [...json.keygen_committee_keys].sort();
          const index = sortedKeys.indexOf(json.local_party_key);
          if (index >= 0) {
            keyshareNumber = String(index + 1);
          }
        }
        
        const friendlyFilename = `${hashPrefix}K${keyshareNumber}.share`;

        const tempDir = RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath;
        const filePath = `${tempDir}/${friendlyFilename}`;

        await RNFS.writeFile(filePath, encryptedKeyshare, 'base64');

        await Share.open({
          title: 'Backup Your Keyshare',
          isNewTask: true,
          message:
            'Save this encrypted file securely. It is required for wallet recovery.',
          url: `file://${filePath}`,
          type: 'application/octet-stream',
          filename: friendlyFilename,
          failOnCancel: false,
        });

        // Cleanup temp file (best-effort)
        try {
          await RNFS.unlink(filePath);
        } catch {
          // ignore cleanup errors
        }
        clearBackupModal();
      } else {
        Alert.alert('Error', 'Invalid keyshare.');
      }
    } catch (error) {
      dbg('Error encrypting or sharing keyshare:', error);
      Alert.alert('Error', 'Failed to encrypt or share the keyshare.');
    }
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    if (text.length > 0) {
      validatePassword(text);
    } else {
      setPasswordStrength(0);
      setPasswordErrors([]);
    }
  };

  const handleToggleHaptics = (value: boolean) => {
    HapticFeedback.light();
    setHapticsEnabledState(value);
    setHapticsEnabled(value);
  };

  const styles = StyleSheet.create({
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
      fontSize: 28,
      fontWeight: 'bold',
      color: theme.colors.text,
      textAlign: 'center',
    },
    collapsibleSection: {
      marginBottom: 10,
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
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
    },
    expandIcon: {
      fontSize: 14,
      fontWeight: 'bold',
    },
    sectionContent: {
      paddingHorizontal: 12,
      borderTopWidth: 1,
      borderTopColor: theme.colors.accent,
    },
    toggleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
      paddingHorizontal: 4,
    },
    toggleLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
    },
    toggleDescription: {
      fontSize: 13,
      color: theme.colors.textSecondary,
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
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 2,
    },
    appIconHintSubtitle: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      lineHeight: 16,
    },
    inputAPI: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 6,
      padding: 10,
      fontSize: 13,
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
      fontSize: 14,
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
      fontSize: 14,
      fontWeight: '600',
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
      fontSize: 14,
      fontWeight: '600',
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
      fontSize: 16,
    },
    apiNetworkModeText: {
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.2,
    },
    apiNetworkModeTextTestnet: {
      color: theme.colors.accent,
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
      minHeight: 36,
    },
    apiInfoButtonIcon: {
      width: 14,
      height: 14,
      tintColor: theme.colors.text, // Use text color for better visibility in dark mode
    },
    apiInfoButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.colors.primary,
    },
    apiNetworkDescription: {
      fontSize: 12,
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
      fontSize: 16,
      fontWeight: '700',
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
      fontSize: 18,
      fontWeight: '600',
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
      fontSize: 16,
      marginRight: 8,
    },
    apiModalSearchInput: {
      flex: 1,
      fontSize: 15,
      padding: 0,
      margin: 0,
    },
    apiModalSearchClear: {
      padding: 4,
      marginLeft: 8,
    },
    apiModalSearchClearText: {
      fontSize: 14,
      fontWeight: '600',
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
      fontSize: 18,
      marginRight: 12,
    },
    apiModalItemText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: -0.2,
    },
    apiModalItemTextSelected: {
      fontWeight: '600',
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
      fontSize: 14,
      fontWeight: 'bold',
      color: theme.colors.white,
    },
    apiModalLoading: {
      padding: 48,
      alignItems: 'center',
    },
    apiModalLoadingText: {
      fontSize: 14,
      fontStyle: 'italic',
    },
    apiModalEmpty: {
      padding: 48,
      alignItems: 'center',
    },
    apiModalEmptyText: {
      fontSize: 14,
      fontStyle: 'italic',
    },
    button: {
      paddingVertical: 10,
      borderRadius: 6,
      alignItems: 'center',
      marginTop: 6,
    },
    deleteButton: {
      backgroundColor: theme.colors.accent,
    },
    backupButton: {
      backgroundColor: theme.colors.primary,
      marginBottom: 16, // Add spacing after backup button before delete section
    },
    resetButton: {
      backgroundColor: theme.colors.accent,
    },
    buttonText: {
      color: theme.colors.textOnPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
    apiItem: {
      marginTop: 0, // Section padding handles first element spacing
      marginBottom: 0, // Consistent spacing
    },
    apiName: {
      fontSize: 14,
      fontWeight: 'bold',
      color: theme.colors.text, // Use text color for better readability in dark mode
      marginBottom: 4,
    },
    apiDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      lineHeight: 20,
      marginBottom: 6,
    },
    linkText: {
      color: theme.colors.text, // Use text color for better readability in dark mode
      fontWeight: 'bold',
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
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.text,
      letterSpacing: -0.2,
    },
    aboutValue: {
      fontSize: 15,
      fontWeight: '500',
      color: theme.colors.textSecondary,
      letterSpacing: -0.2,
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
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.text,
      letterSpacing: -0.3,
    },
    aboutSectionDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      lineHeight: 22,
      letterSpacing: -0.1,
    },
    aboutLinkText: {
      color: theme.colors.text, // Use text color for better readability in dark mode
      fontWeight: '600',
      textDecorationLine: 'underline',
      textDecorationColor: theme.colors.text, // Match underline color
    },
    termsLink: {
      color: theme.colors.text, // Use text color for better readability in dark mode
      fontWeight: 'bold',
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
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.colors.text,
    },
    modalDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 20,
      textAlign: 'center',
    },
    passwordContainer: {
      marginBottom: 12,
    },
    passwordLabel: {
      fontSize: 14,
      fontWeight: 'bold',
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
      fontSize: 13,
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
      fontSize: 12,
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
    },
    cancelButton: {
      backgroundColor: theme.colors.secondary,
    },
    confirmButton: {
      backgroundColor: theme.colors.accent,
    },
    disabledButton: {
      backgroundColor: theme.colors.disabled,
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
      fontSize: 20,
    },
    apiInfoModalTitle: {
      flex: 1,
      fontSize: 18,
      fontWeight: '700',
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
      fontSize: 18,
      fontWeight: '600',
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
      fontSize: 20,
      marginRight: 10,
    },
    apiInfoSectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.text,
      letterSpacing: -0.2,
    },
    apiInfoSectionText: {
      fontSize: 14,
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
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: -0.2,
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
      fontSize: 16,
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
      fontSize: 12,
      fontWeight: 'bold',
      minWidth: 60,
      textAlign: 'right',
      color: theme.colors.textSecondary,
    },
    requirementsContainer: {
      marginTop: 4,
    },
    requirementText: {
      fontSize: 12,
      color: theme.colors.warningAccent,
      fontWeight: '500',
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
      fontSize: 12,
      marginTop: 4,
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    buttonIcon: {
      width: 20,
      height: 20,
      marginRight: 12,
      tintColor: theme.colors.white,
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
      fontSize: 12,
      marginBottom: 2,
    },
    networkStatusText: {
      fontSize: 12,
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
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
    },
    walletModeDescription: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginBottom: 12,
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
      borderColor: theme.colors.accent,
      borderWidth: 2,
      backgroundColor: theme.colors.cardBackground,
    },
    themeOptionContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    themeOptionLabel: {
      fontSize: 15,
      fontWeight: '500',
      color: theme.colors.text,
    },
    themeOptionLabelSelected: {
      fontWeight: '600',
      color: theme.colors.accent,
    },
    themeOptionCheck: {
      width: 18,
      height: 18,
      tintColor: theme.colors.accent,
    },
  });

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        bounces={true}
        scrollEventThrottle={16}
        overScrollMode="auto">
        {/* Theme Section - First for better UX */}
        <CollapsibleSection
          title="Theme"
          isExpanded={expandedSections.theme}
          onToggle={() => toggleSection('theme')}
          styles={styles}
          theme={theme}>
          <Text style={styles.toggleDescription}>
            Choose your preferred color theme. OS Default follows your system settings.
          </Text>
          <View style={styles.themeOptionContainer}>
            <TouchableOpacity
              style={[
                styles.themeOption,
                themeMode === 'os' && styles.themeOptionSelected,
              ]}
              onPress={() => {
                HapticFeedback.light();
                setThemeMode('os');
              }}
              activeOpacity={0.7}>
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
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.themeOption,
                themeMode === 'light' && styles.themeOptionSelected,
              ]}
              onPress={() => {
                HapticFeedback.light();
                setThemeMode('light');
              }}
              activeOpacity={0.7}>
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
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.themeOption,
                themeMode === 'dark' && styles.themeOptionSelected,
              ]}
              onPress={() => {
                HapticFeedback.light();
                setThemeMode('dark');
              }}
              activeOpacity={0.7}>
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
            </TouchableOpacity>
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
              trackColor={{
                true: theme.colors.primary,
                false: theme.colors.secondary,
              }}
              thumbColor={theme.colors.accent}
              onValueChange={handleToggleHaptics}
              value={hapticsEnabled}
            />
            <Text style={styles.toggleLabel}>Haptics On</Text>
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
                trackColor={{
                  true: theme.colors.primary,
                  false: theme.colors.secondary,
                }}
                thumbColor={theme.colors.accent}
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
                    console.error('Error changing icon:', error);

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
                value={selectedIcon === 'alternative'}
                disabled={selectedIcon === 'loading'}
              />
              <Text style={styles.toggleLabel}>QuickCalc</Text>
            </View>
          </CollapsibleSection>
        )}

        {/* Wallet Mode Section */}
        <CollapsibleSection
          title="Wallet Mode"
          isExpanded={expandedSections.walletMode}
          onToggle={() => toggleSection('walletMode')}
          styles={styles}
          theme={theme}>
          <Text style={styles.walletModeDescription}>
            Choose the default wallet experience when opening the app. PSBT Mode
            jumps directly into PSBT signing workflows, while Full Mode opens
            the main wallet home screen.
          </Text>
          <View style={styles.walletModeRow}>
            <Text style={styles.walletModeLabel}>Full Mode</Text>
            <Switch
              trackColor={{
                true: theme.colors.primary,
                false: theme.colors.secondary,
              }}
              thumbColor={theme.colors.accent}
              onValueChange={async value => {
                HapticFeedback.light();
                const mode = value ? 'psbt' : 'full';
                setWalletMode(mode);
                try {
                  await EncryptedStorage.setItem('wallet_mode', mode);
                  // If switching to PSBT mode, set flag for first visit (both sections closed)
                  if (mode === 'psbt') {
                    await EncryptedStorage.setItem(
                      'psbt_mode_first_visit',
                      'true',
                    );
                  }
                } catch (error) {
                  dbg('Error saving wallet_mode:', error);
                }
                // Immediately navigate to the selected default screen
                navigation.reset({
                  index: 0,
                  routes: [{name: mode === 'psbt' ? 'PSBT' : 'Home'}],
                });
              }}
              value={walletMode === 'psbt'}
            />
            <Text style={styles.walletModeLabel}>PSBT Only</Text>
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

          <TouchableOpacity
            style={[styles.button, styles.backupButton]}
            onPress={() => {
              HapticFeedback.light();
              setIsBackupModalVisible(true);
            }}>
            <View style={styles.buttonContent}>
              <Image
                source={require('../assets/upload-icon.png')}
                style={styles.buttonIcon}
                resizeMode="contain"
              />
              <Text style={styles.buttonText}>Backup {party}</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Delete Wallet Keyshare</Text>
          </View>

          <TouchableOpacity
            style={[styles.button, styles.deleteButton]}
            onPress={() => {
              HapticFeedback.light();
              setIsModalResetVisible(true);
            }}>
            <View style={styles.buttonContent}>
              <Image
                source={require('../assets/delete-icon.png')}
                style={[styles.buttonIcon, styles.whiteTint]}
                resizeMode="contain"
              />
              <Text style={styles.buttonText}>Delete {party}</Text>
            </View>
          </TouchableOpacity>
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
              trackColor={{
                true: theme.colors.primary,
                false: theme.colors.secondary,
              }}
              thumbColor={theme.colors.accent}
              onValueChange={toggleNetwork}
              value={isTestnet}
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
                <Text style={styles.apiNetworkModeIcon}>
                  {isTestnet ? '🔒' : '🌐'}
                </Text>
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
                <TouchableOpacity
                  style={styles.apiInfoButton}
                  onPress={() => {
                    HapticFeedback.light();
                    setIsApiInfoVisible(true);
                  }}
                  activeOpacity={0.7}>
                  <Image
                    source={require('../assets/about-icon.png')}
                    style={styles.apiInfoButtonIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.apiInfoButtonText}>Change Provider?</Text>
                </TouchableOpacity>
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
              <TouchableOpacity
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
                disabled={isAPISaving || !pendingAPI || pendingAPI === baseAPI}>
                <View style={styles.buttonContent}>
                  <Image
                    source={require('../assets/check-icon.png')}
                    style={[styles.buttonIcon, styles.whiteTint]}
                    resizeMode="contain"
                  />
                  <Text style={styles.buttonText}>
                    {isAPISaving ? 'Verifying...' : 'Verify & Save'}
                  </Text>
                </View>
              </TouchableOpacity>
            )}

            {/* Reset Default API button - only show in mainnet */}
            {!isTestnet && (
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.resetButton,
                  styles.apiActionButton,
                ]}
                onPress={() => {
                  HapticFeedback.light();
                  resetAPI();
                }}>
                <View style={styles.buttonContent}>
                  <Image
                    source={require('../assets/refresh-icon.png')}
                    style={[styles.buttonIcon, styles.whiteTint]}
                    resizeMode="contain"
                  />
                  <Text style={styles.buttonText}>Defaults</Text>
                </View>
              </TouchableOpacity>
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
              <TouchableOpacity
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
                }>
                <View style={styles.buttonContent}>
                  <Image
                    source={require('../assets/check-icon.png')}
                    style={[styles.buttonIcon, styles.whiteTint]}
                    resizeMode="contain"
                  />
                  <Text style={styles.buttonText}>Save Relays</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
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
                }}>
                <View style={styles.buttonContent}>
                  <Image
                    source={require('../assets/refresh-icon.png')}
                    style={[styles.buttonIcon, styles.whiteTint]}
                    resizeMode="contain"
                  />
                  <Text style={styles.buttonText}>Defaults</Text>
                </View>
              </TouchableOpacity>
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
          <TouchableOpacity
            style={[styles.button, styles.deleteButton]}
            onPress={async () => {
              HapticFeedback.light();
              try {
                await LocalCache.clear();
                setUsageSize(await LocalCache.usageSize());
                Alert.alert('Cache Cleared', 'Cache cleared successfully.');
                navigation.reset({index: 0, routes: [{name: 'Home'}]});
              } catch (e) {
                dbg('Error clearing cache', e);
                Alert.alert(
                  'Error',
                  'Failed to clear cache. Please try again.',
                );
              }
            }}>
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
          </TouchableOpacity>
        </CollapsibleSection>

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
            <Text style={styles.aboutValue}>{buildNumber}</Text>
          </View>

          <View style={styles.aboutSection}>
            <View style={styles.aboutSectionHeader}>
              <Image
                source={require('../assets/api-icon.png')}
                style={styles.aboutSectionIcon}
                resizeMode="contain"
              />
              <Text style={styles.aboutSectionTitle}>Mempool.Space</Text>
            </View>
            <Text style={styles.aboutSectionDescription}>
              Used for balances, history, transactions, and fees.{'\n'}Learn
              more:{' '}
              <Text
                style={styles.aboutLinkText}
                onPress={() => {
                  HapticFeedback.light();
                  Linking.openURL('https://mempool.space/docs/api/rest');
                }}>
                API Docs
              </Text>
            </Text>
          </View>

          <View style={styles.aboutSection}>
            <View style={styles.aboutSectionHeader}>
              <Image
                source={require('../assets/privacy-icon.png')}
                style={styles.aboutSectionIcon}
                resizeMode="contain"
              />
              <Text style={styles.aboutSectionTitle}>Data & Security</Text>
            </View>
            <Text style={styles.aboutSectionDescription}>
              We collect no personal data and run no backend. Keys and signing
              operations happen solely on your devices. Connecting to your own
              Self‑hosted mempool servers and devices can improve privacy and
              control over your data. Without any third-party involvement or
              data collection.
            </Text>
          </View>
        </CollapsibleSection>
      </ScrollView>

      {/* Modals */}
      <Modal
        visible={isBackupModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsBackupModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.flexContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => {
              // Dismiss keyboard when tapping outside
              Keyboard.dismiss();
            }}>
            <TouchableOpacity
              style={styles.modalContent}
              activeOpacity={1}
              onPress={() => {
                // Prevent modal from closing when tapping inside
              }}>
              <View style={styles.modalHeader}>
                <Image
                  source={require('../assets/backup-icon.png')}
                  style={styles.modalIcon}
                  resizeMode="contain"
                />
                <Text style={styles.modalTitle}>Backup Keyshare</Text>
              </View>

              <Text style={styles.apiDescription}>
                Store your keyshares in separate private locations e.g. cloud,
                emails, external drives, etc. Do not keep them together so no
                one can access them all and steal your funds.
              </Text>

              <View style={styles.passwordContainer}>
                <Text style={styles.passwordLabel}>Set a Password</Text>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Enter a strong password"
                    placeholderTextColor={theme.colors.textSecondary + '80'}
                    secureTextEntry={!passwordVisible}
                    value={password}
                    onChangeText={handlePasswordChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => {
                      HapticFeedback.light();
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
                  </TouchableOpacity>
                </View>

                {/* Password Strength Indicator */}
                {password.length > 0 && (
                  <View style={styles.strengthContainer}>
                    <View style={styles.strengthBar}>
                      <View
                        style={[
                          styles.strengthFill,
                          {
                            width: `${(passwordStrength / 4) * 100}%`,
                            backgroundColor: getPasswordStrengthColor(),
                          },
                        ]}
                      />
                    </View>
                    <Text
                      style={[
                        styles.strengthText,
                        {color: getPasswordStrengthColor()},
                      ]}>
                      {getPasswordStrengthText()}
                    </Text>
                  </View>
                )}

                {/* Password Requirements */}
                {passwordErrors.length > 0 && (
                  <View style={styles.requirementsContainer}>
                    {passwordErrors.map((error, index) => (
                      <Text key={index} style={styles.requirementText}>
                        • {error}
                      </Text>
                    ))}
                  </View>
                )}
              </View>

              <View style={styles.passwordContainer}>
                <Text style={styles.passwordLabel}>Confirm Password</Text>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={[
                      styles.passwordInput,
                      confirmPassword.length > 0 &&
                        password !== confirmPassword &&
                        styles.errorInput,
                    ]}
                    placeholder="Confirm your password"
                    placeholderTextColor={theme.colors.textSecondary + '80'}
                    secureTextEntry={!confirmPasswordVisible}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => {
                      HapticFeedback.light();
                      setConfirmPasswordVisible(!confirmPasswordVisible);
                    }}>
                    <Image
                      source={
                        confirmPasswordVisible
                          ? require('../assets/eye-off-icon.png')
                          : require('../assets/eye-on-icon.png')
                      }
                      style={styles.eyeIcon}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                </View>
                {confirmPassword.length > 0 && password !== confirmPassword && (
                  <Text style={styles.errorText}>Passwords do not match</Text>
                )}
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => {
                    HapticFeedback.light();
                    clearBackupModal();
                  }}>
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.confirmButton,
                    (!password ||
                      !confirmPassword ||
                      password !== confirmPassword ||
                      passwordStrength < 3) &&
                      styles.disabledButton,
                  ]}
                  onPress={() => {
                    HapticFeedback.light();
                    handleBackupWallet();
                  }}
                  disabled={
                    !password ||
                    !confirmPassword ||
                    password !== confirmPassword ||
                    passwordStrength < 3
                  }>
                  <View style={styles.buttonContent}>
                    <Image
                      source={require('../assets/upload-icon.png')}
                      style={[styles.buttonIcon, styles.whiteTint]}
                      resizeMode="contain"
                    />
                    <Text style={styles.buttonText}>Backup</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

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
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  HapticFeedback.light();
                  setIsModalResetVisible(false);
                }}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.confirmButton,
                  isDeleting && styles.halfOpacity,
                ]}
                onPress={() => {
                  HapticFeedback.light();
                  handleResetWallet();
                }}
                disabled={isDeleting}>
                <Text style={styles.buttonText}>
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </Text>
              </TouchableOpacity>
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
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsApiInfoVisible(false)}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={e => e.stopPropagation()}>
            <View style={styles.apiInfoModalContent}>
              <View style={styles.apiInfoModalHeader}>
                <View style={styles.apiInfoModalIconContainer}>
                  <Text style={styles.apiInfoModalIcon}>🔒</Text>
                </View>
                <Text style={styles.apiInfoModalTitle}>
                  Mempool.Space Providers
                </Text>
                <TouchableOpacity
                  style={styles.apiInfoModalCloseButton}
                  onPress={() => {
                    HapticFeedback.light();
                    setIsApiInfoVisible(false);
                  }}
                  activeOpacity={0.6}>
                  <Text style={styles.apiInfoModalCloseText}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.apiInfoModalBody}>
                <View style={styles.apiInfoSection}>
                  <View style={styles.apiInfoSectionRow}>
                    <Text style={styles.apiInfoSectionIcon}>🌐</Text>
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
                    <Text style={styles.apiInfoSectionIcon}>🔍</Text>
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
                    <Text style={styles.apiInfoSectionIcon}>⚙️</Text>
                    <Text style={styles.apiInfoSectionTitle}>How to Use</Text>
                  </View>
                  <Text style={styles.apiInfoSectionText}>
                    Enter your self‑hosted URL above or pick from the
                    suggestions.
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[
                  styles.apiInfoModalButton,
                  {backgroundColor: theme.colors.primary},
                ]}
                onPress={() => {
                  HapticFeedback.light();
                  setIsApiInfoVisible(false);
                }}
                activeOpacity={0.8}>
                <Text
                  style={[
                    styles.apiInfoModalButtonText,
                    {color: theme.colors.textOnPrimary},
                  ]}>
                  Got it
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

export default WalletSettings;
