import React, {useCallback} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Share,
  Image,
  Linking,
} from 'react-native';
import theme from '../theme';
import Toast from 'react-native-toast-message';
import QRCode from 'react-native-qrcode-svg';
import Clipboard from '@react-native-clipboard/clipboard';

const ReceiveModal: React.FC<{
  visible: boolean;
  address: string;
  baseApi: string;
  network: string;
  onClose: () => void;
}> = ({visible, address, baseApi, network, onClose}) => {
  const copyToClipboard = useCallback(() => {
    Toast.show({
      type: 'success',
      text1: 'Address Copied to Clipboard',
      position: 'top',
    });
    Clipboard.setString(address);
  }, [address]);

  const shareAddress = async () => {
    try {
      await Share.share({
        message: `Here's my Bitcoin address: ${address}`,
      });
    } catch (error) {
      console.error('Error sharing address:', error);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <Text style={styles.textReceive}>
            {network === 'mainnet' ? 'Mainnnet' : 'Testnet'} - Deposit Address
          </Text>

          {/* Close Button */}
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✖️</Text>
          </TouchableOpacity>

          {/* QR Code */}
          <View
            style={styles.qrContainer}
            onTouchEndCapture={() => copyToClipboard()}>
            <QRCode value={address} size={200} />
          </View>

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
              style={styles.pasteIconContainer}>
              <Image
                source={require('../assets/paste-icon.png')}
                style={styles.iconImage}
                resizeMode="contain"
              />
            </TouchableOpacity>
          </View>

          {/* Share Button */}
          <TouchableOpacity style={styles.button} onPress={shareAddress}>
            <Text style={styles.buttonText}>Share</Text>
          </TouchableOpacity>

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
    backgroundColor: 'rgba(0, 0, 0, 0.5)', // Transparent background
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
    fontWeight: 'bold',
  },
  closeButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: theme.colors.cardBackground,
    padding: 8,
    borderRadius: 50,
  },
  closeButtonText: {
    fontSize: 16,
    color: theme.colors.white,
  },
  qrContainer: {
    marginTop: 60,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  addressText: {
    fontSize: 13,
    textDecorationLine: 'underline',
    color: theme.colors.primary,
    flex: 1,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  pasteIconContainer: {
    padding: 10,
  },
  iconImage: {
    width: 20,
    height: 20,
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
