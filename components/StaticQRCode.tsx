import React, {useCallback} from 'react';
import {View, StyleSheet, ViewStyle, StyleProp} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-toast-message';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';
import {createToastConfig} from '../utils/toastConfig';
import {dbg} from '../utils';

const DEFAULT_SIZE = 200;
const LOGO_SIZE_RATIO = 0.2;
const LOGO_MARGIN = 0;
const LOGO_BORDER_RADIUS = 8;

export interface StaticQRCodeProps {
  /** QR code payload (string to encode). */
  value: string;
  /** Size in pixels. Default 200. */
  size?: number;
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
      shadowColor: theme.colors.shadowColor,
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
          {value ? (
            <QRCode
              {...(getRef ? {getRef} : {})}
              value={value}
              size={size}
              color="black"
              backgroundColor="white"
              logo={showLogo ? require('../assets/icon.png') : undefined}
              logoSize={showLogo ? logoSize : undefined}
              logoMargin={showLogo ? LOGO_MARGIN : undefined}
              logoBorderRadius={showLogo ? LOGO_BORDER_RADIUS : undefined}
              ecl="L"
              onError={error => {
                dbg('StaticQRCode: QR encode failed', error);
              }}
            />
          ) : null}
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
    padding: 8,
    borderRadius: 8,
    elevation: 2,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
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
