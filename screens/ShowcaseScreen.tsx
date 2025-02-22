import {CommonActions} from '@react-navigation/native';
import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  NativeModules,
  Modal,
  TextInput,
  Button,
  Linking,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import EncryptedStorage from 'react-native-encrypted-storage';
import RNFS from 'react-native-fs';
import theme from '../theme';
import { dbg } from '../utils';

const {BBMTLibNativeModule} = NativeModules;

const ShowcaseScreen = ({navigation}: any) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.cubic,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0.7,
          duration: 1000,
          easing: Easing.cubic,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [fadeAnim]);

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
      dbg('Error handling content URI:', error);
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
        dbg('User cancelled the picker');
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
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>
            Seedless.{'\n'}Hardware-Free.{'\n'}Limitless.
          </Text>
          <Animated.Image
            style={[styles.storeIcon, {opacity: fadeAnim}]}
            source={require('../assets/playstore-icon.png')}
          />
          <Text style={styles.heroSubtitle}>
            Roam the world with Peace of Mind {'\n'}
            Self-Custody Superior ₿itcoin Wallet
          </Text>
        </View>
      </ScrollView>

      <View style={styles.bottomActions}>
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
                Linking.openURL('https://boldbitcoinwallet.com/#terms')
              }>
              Terms and Conditions
            </Text>
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
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.colors.primary,
    marginTop: 0,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 16,
    color: theme.colors.secondary,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  storeIcon: {
    width: 128,
    height: 128,
  },
  bottomActions: {
    alignItems: 'center',
    width: '100%',
    marginBottom: 10,
  },
  ctaButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 15,
    marginBottom: 20,
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
    marginBottom: 20,
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
