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
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import EncryptedStorage from 'react-native-encrypted-storage';
const {BBMTLibNativeModule} = NativeModules;
import DeviceInfo from 'react-native-device-info';
import {useUser} from '../context/UserContext';

// Predefined API endpoints
const MAINNET_APIS = [
  'https://mempool.space/api',
];
const TESTNET_APIS = ['https://mempool.space/testnet/api'];

import {
  dbg,
  HapticFeedback,
  setHapticsEnabled,
  areHapticsEnabled,
  getMainnetAPIList,
  getTestnetAPIList,
} from '../utils';
import {useTheme} from '../theme';
import {WalletService} from '../services/WalletService';
import LocalCache from '../services/LocalCache';
import LegalModal from '../components/LegalModal';
import {fetchDynamicAPIEndpoints} from '../utils';

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
    outputRange: ['0deg', '180deg'],
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

  // Get the appropriate API list - filter by network (using dynamic loading)
  const [predefinedAPIs, setPredefinedAPIs] = useState<string[]>([]);
  const [isLoadingPredefinedAPIs, setIsLoadingPredefinedAPIs] = useState(false);

  // Load dynamic API lists
  useEffect(() => {
    const loadAPIList = async () => {
      if (predefinedAPIs.length === 0 && !isLoadingPredefinedAPIs) {
        setIsLoadingPredefinedAPIs(true);
        try {
          const apiList = isTestnet
            ? await getTestnetAPIList()
            : await getMainnetAPIList();
          setPredefinedAPIs(apiList);
          dbg('API list loaded:', apiList);
        } catch (error) {
          dbg('Failed to load API list:', error);
          // Fallback to hardcoded APIs
          setPredefinedAPIs(isTestnet ? TESTNET_APIS : MAINNET_APIS);
        } finally {
          setIsLoadingPredefinedAPIs(false);
        }
      }
    };

    loadAPIList();
  }, [isTestnet, predefinedAPIs.length, isLoadingPredefinedAPIs]);

  // Fetch dynamic APIs for both networks
  useEffect(() => {
    const loadDynamicAPIs = async () => {
      if (dynamicAPIs.length === 0 && !isLoadingAPIs) {
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
        }
      }
    };

    loadDynamicAPIs();
  }, [dynamicAPIs.length, isLoadingAPIs]);

  // Refresh API options when network changes
  useEffect(() => {
    dbg(
      'Network changed, refreshing API options for:',
      isTestnet ? 'testnet' : 'mainnet',
    );
    setFilteredOptions(predefinedAPIs);
    setSearchQuery('');
  }, [isTestnet, predefinedAPIs]);

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

  // Filter options based on search query
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredOptions(predefinedAPIs);
    } else {
      const filtered = predefinedAPIs.filter(api =>
        api.toLowerCase().includes(searchQuery.toLowerCase()),
      );
      setFilteredOptions(filtered);
    }
  }, [searchQuery, predefinedAPIs]);

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
    HapticFeedback.light();
    setFilteredOptions(predefinedAPIs);
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
            placeholderTextColor={theme.colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            editable={true}
          />
          <TouchableOpacity
            style={styles.apiDropdownButton}
            onPress={openModal}
            activeOpacity={0.6}>
            <Text style={[styles.apiDropdownIcon, {color: theme.colors.text}]}>
              ▼
            </Text>
          </TouchableOpacity>
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
                          {tintColor: theme.colors.primary},
                        ]}
                        resizeMode="contain"
                      />
                      <Text
                        style={[
                          styles.apiModalTitle,
                          {color: theme.colors.text},
                        ]}>
                        Select a Mempool.Space Provider
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
                      placeholderTextColor={theme.colors.textSecondary}
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
    default:
      return require('../assets/advanced-icon.png');
  }
};

const WalletSettings: React.FC<{navigation: any}> = ({navigation}) => {
  // Use UserContext for reactive network and API state
  const {setActiveNetwork, setActiveApiProvider} = useUser();

  const [deleteInput, setDeleteInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isModalResetVisible, setIsModalResetVisible] = useState(false);
  const [isBackupModalVisible, setIsBackupModalVisible] = useState(false);
  const [isTestnet, setIsTestnet] = useState(true);
  const [party, setParty] = useState('');
  const [baseAPI, setBaseAPI] = useState('');
  const [_isCryptoVibrant, setIsCryptoVibrant] = useState(false);
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
    about: false,
    legal: false,
    storage: false,
  });

  const {theme} = useTheme();
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
      errors.push('At least 12 characters');
    }
    if (!checks.uppercase) {
      errors.push('One uppercase letter');
    }
    if (!checks.lowercase) {
      errors.push('One lowercase letter');
    }
    if (!checks.number) {
      errors.push('One number');
    }
    if (!checks.symbol) {
      errors.push('One special character');
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
      return '#FFA500';
    }
    if (passwordStrength <= 3) {
      return '#FFD700';
    }
    return '#4CAF50';
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
  }, []);

  useEffect(() => {
    EncryptedStorage.getItem('keyshare').then(ks => {
      const json = JSON.parse(ks as string);
      setParty(json.local_party_key);
    });

    // Load network and corresponding cached API
    LocalCache.getItem('network').then(async net => {
      dbg('=== Loading settings for network:', net);
      setIsTestnet(net !== 'mainnet');

      // Try to get the cached API for this network
      const cachedApi = await LocalCache.getItem(`api_${net}`);
      dbg(`Cached API for ${net}:`, cachedApi);

      if (cachedApi) {
        setBaseAPI(cachedApi);
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
          await LocalCache.setItem('api', defaultApi);
          await LocalCache.setItem(`api_${net}`, defaultApi);
          if (net) {
            await BBMTLibNativeModule.setAPI(net, defaultApi);
          }
          dbg(`=== Using default API for ${net}:`, defaultApi);
        }
      }
    });

    LocalCache.getItem('theme').then(appTheme => {
      setIsCryptoVibrant(appTheme === 'cryptoVibrant');
    });
  }, []);

  const toggleNetwork = async (value: boolean) => {
    // Haptic feedback for network toggle
    HapticFeedback.light();
    dbg('=== Network toggle started:', value ? 'testnet' : 'mainnet');
    const newNetwork = value ? 'testnet3' : 'mainnet';
    await setActiveNetwork(newNetwork);
    navigation.reset({index: 0, routes: [{name: 'Home'}]});
  };

  const resetAPI = async () => {
    dbg('resetAPI called');
    const net = await LocalCache.getItem('network');
    const api =
      net === 'mainnet'
        ? 'https://mempool.space/api' // MAINNET_APIS[0]
        : 'https://mempool.space/testnet/api'; // TESTNET_APIS[0]
    dbg('Resetting to default API for network:', net, 'API:', api);
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
    dbg('API reset and propagated successfully:', api);
  };

  const saveAPI = async (api: string) => {
    dbg('=== saveAPI called with:', api);
    try {
      // Update API via UserContext
      await setActiveApiProvider(api);
      // Update local state
      setBaseAPI(api);
      dbg('Local state updated with API:', api);
      dbg('=== API saved and propagated successfully:', api);
    } catch (error) {
      dbg('Error in saveAPI:', error);
    }
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
        dbg('app restart...');
        navigation.reset({index: 0, routes: [{name: 'Welcome'}]});
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
      Alert.alert(
        'Weak Password',
        'Please use a stronger password that meets all requirements.',
      );
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }

    try {
      // Haptic feedback
      HapticFeedback.light();

      const keyshare = await EncryptedStorage.getItem('keyshare');
      if (keyshare) {
        const json = JSON.parse(keyshare);
        const encryptedKeyshare = await BBMTLibNativeModule.aesEncrypt(
          keyshare,
          await BBMTLibNativeModule.sha256(password),
        );

        // Create friendly filename with date and time
        const now = new Date();
        const month = now.toLocaleDateString('en-US', {month: 'short'});
        const day = now.getDate().toString().padStart(2, '0');
        const year = now.getFullYear();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const shareName = json.local_party_key;
        const friendlyFilename = `${shareName}.${month}${day}.${year}.${hours}${minutes}.share`;

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
      } else {
        Alert.alert('Error', 'Invalid keyshare.');
      }
    } catch (error) {
      dbg('backup error', error);
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
      marginBottom: 8,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
      shadowColor: '#000',
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
      shadowColor: '#000',
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
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'flex-end',
    },
    apiModalContent: {
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: 10,
      borderTopRightRadius: 10,
      paddingBottom: Platform.OS === 'ios' ? 17 : 10,
      paddingTop: 5,
      shadowColor: '#000',
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
      color: '#FFFFFF',
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
      marginTop: 12,
    },
    apiName: {
      fontSize: 14,
      fontWeight: 'bold',
      color: theme.colors.primary,
      marginBottom: 4,
    },
    apiDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      lineHeight: 20,
      marginBottom: 6,
    },
    linkText: {
      color: theme.colors.primary,
      fontWeight: 'bold',
      textDecorationLine: 'underline',
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
      color: theme.colors.primary,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
    termsLink: {
      color: theme.colors.primary,
      fontWeight: 'bold',
      textDecorationLine: 'underline',
      marginTop: 8,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.8)',
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
      tintColor: theme.colors.primary,
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
      shadowColor: '#000',
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
      color: theme.colors.textSecondary,
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
      tintColor: '#ffffff',
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
        {/* Backup & Reset Section */}
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
        {/* Advanced Section */}
        <CollapsibleSection
          title="Advanced"
          isExpanded={expandedSections.advanced}
          onToggle={() => toggleSection('advanced')}
          styles={styles}
          theme={theme}>
          {/* Network Settings */}
          <Text style={styles.apiDescription}>Select Bitcoin Network</Text>
          <View style={styles.toggleContainer}>
            <View style={styles.networkOption}>
              <Image
                source={require('../assets/mainnet-icon.png')}
                style={styles.networkIcon}
                resizeMode="contain"
              />
              <Text style={styles.toggleLabel}>Mainnet</Text>
            </View>
            <Switch onValueChange={toggleNetwork} value={isTestnet} />
            <View style={styles.networkOption}>
              <Image
                source={require('../assets/testnet-icon.png')}
                style={styles.networkIcon}
                resizeMode="contain"
              />
              <Text style={styles.toggleLabel}>Testnet3</Text>
            </View>
          </View>

          {/* API Configuration */}
          <Text style={styles.apiDescription}>API Endpoint Configuration</Text>
          <APIAutocomplete
            value={baseAPI}
            onChangeText={saveAPI}
            isTestnet={isTestnet}
            styles={styles}
            theme={theme}
          />

          <TouchableOpacity
            style={[styles.button, styles.backupButton]}
            onPress={() => {
              HapticFeedback.light();
              setIsApiInfoVisible(true);
            }}>
            <View style={styles.buttonContent}>
              <Image
                source={require('../assets/about-icon.png')}
                style={[styles.buttonIcon, styles.whiteTint]}
                resizeMode="contain"
              />
              <Text style={styles.buttonText}>Why change the API?</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.resetButton]}
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
              <Text style={styles.buttonText}>Reset Default API</Text>
            </View>
          </TouchableOpacity>
        </CollapsibleSection>
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
            />
            <Text style={styles.toggleLabel}>Haptics On</Text>
          </View>
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
                  About API Endpoints
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
