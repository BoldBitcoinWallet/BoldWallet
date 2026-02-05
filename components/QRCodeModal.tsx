import React, {useCallback, useRef, useMemo} from 'react';
// iOS CoreText-safe line break helper for crypto descriptors
const IOS_WORD_JOINER = '\u2060';

const formatForIOSLineBreaks = (value: string) =>
  value
    .replace(/\//g, `${IOS_WORD_JOINER}/${IOS_WORD_JOINER}`)
    .replace(/\[/g, `${IOS_WORD_JOINER}[`)
    .replace(/\]/g, `]${IOS_WORD_JOINER}`)
    .replace(/\(/g, `${IOS_WORD_JOINER}(`)
    .replace(/\)/g, `)${IOS_WORD_JOINER}`);

import {
  Modal,
  View,
  Text,
  Image,
  Alert,
  ScrollView,
  Platform,
  Dimensions,
  StyleSheet,
} from 'react-native';
import AppPressable from './AppPressable';
import StaticQRCode from './StaticQRCode';
import Share from 'react-native-share';
import * as RNFS from 'react-native-fs';
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
  /** QR code size in pixels. Default 200. Use larger (e.g. 320) for easier scanning. */
  qrSize?: number;
  /** Max width of modal content. Default 320. Use larger for a bigger QR modal. */
  contentMaxWidth?: number;
  /** Extra style for the QR container (e.g. larger padding for scanner quiet zone). */
  qrContentStyle?: import('react-native').ViewStyle;
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
  qrSize = 200,
  contentMaxWidth: contentMaxWidthProp,
  qrContentStyle,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const qrRef = useRef<any>(null);
  const screenWidth = Dimensions.get('window').width;
  const defaultModalMaxWidth = 320;
  const modalMaxWidth = contentMaxWidthProp ?? defaultModalMaxWidth;
  const containerWidth = Math.min(screenWidth - 48, modalMaxWidth - 48); // Account for padding
  const staticStyles = useMemo(
    () =>
      StyleSheet.create({
        noPadding: {padding: 0},
        contentWide: contentMaxWidthProp
          ? {maxWidth: contentMaxWidthProp}
          : {},
      }),
    [contentMaxWidthProp],
  );
  
  // Memoize style to avoid re-creation on every render
  const valueTextStyle = useMemo(
    () => [styles.qrModalValueText, { width: containerWidth - 24 }],
    [containerWidth, styles.qrModalValueText]
  );
  // Share QR code as image file
  const shareQRAsFile = useCallback(
    async (filename: string, shareTitle: string) => {
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
    onClose();
  }, [onClose]);
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={
        nonDismissible
          ? () => {} /* block Android back: do not close when non-dismissible */
          : handleClose
      }>
      <AppPressable
        style={styles.modalOverlay}
        onPress={nonDismissible ? undefined : handleClose}>
        <AppPressable
          onPress={e => e.stopPropagation()}>
          <View
            style={[
              styles.qrModalContent,
              staticStyles.contentWide,
            ]}>
            {topRightClose ? (
              <View style={styles.qrModalHeader}>
                <Text style={styles.qrModalHeaderTitle}>{title}</Text>
                <AppPressable
                  onPress={handleClose}
                  style={styles.qrModalTopRightCloseButton}
                  android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                  <Text style={styles.qrModalTopRightCloseText}>✕</Text>
                </AppPressable>
              </View>
            ) : (
              <Text style={styles.qrModalTitle}>{title}</Text>
            )}
            {value && (
              <StaticQRCode
                value={value}
                size={qrSize}
                copyContent={value}
                toastMessage="Copied to clipboard"
                getRef={ref => {
                  qrRef.current = ref;
                }}
                style={[styles.qrCodeContainer, staticStyles.noPadding]}
                contentStyle={qrContentStyle}
              />
            )}
            {value && showShareButton && (
              <View style={[styles.qrModalValueContainer, {width: containerWidth}]}>
                <ScrollView
                  removeClippedSubviews
                  keyboardShouldPersistTaps="handled"
                  overScrollMode="never"
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled={true}
                  contentContainerStyle={styles.qrModalValueScrollContent}
                  bounces={false}>
                  <Text
                    style={valueTextStyle}
                    selectable={true}
                    numberOfLines={0}
                    allowFontScaling={false}
                    {...(Platform.OS === 'android' && {
                      // @ts-ignore - textBreakStrategy is Android-only and not in types
                      textBreakStrategy: 'highQuality',
                    })}>
                    {Platform.OS === 'ios'
                      ? formatForIOSLineBreaks(value)
                      : value}
                  </Text>
                </ScrollView>
              </View>
            )}
            {showShareButton ? (
              <View
                style={[
                  styles.qrModalButtonsContainer,
                  topRightClose && styles.qrModalButtonsContainerCentered,
                ]}>
                <AppPressable
                  style={[
                    styles.qrModalCloseButton,
                    styles.qrModalShareButton,
                    topRightClose && styles.qrModalShareButtonSingle,
                  ]}
                  onPress={handleShare}
                  android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
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
                </AppPressable>
                {!topRightClose && (
                  <AppPressable
                    style={[
                      styles.qrModalCloseButton,
                      styles.qrModalCloseButtonWithMargin,
                    ]}
                    onPress={handleClose}
                    android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                    <Text style={styles.qrModalCloseButtonText}>Close</Text>
                  </AppPressable>
                )}
              </View>
            ) : (
              !topRightClose && (
                <AppPressable
                  style={styles.qrModalCloseButton}
                  onPress={handleClose}
                  android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                  <Text style={styles.qrModalCloseButtonText}>Close</Text>
                </AppPressable>
              )
            )}
          </View>
        </AppPressable>
      </AppPressable>
    </Modal>
  );
};
export default QRCodeModal;
