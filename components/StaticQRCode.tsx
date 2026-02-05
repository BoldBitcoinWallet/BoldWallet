import React, {useCallback} from 'react';
import {View, StyleSheet, ViewStyle, StyleProp} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-toast-message';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';
import {createToastConfig} from '../utils/toastConfig';

const DEFAULT_SIZE = 200;
const LOGO_SIZE_RATIO = 0.18;
const LOGO_MARGIN = 2;
const LOGO_BORDER_RADIUS = 6;

export interface StaticQRCodeProps {
  /** QR code payload (string to encode). */
  value: string;
  /** Size in pixels. Default 200. */
  size?: number;
  /** Quiet zone (padding) in pixels around QR. Default 8. */
  quietZone?: number;
  /** Error correction level. Default 'H'. */
  ecl?: 'L' | 'M' | 'Q' | 'H';
  /** Text to copy on tap. Defaults to `value`. */
  copyContent?: string;
  /** Toast secondary text after copy. Default "Copied to clipboard". */
  toastMessage?: string;
  /** Optional ref callback for underlying QRCode (e.g. for toDataURL when sharing). */
  getRef?: (ref: any) => void;
  /** Outer container style. */
  style?: StyleProp<ViewStyle>;
  /** Inner QR wrapper style (white padded box). */
  contentStyle?: StyleProp<ViewStyle>;
  /** Show Bold icon in center. Default true. */
  showLogo?: boolean;
  /** Disable press-to-copy (e.g. when only displaying). Default false. */
  copyDisabled?: boolean;
}

/**
 * Unified static QR code: consistent styling, Bold icon in center,
 * tap to copy with haptics and toast.
 */
const StaticQRCode: React.FC<StaticQRCodeProps> = ({
  value,
  size = DEFAULT_SIZE,
  quietZone = 8,
  ecl = 'H',
  copyContent,
  toastMessage = 'Copied to clipboard',
  getRef,
  style,
  contentStyle,
  showLogo = true,
  copyDisabled = false,
}) => {
  const {theme} = useTheme();
  const contentToCopy = copyContent ?? value;
  const logoSize = Math.round(size * LOGO_SIZE_RATIO);

  const handlePress = useCallback(() => {
    if (copyDisabled || !contentToCopy) return;
    Clipboard.setString(contentToCopy);
    Toast.show({
      type: 'success',
      text1: 'Copied',
      text2: toastMessage,
    });
  }, [contentToCopy, toastMessage, copyDisabled]);

    const qrContainerStyle = [
      styles.container,
      {
        backgroundColor: 'white',
        // Removed shadow properties for better scan contrast
      },
      contentStyle,
    ];

  return (
    <>
      <AppPressable
        style={[styles.outer, style]}
        onPress={copyDisabled ? undefined : handlePress}
        disabled={copyDisabled}
        android_ripple={copyDisabled ? undefined : {color: 'rgba(0,0,0,0.1)'}}>
        <View style={qrContainerStyle}>
          <QRCode
            {...(getRef ? {getRef} : {})}
            value={value}
            size={size}
            color="black"
            backgroundColor="white"
            quietZone={quietZone}
            ecl={ecl}
            logo={showLogo ? require('../assets/icon.png') : undefined}
            logoSize={showLogo ? logoSize : undefined}
            logoMargin={showLogo ? LOGO_MARGIN : undefined}
            logoBorderRadius={showLogo ? LOGO_BORDER_RADIUS : undefined}
            logoBackgroundColor={showLogo ? 'white' : undefined}
          />
        </View>
      </AppPressable>
      {/* Local Toast instance renders above modal content */}
      <View pointerEvents="box-none" style={styles.toastWrapper}>
        <Toast config={createToastConfig(theme)} />
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  outer: {
    alignSelf: 'center',
  },
  container: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#000000',
    elevation: 0,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  toastWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
});

export default StaticQRCode;
