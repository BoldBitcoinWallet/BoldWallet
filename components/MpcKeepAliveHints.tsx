import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';
import {
  dismissMpcBatteryPrompt,
  getMpcKeepAliveUiState,
  requestMpcBatteryExemption,
  subscribeMpcKeepAliveUi,
  type MpcKeepAliveUiState,
} from '../services/mpcKeepAlive';
import {
  getMpcKeepAliveBatteryCopy,
  getMpcKeepAliveNotificationsOffLine,
} from '../services/walletSetupUi';

/** In-modal keep-alive hints: notifications denied + optional OEM battery exemption. */
export function useMpcKeepAliveUi(): MpcKeepAliveUiState {
  const [ui, setUi] = useState<MpcKeepAliveUiState>(getMpcKeepAliveUiState);
  useEffect(() => subscribeMpcKeepAliveUi(setUi), []);
  return ui;
}

export function MpcKeepAliveHints(): React.ReactElement | null {
  const {theme} = useTheme();
  const ui = useMpcKeepAliveUi();
  if (!ui.active) {
    return null;
  }
  const battery = getMpcKeepAliveBatteryCopy();
  const showNotifOff = !ui.notificationsGranted;
  const showBattery = ui.showBatteryPrompt;
  if (!showNotifOff && !showBattery) {
    return null;
  }
  return (
    <View style={styles.wrap}>
      {showNotifOff ? (
        <Text
          style={[
            styles.line,
            {
              color: theme.colors.textSecondary,
              fontFamily: theme.fontFamilies?.regular,
              fontSize: theme.fontSizes?.sm || 12,
            },
          ]}>
          {getMpcKeepAliveNotificationsOffLine()}
        </Text>
      ) : null}
      {showBattery ? (
        <View style={styles.battery}>
          <Text
            style={[
              styles.line,
              {
                color: theme.colors.textSecondary,
                fontFamily: theme.fontFamilies?.regular,
                fontSize: theme.fontSizes?.sm || 12,
              },
            ]}>
            {battery.body}
          </Text>
          <View style={styles.row}>
            <AppPressable
              onPress={() => {
                void requestMpcBatteryExemption();
              }}
              style={[
                styles.btn,
                {backgroundColor: theme.colors.primary + '22'},
              ]}>
              <Text
                style={[
                  styles.btnText,
                  {
                    color: theme.colors.primary,
                    fontFamily: theme.fontFamilies?.semiBold,
                  },
                ]}>
                {battery.allow}
              </Text>
            </AppPressable>
            <AppPressable
              onPress={() => {
                void dismissMpcBatteryPrompt();
              }}
              style={styles.btn}>
              <Text
                style={[
                  styles.btnText,
                  {
                    color: theme.colors.textSecondary,
                    fontFamily: theme.fontFamilies?.regular,
                  },
                ]}>
                {battery.dismiss}
              </Text>
            </AppPressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    marginTop: 8,
    marginBottom: 4,
  },
  line: {
    lineHeight: 18,
  },
  battery: {
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 12,
  },
  btn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  btnText: {
    fontSize: 13,
  },
});
