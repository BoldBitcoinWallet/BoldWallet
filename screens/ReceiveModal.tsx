import React, {useCallback, useRef} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Image,
  Linking,
  Alert,
} from 'react-native';
import Toast from 'react-native-toast-message';
import QRCode from 'react-native-qrcode-svg';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import * as RNFS from 'react-native-fs';
import {dbg} from '../utils';
import {useTheme} from '../theme';

const ReceiveModal: React.FC<{
  visible: boolean;
  address: string;
  baseApi: string;
  network: string;
  onClose: () => void;
}> = ({visible, address, baseApi, network, onClose}) => {
  const qrRef = useRef<any>(null);

  const {theme} = useTheme();

  const copyToClipboard = useCallback(() => {
    Toast.show({
      type: 'success',
      text1: 'Address Copied to Clipboard',
      position: 'top',
      visibilityTime: 325,
    });
    Clipboard.setString(address);
  }, [address]);

  const shareQRCode = useCallback(async () => {
    dbg('shareQRCode...');
    if (!qrRef.current) {
      Alert.alert('Error', 'QR Code is not ready yet');
      return;
    }

    try {
      // Generate base64 image from QR code
      await new Promise((resolve, reject) => {
        qrRef.current.toDataURL((base64Data: string) => {
          if (base64Data) {
            dbg('Base64 data generated:', base64Data);
            resolve(base64Data);
          } else {
            reject(new Error('No base64 data returned'));
          }
        });
      }).then(async (base64Data: any) => {
        const filePath = `${RNFS.TemporaryDirectoryPath}/bitcoin-${network}-address.jpg`;
        const fileExists = await RNFS.exists(filePath);
        if (fileExists) {
          dbg('Deleting existing file...');
          await RNFS.unlink(filePath);
        }

        dbg('Writing base64 to file...');
        await RNFS.writeFile(filePath, base64Data, 'base64');

        dbg('Sharing QR code...');
        await Share.open({
          title: 'Bitcoin Receive Address',
          message: `${address}`,
          url: `file://${filePath}`,
          subject: `Bitcoin ${network} Wallet Address`,
          isNewTask: true,
          failOnCancel: false,
        });
        dbg('Share completed successfully');

        // Clean up
        await RNFS.unlink(filePath).catch(err => {
          dbg('Cleanup error:', err);
        });
      });
    } catch (error) {
      console.error('Error sharing QR code:', error);
      Alert.alert('Error', 'Failed to share QR code');
    }
  }, [address, network]);

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
  });

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <Text style={styles.textReceive}>
            🌐 {network === 'mainnet' ? 'Mainnet' : 'Testnet'} / Bitcoin /
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
              getRef={ref => (qrRef.current = ref)} // Stable ref assignment
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

export default ReceiveModal;
