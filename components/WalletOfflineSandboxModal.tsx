import React from 'react';
import {Modal, View, Text, StyleSheet, Image} from 'react-native';
import AppPressable from './AppPressable';
import GlassModalOverlay from './GlassModalOverlay';
import {useTheme} from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onKeepOffline: () => void;
  onGoOnline: () => void;
};

/**
 * Shown when the user taps refresh while the in-app offline sandbox is on.
 */
export default function WalletOfflineSandboxModal({
  visible,
  onClose,
  onKeepOffline,
  onGoOnline,
}: Props) {
  const {theme} = useTheme();
  const isDark = theme.colors.background !== '#ffffff';
  const primaryBtnBg = isDark
    ? theme.colors.bitcoinOrange
    : theme.colors.primary;
  const primaryBtnText = isDark ? theme.colors.text : theme.colors.white;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <GlassModalOverlay style={styles.overlay}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.cardBackground,
              borderColor: theme.colors.border,
            },
          ]}>
          <View style={styles.headerRow}>
            <View style={styles.headerTitleWrap}>
              <Image
                source={require('../assets/api-icon.png')}
                style={[styles.headerIcon, {tintColor: theme.colors.text}]}
                resizeMode="contain"
              />
              <Text
                style={[
                  styles.title,
                  {
                    color: theme.colors.text,
                    fontFamily: theme.fontFamilies?.bold,
                  },
                ]}>
                Offline sandbox
              </Text>
            </View>
            <AppPressable
              onPress={onClose}
              style={[
                styles.closeBtn,
                {backgroundColor: theme.colors.background},
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close"
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Text style={[styles.closeText, {color: theme.colors.text}]}>
                ✕
              </Text>
            </AppPressable>
          </View>

          <Text
            style={[
              styles.body,
              {
                color: theme.colors.textSecondary,
                fontFamily: theme.fontFamilies?.regular,
              },
            ]}>
            Your wallet is set to the offline sandbox network. Refresh needs
            the Internet. Cached balances and history stay available while
            offline.
          </Text>

          <View style={styles.actions}>
            <AppPressable
              style={[
                styles.secondaryBtn,
                {borderColor: theme.colors.border},
              ]}
              onPress={onKeepOffline}
              accessibilityRole="button"
              accessibilityLabel="Keep offline"
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Text
                style={[
                  styles.secondaryBtnText,
                  {
                    color: theme.colors.text,
                    fontFamily: theme.fontFamilies?.bold,
                  },
                ]}>
                Keep offline
              </Text>
            </AppPressable>
            <AppPressable
              style={[styles.primaryBtn, {backgroundColor: primaryBtnBg}]}
              onPress={onGoOnline}
              accessibilityRole="button"
              accessibilityLabel="Go online"
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Text
                style={[
                  styles.primaryBtnText,
                  {
                    color: primaryBtnText,
                    fontFamily: theme.fontFamilies?.bold,
                  },
                ]}>
                Go online
              </Text>
            </AppPressable>
          </View>
        </View>
      </GlassModalOverlay>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  headerIcon: {
    width: 20,
    height: 20,
  },
  title: {
    fontSize: 17,
    flexShrink: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 16,
    fontWeight: '600',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 14,
  },
  primaryBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 14,
  },
});
