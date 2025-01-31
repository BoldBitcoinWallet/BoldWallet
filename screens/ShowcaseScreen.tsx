import {CommonActions} from '@react-navigation/native';
import React, {useState} from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Alert,
  NativeModules,
  Modal,
  TextInput,
  Button,
  Linking,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import EncryptedStorage from 'react-native-encrypted-storage';
import RNFS from 'react-native-fs';
import theme from '../theme';

const {BBMTLibNativeModule} = NativeModules;

const ShowcaseScreen = ({navigation}: any) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false); // Track if checkbox is checked

  const handleContentUri = async (uri: any) => {
    try {
      const localFilePath = `${RNFS.DocumentDirectoryPath}/tempFile.txt`;

      // Check if the file already exists and delete it if it does
      if (await RNFS.exists(localFilePath)) {
        await RNFS.unlink(localFilePath);
      }

      // Copy the file to a local path
      await RNFS.copyFile(uri, localFilePath);

      // Read the file content as base64
      const content = await RNFS.readFile(localFilePath, 'base64');

      // Clean up the temporary file
      await RNFS.unlink(localFilePath);

      return content;
    } catch (error) {
      console.log('Error handling content URI:', error);
      return '';
    }
  };

  // Handle the restore wallet process
  const handleRestoreWallet = async () => {
    try {
      const res = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.allFiles],
      });
      const uri = `${res.uri}`;

      let content = await handleContentUri(uri);
      setFileContent(content);
      setModalVisible(true);
    } catch (err: any) {
      if (DocumentPicker.isCancel(err)) {
        console.log('User cancelled the picker');
      } else {
        console.error('Error reading file:', err.message || err);
        Alert.alert('Error', 'Failed to read the file');
      }
    }
  };

  const handlePasswordSubmit = async () => {
    try {
      const decryptedKeyshare = await BBMTLibNativeModule.aesDecrypt(
        fileContent,
        await BBMTLibNativeModule.sha256(password),
      );
      if (decryptedKeyshare.indexOf('pub_key') < 0) {
        Alert.alert('Wrong Password', 'Could not import keyshare');
      } else {
        await EncryptedStorage.setItem('keyshare', decryptedKeyshare);
        setModalVisible(false);
        setPassword('');
        setTimeout(() => {
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{name: 'Bold Home'}],
            }),
          );
        }, 1000);
      }
    } catch (decodeError) {
      console.warn('Failed to decode as UTF-8. File might be binary.');
      Alert.alert('Error', 'Failed to decrypt the file');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.heroSection}>
        <Text style={styles.heroTitle}>
          Seedless.{'\n'}Hardware-Free.{'\n'}Limitless.
        </Text>
        <Image
          style={styles.storeIcon}
          source={require('../assets/playstore-icon.png')}
        />
        <Text style={styles.heroSubtitle}>
          Roam the world with Peace of Mind {'\n'}Self-Custody MPC Powered
          Bitcoin Wallet
        </Text>
      </View>

      <View style={styles.ctaButtons}>
        <TouchableOpacity
          style={[styles.ctaButton, !agreeToTerms && styles.disabledButton]}
          onPress={() => navigation.navigate('📱📱 Pairing')}
          disabled={!agreeToTerms}>
          <Text style={styles.ctaButtonText}>Setup Wallet</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.ctaButtonRestore,
            !agreeToTerms && styles.disabledButton,
          ]}
          onPress={handleRestoreWallet}
          disabled={!agreeToTerms}>
          <Text style={styles.ctaButtonText}>Restore Wallet</Text>
        </TouchableOpacity>
      </View>

      {/* Terms and Checkbox */}
      <View style={styles.termsContainer}>
        <Text style={styles.termsText}>By Using Bold</Text>
      </View>
      <View style={styles.termsContainer}>
        <TouchableOpacity
          style={styles.checkboxContainer}
          onPress={() => setAgreeToTerms(prev => !prev)}>
          <View
            style={[styles.checkbox, agreeToTerms && styles.checkboxChecked]}
          />
        </TouchableOpacity>
        <Text style={styles.termsText}>
          You agree to our{' '}
          <Text
            style={styles.termsLink}
            onPress={() =>
              Linking.openURL('https://boldbitcoin.github.io/welcome#terms')
            }>
            Terms and Conditions
          </Text>
        </Text>
      </View>

      {/* Password Prompt Modal */}
      <Modal
        transparent={true}
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter Password</Text>
            <TextInput
              style={styles.passwordInput}
              secureTextEntry
              placeholder="Keyshare file password"
              value={password}
              onChangeText={setPassword}
            />
            <View style={styles.modalActions}>
              <Button
                color={theme.colors.secondary}
                title="Cancel"
                onPress={() => setModalVisible(false)}
              />
              <Button
                color={theme.colors.primary}
                title="Submit"
                onPress={handlePasswordSubmit}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  heroSection: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: theme.colors.primary,
    marginTop: 80,
    marginBottom: 10,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 18,
    color: theme.colors.secondary,
    maxWidth: 600,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
  },
  storeIcon: {
    width: 200,
    height: 200,
    marginBottom: 30,
  },
  ctaButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 15,
    bottom: 40,
    position: 'absolute',
    width: '100%',
  },
  ctaButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: 4,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    width: 160,
  },
  ctaButtonRestore: {
    backgroundColor: theme.colors.accent,
    borderRadius: 4,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    width: 160,
  },
  ctaButtonText: {
    color: theme.colors.background,
    fontWeight: '800',
    fontSize: 16,
  },
  disabledButton: {
    opacity: 0.5,
  },
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  termsText: {
    fontSize: 14,
    color: theme.colors.text,
  },
  termsLink: {
    color: theme.colors.accent,
    textDecorationLine: 'underline',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: theme.colors.text,
    borderRadius: 4,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.primary,
  },
  checkboxLabel: {
    marginLeft: 5,
    fontSize: 14,
    color: theme.colors.text,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
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
  passwordInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 10,
    marginBottom: 15,
    textAlign: 'center',
    fontSize: 17,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
});

export default ShowcaseScreen;
