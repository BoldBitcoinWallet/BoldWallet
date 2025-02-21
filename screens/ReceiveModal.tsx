import React, {useCallback, useRef, useState} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Image,
  Linking,
} from 'react-native';
import theme from '../theme';
import Toast from 'react-native-toast-message';
import QRCode from 'react-native-qrcode-svg';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import * as RNFS from 'react-native-fs';
import { dbg } from '../utils';

const ReceiveModal: React.FC<{
  visible: boolean;
  address: string;
  baseApi: string;
  network: string;
  onClose: () => void;
}> = ({visible, address, baseApi, network, onClose}) => {
  const [base64Image, setBase64Image] = useState('');

  const copyToClipboard = useCallback(() => {
    Toast.show({
      type: 'success',
      text1: 'Address Copied to Clipboard',
      position: 'top',
      visibilityTime: 325,
    });
    Clipboard.setString(address);
  }, [address]);

  async function shareQRCode() {
    dbg('shareQRCode...');
    try {
      dbg('Sharing QR');
      const filePath = `${RNFS.TemporaryDirectoryPath}/bitcoin-${network}-address.jpg`;
      // Check if the file already exists
      const fileExists = await RNFS.exists(filePath);
      if (fileExists) {
        dbg('File Delete.');
        await RNFS.unlink(filePath);
      }
      dbg('File write.');
      await RNFS.writeFile(filePath, base64Image, 'base64');
      Share.open({
        title: 'Bitcoin Receive Address',
        message: `${address}`,
        url: `file://${filePath}`,
        subject: `Bitcoin ${network} Wallet Address`,
        isNewTask: true,
        failOnCancel: false,
      })
        .then(result => {
          dbg('Result sharing', result);
        })
        .catch((e: any) => {
          console.error('Error sharing', e);
        })
        .finally(() => {
          RNFS.unlink(filePath);
        });
    } catch (error) {
      console.error('Error preparing image for share:', error);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <Text style={styles.textReceive}>
            🌐 {network === 'mainnet' ? 'Mainnnet' : 'Testnet'} / Bitcoin /
            Address
          </Text>

          {/* Close Button */}
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✖️</Text>
          </TouchableOpacity>

          {/* QR Code */}
          <TouchableOpacity style={styles.qrContainer} onPress={shareQRCode}>
            <QRCode
              value={address}
              size={200}
              getRef={c => {
                setTimeout(() => {
                  c?.toDataURL((base64Data: any) => {
                    if (base64Data) {
                      dbg('setting base64Data');
                      setBase64Image(base64Data);
                    }
                  });
                }, 500);
              }}
            />
          </TouchableOpacity>

          {/* Address and Copy Button */}
          <View style={styles.addressContainer}>
            <Text
              style={styles.addressText}
              onPress={() =>
                Linking.openURL(
                  `${baseApi.replace('api', '')}address/${address}`,
                )
              }>
              {address}
            </Text>
            <TouchableOpacity
              onPress={copyToClipboard}
              style={styles.iconContainer}>
              <Image
                source={require('../assets/paste-icon.png')}
                style={styles.iconImage}
                resizeMode="contain"
              />
            </TouchableOpacity>
          </View>
          <Toast />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  modalContent: {
    backgroundColor: theme.colors.white,
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    width: '90%',
  },
  textReceive: {
    position: 'absolute',
    top: 20,
    left: 20,
    padding: 8,
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: theme.colors.cardBackground,
    padding: 8,
    color: theme.colors.accent,
    borderRadius: 50,
  },
  closeButtonText: {
    fontSize: 16,
  },
  qrContainer: {
    marginTop: 60,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  addressText: {
    fontSize: 13,
    textDecorationLine: 'underline',
    color: theme.colors.primary,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  iconContainer: {
    paddingLeft: 10,
  },
  iconImage: {
    width: 24,
    height: 24,
  },
  button: {
    backgroundColor: theme.colors.accent,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginVertical: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default ReceiveModal;
