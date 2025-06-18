import React, {useEffect, useState, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
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
} from 'react-native';
import Share from 'react-native-share';
import EncryptedStorage from 'react-native-encrypted-storage';
const {BBMTLibNativeModule} = NativeModules;
import DeviceInfo from 'react-native-device-info';

import {dbg, HapticFeedback} from '../utils';
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
  const animatedOpacity = useRef(new Animated.Value(0)).current;
  const animatedRotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isExpanded) {
      // Expand animation
      Animated.parallel([
        Animated.timing(animatedOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(animatedRotation, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Collapse animation
      Animated.parallel([
        Animated.timing(animatedOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(animatedRotation, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isExpanded, animatedOpacity, animatedRotation]);

  const rotateInterpolate = animatedRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const handlePress = () => {
    // Haptic feedback
    HapticFeedback.light();
    onToggle();
  };

  return (
    <View
      style={[
        styles.collapsibleSection,
        isExpanded && {borderWidth: 2, borderColor: theme.colors.primary},
      ]}>
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
            {color: theme.colors.text},
            {transform: [{rotate: rotateInterpolate}]},
          ]}>
          ▶
        </Animated.Text>
      </TouchableOpacity>

      {isExpanded && (
        <Animated.View
          style={[
            styles.sectionContent,
            {
              opacity: animatedOpacity,
            },
          ]}>
          {children}
        </Animated.View>
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
    case 'backup & reset':
      return require('../assets/backup-icon.png');
    case 'advanced':
      return require('../assets/advanced-icon.png');
    case 'about':
      return require('../assets/about-icon.png');
    case 'legal':
      return require('../assets/legal-icon.png');
    default:
      return require('../assets/advanced-icon.png');
  }
};

const WalletSettings: React.FC<{navigation: any}> = ({navigation}) => {
  const [deleteInput, setDeleteInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isModalResetVisible, setIsModalResetVisible] = useState(false);
  const [isBackupModalVisible, setIsBackupModalVisible] = useState(false);
  const [isTestnet, setIsTestnet] = useState(true);
  const [party, setParty] = useState('');
  const [baseAPI, setBaseAPI] = useState('');
  const [isCryptoVibrant, setIsCryptoVibrant] = useState(false);
  const [isLegalModalVisible, setIsLegalModalVisible] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy'>(
    'terms',
  );

  // Collapsible states
  const [expandedSections, setExpandedSections] = useState<{
    [key: string]: boolean;
  }>({
    theme: false,
    network: false,
    backup: false,
    advanced: false,
    about: false,
    legal: false,
  });

  const {theme, toggleTheme} = useTheme();
  const [appVersion, setAppVersion] = useState('');

  const toggleSection = (section: string) => {
    // Haptic feedback for section toggle
    HapticFeedback.medium();

    setExpandedSections(prev => {
      const newState = Object.keys(prev).reduce((acc, key) => {
        acc[key] = false; // Close all sections
        return acc;
      }, {} as {[key: string]: boolean});

      // Open only the clicked section if it wasn't already open
      if (!prev[section]) {
        newState[section] = true;
      }

      return newState;
    });
  };

  useEffect(() => {
    setAppVersion(DeviceInfo.getVersion());
  }, []);

  useEffect(() => {
    EncryptedStorage.getItem('keyshare').then(ks => {
      const json = JSON.parse(ks as string);
      setParty(json.local_party_key);
    });
    LocalCache.getItem('network').then(net => {
      setIsTestnet(net !== 'mainnet');
    });
    LocalCache.getItem('theme').then(appTheme => {
      setIsCryptoVibrant(appTheme === 'cryptoVibrant');
    });
    LocalCache.getItem('api').then(api => {
      if (api) {
        setBaseAPI(api);
      }
    });
  }, []);

  const handleToggleTheme = (value: boolean) => {
    // Haptic feedback for theme toggle
    HapticFeedback.light();

    setIsCryptoVibrant(value);
    toggleTheme(value);
    navigation.reset({
      index: 0,
      routes: [{name: 'Bold Home'}],
    });
  };

  const toggleNetwork = async (value: boolean) => {
    // Haptic feedback for network toggle
    HapticFeedback.light();

    setIsTestnet(value);
    const network = value ? 'testnet3' : 'mainnet';
    await LocalCache.setItem('network', network);

    if (baseAPI.indexOf('mempool.space') >= 0) {
      const api = value
        ? 'https://mempool.space/testnet/api'
        : 'https://mempool.space/api';
      await LocalCache.setItem('api', api);
      await BBMTLibNativeModule.setAPI(network, api);
      setBaseAPI(api);

      // Update WalletService with new network and API
      await WalletService.getInstance().clearWalletCache();
      await WalletService.getInstance().handleNetworkChange(network, api);
    }

    navigation.reset({
      index: 0,
      routes: [{name: 'Bold Home'}],
    });
  };

  const resetAPI = async () => {
    LocalCache.getItem('network').then(net => {
      if (net === 'mainnet') {
        const api = 'https://mempool.space/api';
        LocalCache.setItem('api', api);
        BBMTLibNativeModule.setAPI(net, api);
        setBaseAPI(api);
      } else {
        const api = 'https://mempool.space/testnet/api';
        LocalCache.setItem('api', api);
        BBMTLibNativeModule.setAPI(net, api);
        setBaseAPI(api);
      }
    });
  };

  const saveAPI = async (api: string) => {
    setBaseAPI(api);
    dbg('set baseAPI', api);
    LocalCache.getItem('network').then(net => {
      LocalCache.setItem('api', api);
      BBMTLibNativeModule.setAPI(net, api);
    });
  };

  const handleResetWallet = async () => {
    if (deleteInput.trim().toLowerCase() === 'delete my wallet') {
      try {
        setIsDeleting(true);
        setIsModalResetVisible(false);
        await EncryptedStorage.clear();
        await LocalCache.clear();
        navigation.reset({
          index: 0,
          routes: [{name: 'Showcase'}],
        });
      } catch (error) {
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

  const normalizeAlphaNumUnderscore = (input: string): string => {
    return input.replace(/[^a-zA-Z0-9]/g, '_');
  };

  const handleBackupWallet = async () => {
    if (!password || !confirmPassword) {
      Alert.alert(
        'Password Required',
        'Please enter and verify your password.',
      );
      return;
    }
    try {
      const keyshare = await EncryptedStorage.getItem('keyshare');
      if (keyshare) {
        const json = JSON.parse(keyshare);
        const encryptedKeyshare = await BBMTLibNativeModule.aesEncrypt(
          keyshare,
          await BBMTLibNativeModule.sha256(password),
        );
        await Share.open({
          title: 'Backup Your Keyshare',
          isNewTask: true,
          message:
            'Save this encrypted file securely. It is required for wallet recovery.',
          url: `data:text/plain;base64,${encryptedKeyshare}`,
          type: 'text/plain',
          filename: `${json.local_party_key.toLocaleLowerCase()}_${normalizeAlphaNumUnderscore(
            new Date().toLocaleString(),
          )}.share`,
          failOnCancel: false,
        });
        setIsBackupModalVisible(false);
      } else {
        Alert.alert('Error', 'Invalid keyshare.');
      }
    } catch (error) {
      console.error('Error encrypting or sharing keyshare:', error);
      Alert.alert('Error', 'Failed to encrypt or share the keyshare.');
    }
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
      padding: 12,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
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
    },
    button: {
      paddingVertical: 10,
      borderRadius: 6,
      alignItems: 'center',
      marginTop: 6,
    },
    deleteButton: {
      backgroundColor: theme.colors.danger,
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
    modalTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 10,
      textAlign: 'center',
      color: theme.colors.text,
    },
    modalDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 20,
      textAlign: 'center',
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
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    modalButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      marginHorizontal: 8,
      alignItems: 'center',
    },
    cancelButton: {
      backgroundColor: theme.colors.secondary,
    },
    confirmButton: {
      backgroundColor: theme.colors.primary,
    },
    halfOpacity: {
      opacity: 0.5,
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
  });

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Theme Section */}
        <CollapsibleSection
          title="Theme"
          isExpanded={expandedSections.theme}
          onToggle={() => toggleSection('theme')}
          styles={styles}
          theme={theme}>
          <Text style={styles.toggleDescription}>
            Choose your preferred app theme
          </Text>
          <View style={styles.toggleContainer}>
            <Text style={styles.toggleLabel}>Light Polished</Text>
            <Switch
              trackColor={{
                true: theme.colors.primary,
                false: theme.colors.secondary,
              }}
              thumbColor={theme.colors.accent}
              ios_backgroundColor={theme.colors.disabled}
              onValueChange={handleToggleTheme}
              value={isCryptoVibrant}
            />
            <Text style={styles.toggleLabel}>Crypto Vibrant</Text>
          </View>
        </CollapsibleSection>

        {/* Network Section */}
        <CollapsibleSection
          title="Network"
          isExpanded={expandedSections.network}
          onToggle={() => toggleSection('network')}
          styles={styles}
          theme={theme}>
          <Text style={styles.toggleDescription}>
            Switch between Bitcoin mainnet and testnet. Testnet allows you to test the wallet with test coins that have no real value.
          </Text>
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
                false: theme.colors.accent,
              }}
              thumbColor={theme.colors.accent}
              ios_backgroundColor={theme.colors.secondary}
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
        </CollapsibleSection>

        {/* Backup & Reset Section */}
        <CollapsibleSection
          title="Backup & Reset"
          isExpanded={expandedSections.backup}
          onToggle={() => toggleSection('backup')}
          styles={styles}
          theme={theme}>
          <Text style={styles.toggleDescription}>
            Secure your wallet with encrypted backups and manage wallet data
          </Text>

          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Backup Importance</Text>
            <Text style={styles.apiDescription}>
              Your keyshare is essential for wallet recovery. Without it, you cannot access your funds. Always create encrypted backups and store them securely.
            </Text>
          </View>

          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Security Best Practices</Text>
            <Text style={styles.apiDescription}>
              Store each keyshare in different locations (cloud storage, external drive) to eliminate single points of failure. Never store all keyshares in the same place.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.button, styles.backupButton]}
            onPress={() => setIsBackupModalVisible(true)}>
            <Text style={styles.buttonText}>Backup {party}</Text>
          </TouchableOpacity>

          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Reset Wallet</Text>
            <Text style={styles.apiDescription}>
              Permanently erase all wallet data from this device. This action cannot be undone. Make sure you have secure backups before proceeding.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.button, styles.deleteButton]}
            onPress={() => setIsModalResetVisible(true)}>
            <Text style={styles.buttonText}>Delete {party}</Text>
          </TouchableOpacity>
        </CollapsibleSection>

        {/* Advanced Section */}
        <CollapsibleSection
          title="Advanced"
          isExpanded={expandedSections.advanced}
          onToggle={() => toggleSection('advanced')}
          styles={styles}
          theme={theme}>
          <Text style={styles.toggleDescription}>
            Configure advanced settings and API endpoints
          </Text>

          <TextInput
            style={styles.inputAPI}
            returnKeyType="done"
            value={baseAPI}
            onChangeText={saveAPI}
            placeholder="Your Mempool Endpoint"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TouchableOpacity
            style={[styles.button, styles.backupButton]}
            onPress={() => resetAPI()}>
            <Text style={styles.buttonText}>Reset Default</Text>
          </TouchableOpacity>

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
        </CollapsibleSection>

        {/* About Section */}
        <CollapsibleSection
          title="About"
          isExpanded={expandedSections.about}
          onToggle={() => toggleSection('about')}
          styles={styles}
          theme={theme}>
          <Text style={styles.toggleDescription}>
            App information and version details
          </Text>
          <Text style={styles.apiDescription}>Version: {appVersion}</Text>

          <View style={styles.apiItem}>
            <Text style={styles.apiName}>Mempool.Space APIs</Text>
            <Text style={styles.apiDescription}>
              We use Mempool.Space APIs for fetching balances, UTXOs,
              transaction history, and network fees estimations. For more info:{' '}
              <Text
                style={styles.linkText}
                onPress={() =>
                  Linking.openURL('https://mempool.space/docs/api/rest')
                }>
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
              setLegalModalType('terms');
              setIsLegalModalVisible(true);
            }}>
            Read Terms of Use
          </Text>

          <Text
            style={styles.termsLink}
            onPress={() => {
              setLegalModalType('privacy');
              setIsLegalModalVisible(true);
            }}>
            Read Privacy Policy
          </Text>
        </CollapsibleSection>
      </ScrollView>

      {/* Modals */}
      <Modal
        visible={isBackupModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsBackupModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Backup Keyshare</Text>
            <Text style={styles.modalDescription}>
              Enter and confirm your password to encrypt your keyshare.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Enter Password"
              placeholderTextColor={theme.colors.textSecondary}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm Password"
              placeholderTextColor={theme.colors.textSecondary}
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setIsBackupModalVisible(false)}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={handleBackupWallet}>
                <Text style={styles.buttonText}>Backup</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isModalResetVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsModalResetVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Confirm Wallet Deletion</Text>
            <Text style={styles.modalDescription}>
              Type "delete my wallet" to confirm.{'\n'}This action is
              irreversible.
            </Text>
            <TextInput
              style={styles.input}
              placeholder='Type "delete my wallet"'
              placeholderTextColor={theme.colors.textSecondary}
              value={deleteInput}
              onChangeText={setDeleteInput}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setIsModalResetVisible(false)}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.confirmButton,
                  isDeleting && styles.halfOpacity,
                ]}
                onPress={handleResetWallet}
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
        onClose={() => setIsLegalModalVisible(false)}
        type={legalModalType}
      />
    </SafeAreaView>
  );
};

export default WalletSettings;
