import React, {useEffect, useState} from 'react';
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
} from 'react-native';
import Share from 'react-native-share';
import EncryptedStorage from 'react-native-encrypted-storage';
const {BBMTLibNativeModule} = NativeModules;
import DeviceInfo from 'react-native-device-info';

import {dbg} from '../utils';
import {useTheme} from '../theme';
import { WalletService } from '../services/WalletService';

const WalletSettings: React.FC<{navigation: any}> = ({navigation}) => {
  const [deleteInput, setDeleteInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isBackupModalVisible, setIsBackupModalVisible] = useState(false);
  const [isTestnet, setIsTestnet] = useState(true);
  const [party, setParty] = useState('');
  const [baseAPI, setBaseAPI] = useState('');
  const [isCryptoVibrant, setIsCryptoVibrant] = useState(false);

  const {theme, toggleTheme} = useTheme();
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    setAppVersion(DeviceInfo.getVersion());
  }, []);

  useEffect(() => {
    EncryptedStorage.getItem('keyshare').then(ks => {
      const json = JSON.parse(ks as string);
      setParty(json.local_party_key);
    });
    EncryptedStorage.getItem('network').then(net => {
      setIsTestnet(net !== 'mainnet');
    });
    EncryptedStorage.getItem('theme').then(appTheme => {
      setIsCryptoVibrant(appTheme === 'cryptoVibrant');
    });
    EncryptedStorage.getItem('api').then(api => {
      if (api) {
        setBaseAPI(api);
      }
    });
  }, []);

  const handleToggleTheme = (value: boolean) => {
    setIsCryptoVibrant(value);
    toggleTheme(value);
    navigation.reset({
      index: 0,
      routes: [{name: 'Bold Home'}],
    });
  };

  const toggleNetwork = (value: boolean) => {
    setIsTestnet(value);
    EncryptedStorage.setItem('network', value ? 'testnet3' : 'mainnet');
    if (baseAPI.indexOf('mempool.space') >= 0) {
      resetAPI();
    }
    navigation.reset({
      index: 0,
      routes: [{name: 'Bold Home'}],
    });
  };

  const resetAPI = async () => {
    EncryptedStorage.getItem('network').then(net => {
      if (net === 'mainnet') {
        const api = 'https://mempool.space/api';
        EncryptedStorage.setItem('api', api);
        BBMTLibNativeModule.setAPI(net, api);
        setBaseAPI(api);
      } else {
        const api = 'https://mempool.space/testnet/api';
        EncryptedStorage.setItem('api', api);
        BBMTLibNativeModule.setAPI(net, api);
        setBaseAPI(api);
      }
    });
  };

  const saveAPI = async (api: string) => {
    setBaseAPI(api);
    dbg('set baseAPI', api);
    EncryptedStorage.getItem('network').then(net => {
      EncryptedStorage.setItem('api', api);
      BBMTLibNativeModule.setAPI(net, api);
    });
  };

  const handleResetWallet = async () => {
    if (deleteInput.trim().toLowerCase() === 'delete my wallet') {
      try {
        setIsDeleting(true);
        setIsModalVisible(false);
        await EncryptedStorage.clear();
        WalletService.getInstance().clearCache();
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
    apiItem: {
      marginBottom: 8,
    },
    apiName: {
      fontSize: 14,
      fontWeight: 'bold',
      color: theme.colors.primary,
    },
    apiDescription: {
      fontSize: 14,
      color: '#2c3e50',
    },
    linkText: {
      color: theme.colors.primary,
      fontWeight: 'bold',
      textDecorationLine: 'underline',
    },
    container: {
      flex: 1,
      backgroundColor: theme.colors.primary,
    },
    inputAPI: {
      borderWidth: 1,
      borderColor: theme.colors.secondary,
      borderRadius: 8,
      padding: 12,
      maxHeight: 50,
      fontSize: 14,
      backgroundColor: '#FFF',
    },
    toggleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
    },
    networkLabel: {
      fontSize: 16,
      color: '#2c3e50',
    },
    scrollContent: {
      padding: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contentContainer: {
      padding: 8,
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      marginTop: 10,
      marginBottom: 24,
      color: theme.colors.white,
    },
    termsLink: {
      color: theme.colors.accent,
      fontWeight: 'bold',
      textAlign: 'center',
      textDecorationLine: 'underline',
      marginBottom: 10,
    },
    section: {
      marginBottom: 32,
      padding: 24,
      borderRadius: 8,
      backgroundColor: '#f8f9fa',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: 'bold',
      marginBottom: 12,
      color: '#34495e',
    },
    sectionDescription: {
      fontSize: 13,
      color: '#2c3e50',
      marginBottom: 16,
    },
    button: {
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: 12,
    },
    deleteButton: {
      backgroundColor: theme.colors.accent,
    },
    backupButton: {
      backgroundColor: theme.colors.secondary,
    },
    buttonText: {
      color: '#ffffff',
      fontSize: 16,
      fontWeight: '600',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.8)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalContent: {
      backgroundColor: '#ffffff',
      padding: 20,
      borderRadius: 8,
      width: '80%',
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 10,
      textAlign: 'center',
      color: '#34495e',
    },
    modalDescription: {
      fontSize: 14,
      color: '#2c3e50',
      marginBottom: 20,
      textAlign: 'center',
    },
    input: {
      borderWidth: 1,
      borderColor: '#7f8c8d',
      borderRadius: 8,
      padding: 14,
      marginBottom: 16,
      textAlign: 'center',
      fontSize: 16,
      color: '#2c3e50',
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
    saveResetButtons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 20,
    },
    saveButton: {
      flex: 1,
      backgroundColor: theme.colors.primary,
      padding: 15,
      borderRadius: 8,
      alignItems: 'center',
      marginRight: 10,
    },
    resetButton: {
      flex: 1,
      backgroundColor: theme.colors.secondary,
      padding: 15,
      borderRadius: 8,
      alignItems: 'center',
      marginLeft: 10,
    },
    cancelButton: {
      backgroundColor: theme.colors.secondary,
    },
    confirmButton: {
      backgroundColor: theme.colors.accent,
    },
    halfOpacity: {
      opacity: 0.5,
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.contentContainer}>
          {/* Theme */}
          <Text style={styles.title}>Theme</Text>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Your Theme</Text>
            <View style={styles.toggleContainer}>
              <Text style={styles.networkLabel}>Light Polished</Text>
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
              <Text style={styles.networkLabel}>Crypto Vibrant</Text>
            </View>
          </View>

          {/* Network */}
          <Text style={styles.title}>Network</Text>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Network</Text>
            <View style={styles.toggleContainer}>
              <Text style={styles.networkLabel}>Mainnet</Text>
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
              <Text style={styles.networkLabel}>Testnet3</Text>
            </View>
          </View>

          <Text style={styles.title}>Backup & Reset</Text>

          {/* Backup Wallet Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Backup Wallet Keyshare</Text>
            <Text style={styles.sectionDescription}>
              To recover your wallet, you need to backup both keyshares
              generated on both devices. Without both shares, you can never
              restore your wallet.
            </Text>
            <TouchableOpacity
              style={[styles.button, styles.backupButton]}
              onPress={() => setIsBackupModalVisible(true)}>
              <Text style={styles.buttonText}>Backup {party}</Text>
            </TouchableOpacity>
          </View>

          {/* Delete Wallet Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Factory Reset Wallet</Text>
            <Text style={styles.sectionDescription}>
              Always ensure your two keyshares are backed up. If you lose one of
              your keyshares, your wallet cannot be recovered. This
              irreversible.
            </Text>
            <TouchableOpacity
              style={[styles.button, styles.deleteButton]}
              onPress={() => setIsModalVisible(true)}>
              <Text style={styles.buttonText}>Delete {party}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.title}>Advanced</Text>
          {/* API Wallet Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>API Base</Text>
            <Text style={styles.sectionDescription}>
              Point to your own APIs, compatible with Mempool.space only. Reset
              to default if that's not compatible or you don't know what you're
              doing.
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
          </View>

          <Text style={styles.title}>About</Text>
          {/* App version Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>App Version</Text>
            <Text style={styles.sectionDescription}>{appVersion}</Text>
          </View>

          <Text style={styles.title}>Privacy & Terms </Text>
          {/* APIs and Services Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>APIs and Services</Text>
            <Text style={styles.sectionDescription}>
              This app uses the following services:
            </Text>
            <View style={styles.apiItem}>
              <Text style={styles.apiName}>Mempool.Space APIs</Text>
              <Text style={styles.apiDescription}>
                We use Mempool.Space APIs for fetching balances, UTXOs,
                transaction history, and network fees estimations. For more
                info:{' '}
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
                backend. Wallet generation and transactions signing happen
                locally between your devices. Opensource mempool.space
                Self-Hosted APIs are supported to enhance your security and
                privacy.
              </Text>
            </View>
          </View>

          {/* Terms of Use */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Terms of Use</Text>
            <Text style={styles.sectionDescription}>
              Please review our terms to understand your rights and
              responsibilities while using this app.
            </Text>
            <Text
              style={styles.termsLink}
              onPress={() =>
                Linking.openURL('https://boldbitcoinwallet.com/#terms')
              }>
              Read Terms of Use
            </Text>

            {/* Privacy Policy */}

            <Text style={styles.sectionTitle}>Privacy Policy</Text>
            <Text style={styles.sectionDescription}>
              Learn more about how we handle your privacy and security.
            </Text>
            <Text
              style={styles.termsLink}
              onPress={() =>
                Linking.openURL('https://boldbitcoinwallet.com/#terms')
              }>
              Read Privacy Policy
            </Text>
          </View>

          {/* Modal for Backup Keyshare */}
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
                  placeholderTextColor="#7f8c8d"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm Password"
                  placeholderTextColor="#7f8c8d"
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

          {/* Custom Prompt Modal */}
          <Modal
            visible={isModalVisible}
            transparent={true}
            animationType="fade"
            onRequestClose={() => setIsModalVisible(false)}>
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
                  placeholderTextColor="#7f8c8d"
                  value={deleteInput}
                  onChangeText={setDeleteInput}
                />
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={() => setIsModalVisible(false)}>
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
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default WalletSettings;
