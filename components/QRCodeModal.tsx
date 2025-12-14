import React, {useCallback, useRef} from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  Alert,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Share from 'react-native-share';
import * as RNFS from 'react-native-fs';
import {HapticFeedback} from '../utils';
import {useTheme} from '../theme';
import {createStyles} from './Styles';

interface QRCodeModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  value: string;
  network?: 'mainnet' | 'testnet';
  showShareButton?: boolean;
  topRightClose?: boolean;
  nonDismissible?: boolean;
}

const QRCodeModal: React.FC<QRCodeModalProps> = ({
  visible,
  onClose,
  title,
  value,
  network,
  showShareButton = false,
  topRightClose = false,
  nonDismissible = false,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const qrRef = useRef<any>(null);

  // Share QR code as image file
  const shareQRAsFile = useCallback(
    async (filename: string, shareTitle: string) => {
      HapticFeedback.medium();
      try {
        if (!qrRef.current) {
          Alert.alert('Error', 'QR Code is not ready yet');
          return;
        }

        const base64Data: string = await new Promise((resolve, reject) => {
          qrRef.current.toDataURL((data: string) => {
            if (data) {
              resolve(data);
            } else {
              reject(new Error('No base64 data returned from QR code'));
            }
          });
        });

        const filePath = `${RNFS.TemporaryDirectoryPath}/${filename}`;
        const fileExists = await RNFS.exists(filePath);
        if (fileExists) {
          await RNFS.unlink(filePath);
        }

        await RNFS.writeFile(filePath, base64Data, 'base64');

        await Share.open({
          title: shareTitle,
          message: shareTitle,
          url: `file://${filePath}`,
          subject: shareTitle,
          isNewTask: true,
          failOnCancel: false,
        });

        await RNFS.unlink(filePath).catch(() => {});
      } catch (error: any) {
        if (error?.message !== 'User did not share') {
          Alert.alert('Error', 'Failed to share QR code');
        }
      }
    },
    [],
  );

  const handleShare = useCallback(() => {
    const now = new Date();
    const month = now.toLocaleDateString('en-US', {month: 'short'});
    const day = now.getDate().toString().padStart(2, '0');
    const year = now.getFullYear();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    
    let filename = `qr-code.${month}${day}.${year}.${hours}${minutes}.jpg`;
    let shareTitle = 'Share QR Code';
    
    if (network) {
      if (title.includes('xpub') || title.includes('tpub')) {
        filename = `${network === 'mainnet' ? 'xpub' : 'tpub'}-qr.${month}${day}.${year}.${hours}${minutes}.jpg`;
        shareTitle = 'Share Extended Pubkey QR Code';
      } else if (title.includes('Output Descriptor')) {
        filename = `output-descriptor-qr.${month}${day}.${year}.${hours}${minutes}.jpg`;
        shareTitle = 'Share Output Descriptor QR Code';
      }
    }
    
    shareQRAsFile(filename, shareTitle);
  }, [network, title, shareQRAsFile]);

  const handleClose = useCallback(() => {
    HapticFeedback.light();
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={nonDismissible ? () => {} : handleClose}>
      <TouchableOpacity
        style={styles.modalOverlay}
        onPress={nonDismissible ? undefined : handleClose}
        activeOpacity={1}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={e => e.stopPropagation()}>
          <View style={styles.qrModalContent}>
            {topRightClose ? (
              <View style={styles.qrModalHeader}>
                <Text style={styles.qrModalHeaderTitle}>{title}</Text>
                <TouchableOpacity
                  onPress={handleClose}
                  style={styles.qrModalTopRightCloseButton}
                  activeOpacity={0.7}>
                  <Text style={styles.qrModalTopRightCloseText}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.qrModalTitle}>{title}</Text>
            )}
            <View style={styles.qrCodeContainer}>
              {value && (
                <QRCode
                  getRef={ref => {
                    qrRef.current = ref;
                  }}
                  value={value}
                  size={200}
                  backgroundColor="white"
                  color="black"
                />
              )}
            </View>
            {showShareButton ? (
              <View
                style={[
                  styles.qrModalButtonsContainer,
                  topRightClose && styles.qrModalButtonsContainerCentered,
                ]}>
                <TouchableOpacity
                  style={[
                    styles.qrModalCloseButton,
                    styles.qrModalShareButton,
                    topRightClose && styles.qrModalShareButtonSingle,
                  ]}
                  onPress={handleShare}>
                  <Image
                    source={require('../assets/share-icon.png')}
                    style={styles.qrModalShareIcon}
                  />
                  <Text
                    style={[
                      styles.qrModalCloseButtonText,
                      {color: theme.colors.white},
                    ]}>
                    Share
                  </Text>
                </TouchableOpacity>
                {!topRightClose && (
                  <TouchableOpacity
                    style={[
                      styles.qrModalCloseButton,
                      styles.qrModalCloseButtonWithMargin,
                    ]}
                    onPress={handleClose}>
                    <Text style={styles.qrModalCloseButtonText}>Close</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              !topRightClose && (
                <TouchableOpacity
                  style={styles.qrModalCloseButton}
                  onPress={handleClose}>
                  <Text style={styles.qrModalCloseButtonText}>Close</Text>
                </TouchableOpacity>
              )
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

export default QRCodeModal;
