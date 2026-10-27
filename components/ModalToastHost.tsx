import React from 'react';
import {StyleSheet, useWindowDimensions, View} from 'react-native';
import Toast from 'react-native-toast-message';
import {useTheme} from '../theme';
import {createToastConfig} from '../utils/toastConfig';

/**
 * Toast host inside a native Modal. Root App Toast cannot paint above
 * RN Modal windows; react-native-toast-message routes show() to the
 * last mounted host.
 */
export default function ModalToastHost() {
  const {theme} = useTheme();
  const {height} = useWindowDimensions();
  const topOffset = Math.round(height * 0.2);

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Toast config={createToastConfig(theme)} topOffset={topOffset} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
  },
});
