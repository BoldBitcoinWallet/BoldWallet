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

// Function to fetch dynamic API endpoints from GitHub
const fetchDynamicAPIEndpoints = async (): Promise<string[]> => {
  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/BoldBitcoinWallet/mempool-space-hosts/refs/heads/main/README.md',
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const markdownText = await response.text();

    // Parse markdown to extract URLs
    const urlRegex = /https:\/\/[^\s\]]+/g;
    const urls = markdownText.match(urlRegex) || [];

    // Filter and format URLs to ensure they have /api suffix
    const apiEndpoints = urls
      .filter(url => url.includes('mempool'))
      .map(url => {
        // Remove trailing slash if present
        const cleanUrl = url.replace(/\/$/, '');
        // Add /api suffix if not already present
        return cleanUrl.endsWith('/api') ? cleanUrl : `${cleanUrl}/api`;
      })
      .filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates

    return apiEndpoints;
  } catch (error) {
    dbg('Failed to fetch dynamic API endpoints:', error);
    return MAINNET_APIS;
  }
};

import {
  dbg,
  HapticFeedback,
  setHapticsEnabled,
  areHapticsEnabled,
} from '../utils';
import {useTheme} from '../theme';
import {WalletService} from '../services/WalletService';
import LocalCache from '../services/LocalCache';
import LegalModal from '../components/LegalModal';

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
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);
  const [filteredOptions, setFilteredOptions] = useState<string[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [dynamicAPIs, setDynamicAPIs] = useState<string[]>([]);
  const [isLoadingAPIs, setIsLoadingAPIs] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const dropdownRef = useRef<View>(null);
  const dropdownAnimation = useRef(new Animated.Value(0)).current;

  // Get the appropriate API list - filter by network
  const predefinedAPIs = useMemo(() => {
    // Filter dynamic APIs by network
    if (dynamicAPIs.length > 0) {
      if (isTestnet) {
        // For testnet, only show APIs that contain "testnet" in the URL
        return dynamicAPIs.filter(api => api.toLowerCase().includes('testnet'));
      } else {
        // For mainnet, exclude APIs that contain "testnet"
        return dynamicAPIs.filter(
          api => !api.toLowerCase().includes('testnet'),
        );
      }
    }
    // Fallback to static APIs
    return isTestnet ? TESTNET_APIS : MAINNET_APIS;
  }, [isTestnet, dynamicAPIs]);

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
  }, [isTestnet, predefinedAPIs]);

  const handleTextChange = (text: string) => {
    onChangeText(text);

    if (text.length > 0) {
      const filtered = predefinedAPIs.filter(api =>
        api.toLowerCase().includes(text.toLowerCase()),
      );
      setFilteredOptions(filtered);
      setIsDropdownVisible(filtered.length > 0);
    } else {
      setFilteredOptions(predefinedAPIs);
      setIsDropdownVisible(true);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    setFilteredOptions(predefinedAPIs);
    setIsDropdownVisible(true);
    Animated.timing(dropdownAnimation, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const handleBlur = () => {
    setIsFocused(false);
    // Delay hiding dropdown to allow for option selection
    setTimeout(() => {
      if (isDropdownVisible) {
        setIsDropdownVisible(false);
        Animated.timing(dropdownAnimation, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }).start();
      }
    }, 300);
  };

  const selectOption = async (option: string) => {
    dbg('selectOption called with:', option);
    dbg('isSelecting:', isSelecting);

    if (isSelecting) {
      dbg('Already selecting, ignoring');
      return; // Prevent multiple rapid selections
    }

    dbg('Starting selection process');
    setIsSelecting(true);

    // First, hide dropdown and update UI state
    setIsDropdownVisible(false);
    setIsFocused(false);

    Animated.timing(dropdownAnimation, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start();

    // Update the value through the parent's onChangeText
    // This calls saveAPI which updates LocalCache and native module
    dbg('Calling onChangeText with:', option);
    await onChangeText(option);

    // Blur input and reset selecting state
    setTimeout(() => {
      inputRef.current?.blur();
      setIsSelecting(false);
      dbg('Selection process completed');
    }, 200);
  };

  const toggleDropdown = () => {
    if (isDropdownVisible) {
      setIsDropdownVisible(false);
      setIsFocused(false);
      Animated.timing(dropdownAnimation, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();
      inputRef.current?.blur();
    } else {
      setIsFocused(true);
      setFilteredOptions(predefinedAPIs);
      setIsDropdownVisible(true);
      Animated.timing(dropdownAnimation, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      inputRef.current?.focus();
    }
  };

  const getInputContainerStyle = () => {
    const baseStyle = [styles.apiInputContainer];
    if (isFocused) {
      baseStyle.push(styles.apiInputContainerFocused);
    }
    return baseStyle;
  };

  return (
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
        />
        <TouchableOpacity
          style={styles.apiDropdownButton}
          onPress={toggleDropdown}
          activeOpacity={0.6}>
          <Text style={[styles.apiDropdownIcon, {color: theme.colors.text}]}>
            {isDropdownVisible ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>
      </View>

      {isDropdownVisible && (
        <View
          style={styles.dropdownWrapper}
          onTouchStart={e => {
            dbg('Dropdown wrapper touch start');
            e.stopPropagation();
          }}
          onTouchMove={e => {
            dbg('Dropdown wrapper touch move');
            e.stopPropagation();
          }}
          onTouchEnd={e => {
            dbg('Dropdown wrapper touch end');
            e.stopPropagation();
          }}>
          <Animated.View
            ref={dropdownRef}
            style={[
              styles.apiDropdownList,
              {
                borderColor: theme.colors.border,
                opacity: dropdownAnimation,
                transform: [
                  {
                    translateY: dropdownAnimation.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-10, 0],
                    }),
                  },
                ],
              },
            ]}>
            <ScrollView
              style={styles.apiDropdownScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              nestedScrollEnabled={true}
              scrollEnabled={true}
              removeClippedSubviews={false}
              pointerEvents="auto"
              onTouchStart={e => {
                dbg('Dropdown ScrollView touch start');
                e.stopPropagation();
              }}
              onTouchMove={e => {
                dbg('Dropdown ScrollView touch move');
                e.stopPropagation();
              }}
              onTouchEnd={e => {
                dbg('Dropdown ScrollView touch end');
                e.stopPropagation();
              }}>
              {isLoadingAPIs && !isTestnet ? (
                <View
                  style={[
                    styles.apiDropdownItem,
                    {borderBottomColor: theme.colors.border},
                  ]}>
                  <Text
                    style={[
                      styles.apiDropdownItemText,
                      {color: theme.colors.textSecondary},
                      styles.loadingText,
                    ]}>
                    Loading API endpoints...
                  </Text>
                </View>
              ) : (
                filteredOptions.map((item, index) => (
                  <TouchableOpacity
                    key={`${item}-${index}`}
                    style={[
                      styles.apiDropdownItem,
                      {borderBottomColor: theme.colors.border},
                      index === filteredOptions.length - 1 &&
                        styles.apiDropdownItemLast,
                    ]}
                    onPress={() => {
                      dbg('Dropdown item pressed:', item);
                      selectOption(item);
                    }}
                    onPressIn={e => {
                      dbg('Dropdown item press in:', item);
                      e.stopPropagation();
                    }}
                    onPressOut={e => {
                      dbg('Dropdown item press out:', item);
                      e.stopPropagation();
                    }}
                    activeOpacity={0.7}
                    delayPressIn={0}
                    delayPressOut={0}
                    hitSlop={{top: 5, bottom: 5, left: 5, right: 5}}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${item}`}>
                    <Text
                      style={[
                        styles.apiDropdownItemText,
                        {color: theme.colors.text},
                      ]}>
                      {item}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </Animated.View>
        </View>
      )}
    </View>
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
  const {
    activeApiProvider: apiBase,
    setActiveNetwork,
    setActiveApiProvider,
  } = useUser();

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
    navigation.reset({index: 0, routes: [{name: 'Bold Home'}]});
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
        DeviceEventEmitter.emit('app:reload', {});
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
    scrollContent: {
      padding: 16,
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
      zIndex: 10000,
    },
    dropdownWrapper: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      zIndex: 10001,
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
    apiDropdownList: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      backgroundColor: theme.colors.cardBackground,
      borderWidth: 1,
      borderRadius: 8,
      borderTopWidth: 0,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      zIndex: 9999,
      elevation: 10,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.15,
      shadowRadius: 8,
      marginTop: -1,
      overflow: 'visible',
    },
    apiDropdownScroll: {
      maxHeight: 200,
    },
    apiDropdownItem: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      backgroundColor: theme.colors.cardBackground,
      minHeight: 44,
      justifyContent: 'center',
    },
    apiDropdownItemLast: {
      borderBottomWidth: 0,
    },
    apiDropdownItemText: {
      fontSize: 14,
      lineHeight: 18,
    },
    loadingText: {
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
    buttonText: {
      color: '#ffffff',
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
      backgroundColor: theme.colors.primary,
    },
    disabledButton: {
      backgroundColor: theme.colors.disabled,
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
        style={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}>
        {/* Backup & Reset Section */}
        <CollapsibleSection
          title="Security"
          isExpanded={expandedSections.backup}
          onToggle={() => toggleSection('backup')}
          styles={styles}
          theme={theme}>
          <Text style={styles.toggleDescription}>
            Secure your wallet with encrypted backups.
          </Text>

          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Backup Importance</Text>
            <Text style={styles.apiDescription}>
              Your keyshare is essential for wallet recovery. Without it, you
              cannot access your funds. Always create encrypted backups and
              store them securely.
            </Text>
          </View>
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
            <Text style={styles.apiName}>Security Best Practices</Text>
            <Text style={styles.apiDescription}>
              Store each keyshare in different locations (cloud storage,
              external drive) to eliminate single points of failure. Never store
              all keyshares in the same place.
            </Text>
          </View>

          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Reset Wallet</Text>
            <Text style={styles.apiDescription}>
              Permanently erase all wallet data from this device. This action
              cannot be undone. Make sure you have secure backups before
              proceeding.
            </Text>
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
          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Network Configuration</Text>
            <Text style={styles.apiDescription}>
              Switch between Bitcoin mainnet and testnet.
            </Text>
          </View>

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
          <View style={styles.apiItem}>
            <Text style={styles.apiName}>API Endpoint Configuration</Text>
            <Text style={styles.apiDescription}>
              Configure your preferred mempool API endpoint for blockchain data.
              {isTestnet ? ' (Testnet Mode)' : ' (Mainnet Mode)'}
            </Text>
          </View>

          <APIAutocomplete
            value={baseAPI}
            onChangeText={saveAPI}
            isTestnet={isTestnet}
            styles={styles}
            theme={theme}
          />

          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Privacy & Self-Hosted APIs</Text>
            <Text style={styles.apiDescription}>
              Using your own mempool.space instance enhances privacy by keeping
              your wallet queries off public servers. This prevents third
              parties from tracking your addresses, balances, and transaction
              patterns. Self-hosted APIs give you full control over your
              blockchain data access.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.button, styles.backupButton]}
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
              Clears locally cached data for balances and txs history.
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
                navigation.reset({index: 0, routes: [{name: 'Bold Home'}]});
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
            Enable or disable vibration feedback.{'\n'}OS level priority
            settings apply.
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
          <Text style={styles.apiName}>App Version</Text>
          <Text style={styles.apiDescription}>v{appVersion}</Text>

          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Mempool.Space APIs</Text>
            <Text style={styles.apiDescription}>
              We use Mempool.Space APIs for fetching balances, UTXOs,
              transaction history, and network fees estimations. For more info:{' '}
              <Text
                style={styles.linkText}
                onPress={() => {
                  HapticFeedback.light();
                  Linking.openURL('https://mempool.space/docs/api/rest');
                }}>
                API Docs
              </Text>
            </Text>
          </View>

          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Data and Security</Text>
            <Text style={styles.apiDescription}>
              We do not collect any personal data. BoldBitcoinWallet posses no
              backend. Wallet generation and transactions signing happen locally
              between your devices. Opensource mempool.space Self-Hosted APIs
              are supported to enhance your security and privacy.
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
              <Text style={styles.modalDescription}>
                Create an encrypted backup of your keyshare, protected by a
                strong password.
              </Text>

              <View style={styles.passwordContainer}>
                <Text style={styles.passwordLabel}>Choose Password</Text>
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
              confirm.{'\n'}This action is irreversible.
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
                  {isDeleting ? 'Deleting...' : 'Confirm'}
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
    </SafeAreaView>
  );
};

export default WalletSettings;
