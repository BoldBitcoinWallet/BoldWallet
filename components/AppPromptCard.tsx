import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import AppPressable from './AppPressable';
import GlassModalOverlay from './GlassModalOverlay';
import {
  respondAppPrompt,
  type AppPromptIcon,
  type AppPromptRequest,
} from '../services/appPrompt';
import {useTheme} from '../theme';

const APP_PROMPT_ICONS: Record<AppPromptIcon, number> = {
  security: require('../assets/security-icon.png'),
  warning: require('../assets/warning-icon.png'),
  delete: require('../assets/delete-icon.png'),
  dice: require('../assets/dice-icon.png'),
  paste: require('../assets/paste-icon.png'),
  fee: require('../assets/currency-icon.png'),
  sync: require('../assets/refresh-icon.png'),
  network: require('../assets/network-icon.png'),
  dev: require('../assets/settings-icon.png'),
  relay: require('../assets/nostr-icon.png'),
  copy: require('../assets/copy-icon.png'),
  backup: require('../assets/backup-icon.png'),
  wallet: require('../assets/wallet-icon.png'),
};

/** Choice card. Rendered by the prompt host, or inside an open sheet. */
export default function AppPromptCard({prompt}: {prompt: AppPromptRequest}) {
  const {theme} = useTheme();
  const tokens = theme.colors;
  // Confirm uses the theme accent in both modes. No red danger fill.
  const filled =
    tokens.background === '#ffffff' ? tokens.primary : tokens.bitcoinOrange;
  const iconTint = filled;

  return (
    <GlassModalOverlay
      onPress={() => respondAppPrompt(!prompt.cancelLabel)}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: tokens.cardBackground,
            borderColor: tokens.border,
          },
        ]}>
        <View style={styles.headerRow}>
          <View style={[styles.iconWrap, {backgroundColor: iconTint + '22'}]}>
            <Image
              source={APP_PROMPT_ICONS[prompt.icon]}
              style={[styles.icon, {tintColor: iconTint}]}
              resizeMode="contain"
            />
          </View>
          <Text
            style={[
              styles.title,
              {color: tokens.text, fontFamily: theme.fontFamilies?.bold},
            ]}
            numberOfLines={2}>
            {prompt.title}
          </Text>
        </View>
        {prompt.code ? (
          <Text
            style={[
              styles.code,
              {
                color: tokens.text,
                fontFamily: theme.fontFamilies?.monospace,
              },
            ]}>
            {prompt.code}
          </Text>
        ) : null}
        {prompt.detail ? (
          <Text
            style={[
              styles.detail,
              {
                color: tokens.text,
                fontFamily: theme.fontFamilies?.monospace,
                borderColor: tokens.border,
              },
            ]}
            numberOfLines={3}>
            {prompt.detail}
          </Text>
        ) : null}
        {prompt.hint ? (
          <Text
            style={[
              styles.hint,
              {
                color: tokens.textSecondary,
                fontFamily: theme.fontFamilies?.regular,
              },
            ]}
            numberOfLines={3}>
            {prompt.hint}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {prompt.cancelLabel ? (
            <AppPressable
              style={[styles.btn, {borderColor: tokens.border}]}
              onPress={() => respondAppPrompt(false)}>
              <Text
                style={[
                  styles.btnLabel,
                  {
                    color: tokens.textSecondary,
                    fontFamily: theme.fontFamilies?.bold,
                  },
                ]}>
                {prompt.cancelLabel}
              </Text>
            </AppPressable>
          ) : null}
          <AppPressable
            style={[styles.btn, {borderColor: filled, backgroundColor: filled}]}
            onPress={() => respondAppPrompt(true)}>
            <Text
              style={[
                styles.btnLabel,
                styles.btnLabelConfirm,
                {fontFamily: theme.fontFamilies?.bold},
              ]}>
              {prompt.confirmLabel}
            </Text>
          </AppPressable>
        </View>
      </View>
    </GlassModalOverlay>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '86%',
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    alignItems: 'stretch',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {width: 22, height: 22},
  title: {
    flex: 1,
    marginLeft: 12,
    fontSize: 18,
    textAlign: 'left',
    lineHeight: 24,
  },
  code: {
    marginTop: 14,
    fontSize: 34,
    letterSpacing: 4,
    textAlign: 'center',
  },
  detail: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignSelf: 'stretch',
  },
  hint: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'left',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    alignSelf: 'stretch',
  },
  btn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  btnLabel: {fontSize: 15, textAlign: 'center'},
  btnLabelConfirm: {color: '#FFFFFF'},
});
