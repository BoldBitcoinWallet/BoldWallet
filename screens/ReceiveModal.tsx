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
  Platform,
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
      backgroundColor: theme.colors.cardBackground,
      padding: 24,
      borderRadius: 16,
      alignItems: 'center',
      width: '90%',
      maxWidth: 400,
      elevation: 5,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
      marginBottom: 20,
      paddingHorizontal: 4,
    },
    titleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.colors.text,
      flex: 1,
    },
    bitcoinLogo: {
      width: 24,
      height: 24,
      resizeMode: 'contain',
    },
    closeButton: {
      position: 'relative',
      borderRadius: 20,
      backgroundColor: theme.colors.background,
      marginLeft: 8,
      width: 30,
      height: 30,
      elevation: 1,
      padding: 0,
    },
    closeButtonText: {
      fontSize: 16,
      color: theme.colors.text,
      fontWeight: '600',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 30,
    },
    networkBadge: {
      backgroundColor: theme.colors.secondary,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      marginBottom: 20,
    },
    networkText: {
      color: theme.colors.textOnPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    qrContainer: {
      backgroundColor: 'white',
      padding: 16,
      borderRadius: 12,
      marginBottom: 20,
      elevation: 2,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.2,
      shadowRadius: 1.41,
    },
    addressContainer: {
      width: '100%',
      marginBottom: 20,
    },
    addressText: {
      fontSize: 14,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 16,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    addressTouchable: {
      padding: 12,
      borderRadius: 8,
      backgroundColor: theme.colors.cardBackground,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: 16,
    },
    addressTextContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    addressTextInteractive: {
      fontSize: 14,
      color: theme.colors.primary,
      textAlign: 'center',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      textDecorationLine: 'underline',
      textDecorationColor: theme.colors.primary,
    },
    addressHint: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginTop: 4,
    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      gap: 12,
    },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      elevation: 2,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.2,
      shadowRadius: 1.41,
    },
    actionButtonText: {
      color: theme.colors.textOnPrimary,
      fontSize: 16,
      fontWeight: '600',
      marginLeft: 8,
    },
    buttonIcon: {
      width: 20,
      height: 20,
      tintColor: theme.colors.textOnPrimary,
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
          <View style={styles.header}>
            <View style={styles.titleContainer}>
              <Image
                source={require('../assets/bitcoin-logo.png')}
                style={styles.bitcoinLogo}
              />
              <Text style={styles.title}>Receive Bitcoin</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✖️</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.networkBadge}>
            <Text style={styles.networkText}>
              {network === 'mainnet' ? '🌐 Mainnet' : '🔨 Testnet'}
            </Text>
          </View>

          <TouchableOpacity style={styles.qrContainer} onPress={shareQRCode}>
            <QRCode
              value={address}
              size={200}
              getRef={ref => (qrRef.current = ref)}
              backgroundColor="white"
            />
          </TouchableOpacity>

          <View style={styles.addressContainer}>
            <TouchableOpacity
              style={styles.addressTouchable}
              onPress={() => {
                dbg('baseAPI', baseApi);
                const url = `${baseApi.replace('api/', '')}address/${address}`;
                dbg('address URL', url);
                Linking.openURL(url);
              }}>
              <View style={styles.addressTextContainer}>
                <Text style={styles.addressTextInteractive}>{address}</Text>
              </View>
              <Text style={styles.addressHint}>Tap to view in explorer</Text>
            </TouchableOpacity>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={copyToClipboard}>
                <Image
                  source={require('../assets/paste-icon.png')}
                  style={styles.buttonIcon}
                  resizeMode="contain"
                />
                <Text style={styles.actionButtonText}>Copy</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.actionButton,
                  {backgroundColor: theme.colors.secondary},
                ]}
                onPress={shareQRCode}>
                <Text style={[styles.actionButtonText, {marginLeft: 0}]}>
                  📤
                </Text>
                <Text style={styles.actionButtonText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Toast />
        </View>
      </View>
    </Modal>
  );
};

export default ReceiveModal;
