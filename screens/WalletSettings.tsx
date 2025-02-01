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

import theme from '../theme';

const WalletSettings: React.FC<{navigation: any}> = ({navigation}) => {
  const [deleteInput, setDeleteInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isBackupModalVisible, setIsBackupModalVisible] = useState(false);
  const [isTestnet, setIsTestnet] = useState(true); // Track network type
  const [party, setParty] = useState('');

  useEffect(() => {
    EncryptedStorage.getItem('keyshare').then(ks => {
      const json = JSON.parse(ks as string);
      setParty(json.local_party_key);
    });
    EncryptedStorage.getItem('network').then(net => {
      setIsTestnet(net !== 'mainnet');
    });
  }, []);

  const toggleNetwork = (value: boolean) => {
    setIsTestnet(value);
    EncryptedStorage.setItem('network', value ? 'testnet3' : 'mainnet');
    navigation.reset({
      index: 0,
      routes: [{name: 'Bold Home'}],
    });
  };

  const handleResetWallet = async () => {
    if (deleteInput.trim() === 'delete my wallet') {
      try {
        setIsDeleting(true);
        setIsModalVisible(false);
        await EncryptedStorage.clear();
        navigation.reset({
          index: 0,
          routes: [{name: 'Bold BTC Wallet'}],
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.contentContainer}>
          <Text style={styles.title}>Settings</Text>

          {/* Network */}
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
              Always ensure your two keyshares are backed up. If you lose your
              share, your wallet cannot be recovered. This irreversible.
            </Text>
            <TouchableOpacity
              style={[styles.button, styles.deleteButton]}
              onPress={() => setIsModalVisible(true)}>
              <Text style={styles.buttonText}>Delete {party}</Text>
            </TouchableOpacity>
          </View>

          {/* APIs and Services Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>APIs and Services</Text>
            <Text style={styles.sectionDescription}>
              This app uses the following services:
            </Text>
            <View style={styles.apiItem}>
              <Text style={styles.apiName}>Blockstream APIs</Text>
              <Text style={styles.apiDescription}>
                We use Blockstream APIs for fetching balances, UTXOs,
                transaction history, and network fees estimations. For more
                info:
                {'\n'}
                <Text
                  style={styles.linkText}
                  onPress={() =>
                    Linking.openURL(
                      'https://github.com/blockstream/esplora/blob/master/API.md',
                    )
                  }>
                  Blockstream/esplora/blob/master/API.md
                </Text>
              </Text>
            </View>
            <View style={styles.apiItem}>
              <Text style={styles.apiName}>CoinDesk APIs</Text>
              <Text style={styles.apiDescription}>
                We use CoinDesk APIs to get the latest Bitcoin price:
                {'\n'}
                <Text
                  style={styles.linkText}
                  onPress={() =>
                    Linking.openURL(
                      'https://api.coindesk.com/v1/bpi/currentprice/BTC.json',
                    )
                  }>
                  Coindesk Bitcoin USD Price Index
                </Text>
              </Text>
            </View>
          </View>

          {/* Data collection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Data Collection</Text>
            <Text style={styles.sectionDescription}>
              We do not collect any user data. All information is fetched in
              real-time from external APIs, and no personal data is stored or
              shared.
            </Text>
            <Text
              style={styles.termsLink}
              onPress={() =>
                Linking.openURL('https://boldbitcoin.github.io/welcome#terms')
              }>
              Terms and Conditions
            </Text>
          </View>

          {/* Modal for Backup Keyshare */}
          <Modal
            visible={isBackupModalVisible}
            transparent={true}
            animationType="slide"
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
            animationType="slide"
            onRequestClose={() => setIsModalVisible(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Confirm Wallet Deletion</Text>
                <Text style={styles.modalDescription}>
                  Type "delete my wallet" to confirm. This action is
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

const styles = StyleSheet.create({
  apiItem: {
    marginBottom: 16,
  },
  apiName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  apiDescription: {
    fontSize: 14,
    color: '#2c3e50',
  },
  linkText: {
    color: theme.colors.primary,
    textDecorationLine: 'underline',
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.primary,
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
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    color: theme.colors.white,
  },
  termsLink: {
    color: theme.colors.accent,
    fontWeight: 'bold',
    textAlign: 'center',
    textDecorationLine: 'underline',
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
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#34495e',
  },
  sectionDescription: {
    fontSize: 14,
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
    backgroundColor: 'rgba(0,0,0,0.5)',
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
  cancelButton: {
    backgroundColor: '#7f8c8d',
  },
  confirmButton: {
    backgroundColor: '#e74c3c',
  },
  halfOpacity: {
    opacity: 0.5,
  },
});

export default WalletSettings;
