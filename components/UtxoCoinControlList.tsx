import React, {useMemo} from 'react';
import {Dimensions, FlatList, StyleSheet, View} from 'react-native';
import AppPressable from './AppPressable';
import AppText from './AppText';
import {useTheme} from '../theme';
import {COMMON_FONT_CONFIGS} from '../theme/fonts';
import {
  formatUtxoCoinId,
  formatUtxoPickerLabel,
  outpointKey,
  type CoinControlUtxo,
} from '../services/utxoCoinControl';

export type UtxoCoinControlListProps = {
  utxos: CoinControlUtxo[];
  selectedKeys: Set<string> | null;
  onToggle: (key: string) => void;
  onSelectAll: () => void;
  formatAmount: (sats: number) => string;
  formatFiat: (sats: number) => string;
};

const ROW_HEIGHT = 68;
const ALL_ROW_HEIGHT = 48;
const FOOTER_HEIGHT = 32;
const ADDR_SHORT = (addr: string) =>
  typeof addr === 'string' && addr.length > 8
    ? `${addr.slice(0, 4)}...${addr.slice(-4)}`
    : addr || '—';

function listViewportHeight(itemCount: number): number {
  const winH = Dimensions.get('window').height;
  const maxBody = Math.min(320, Math.max(168, Math.round(winH * 0.36)));
  const body = itemCount * ROW_HEIGHT;
  return Math.min(maxBody, Math.max(ROW_HEIGHT, body));
}

const UtxoCoinControlList: React.FC<UtxoCoinControlListProps> = ({
  utxos,
  selectedKeys,
  onToggle,
  onSelectAll,
  formatAmount,
  formatFiat,
}) => {
  const {theme} = useTheme();
  const allSelected = selectedKeys == null;
  const isLight = theme.colors.background === '#ffffff';
  const accent = isLight ? theme.colors.primary : theme.colors.bitcoinOrange;
  const hairline = isLight
    ? theme.colors.blackOverlay10
    : theme.colors.whiteOverlay20;
  const selectedCount = selectedKeys ? selectedKeys.size : utxos.length;
  const bodyHeight = listViewportHeight(utxos.length);
  const canScroll = utxos.length * ROW_HEIGHT > bodyHeight;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          marginBottom: 12,
          borderBottomLeftRadius: 12,
          borderBottomRightRadius: 12,
          borderWidth: 1.5,
          borderTopWidth: 0,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.cardBackground,
          overflow: 'hidden',
        },
        allRow: {
          flexDirection: 'row',
          alignItems: 'center',
          height: ALL_ROW_HEIGHT,
          paddingHorizontal: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: hairline,
          backgroundColor: theme.colors.cardBackground,
        },
        allRowChecked: {
          backgroundColor: accent + '18',
        },
        checkbox: {
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: accent,
          justifyContent: 'center',
          alignItems: 'center',
          marginRight: 10,
          backgroundColor: 'transparent',
        },
        checkboxChecked: {
          backgroundColor: accent,
        },
        checkmark: {
          color: isLight ? '#fff' : theme.colors.background,
          fontSize: 13,
          fontFamily: theme.fontFamilies?.bold,
          lineHeight: 16,
        },
        allBody: {
          flex: 1,
          minWidth: 0,
        },
        allLabel: {
          fontSize: theme.fontSizes?.base || 13,
          fontFamily: theme.fontFamilies?.bold,
          color: theme.colors.text,
        },
        allMeta: {
          fontSize: theme.fontSizes?.xs || 11,
          fontFamily: theme.fontFamilies?.medium,
          color: theme.colors.textSecondary,
          marginTop: 1,
        },
        list: {
          height: bodyHeight,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          height: ROW_HEIGHT,
          paddingHorizontal: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: hairline,
        },
        rowChecked: {
          backgroundColor: accent + '14',
        },
        body: {
          flex: 1,
          minWidth: 0,
          paddingRight: 8,
        },
        tag: {
          alignSelf: 'flex-start',
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: 4,
          backgroundColor: accent + '22',
          marginBottom: 3,
          maxWidth: '100%',
        },
        tagText: {
          fontSize: theme.fontSizes?.xs || 11,
          fontFamily: theme.fontFamilies?.bold,
          color: accent,
        },
        idLine: {
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          color: theme.colors.text,
        },
        addrLine: {
          fontSize: theme.fontSizes?.xs || 11,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          color: theme.colors.textSecondary,
          marginTop: 1,
        },
        amountCol: {
          alignItems: 'flex-end',
          justifyContent: 'center',
          minWidth: 88,
        },
        amount: {
          fontSize: theme.fontSizes?.sm || 12,
          fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
          color: theme.colors.text,
        },
        fiat: {
          fontSize: theme.fontSizes?.xs || 11,
          fontFamily: theme.fontFamilies?.regular,
          color: theme.colors.textSecondary,
          marginTop: 2,
        },
        empty: {
          height: ROW_HEIGHT,
          paddingHorizontal: 12,
          justifyContent: 'center',
        },
        footer: {
          height: FOOTER_HEIGHT,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: hairline,
          backgroundColor: isLight
            ? theme.colors.blackOverlay05
            : theme.colors.whiteOverlay10,
        },
        footerText: {
          fontSize: theme.fontSizes?.xs || 11,
          fontFamily: theme.fontFamilies?.medium,
          color: theme.colors.textSecondary,
        },
      }),
    [theme, accent, hairline, isLight, bodyHeight],
  );

  const Check = ({checked}: {checked: boolean}) => (
    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
      {checked ? <AppText style={styles.checkmark}>✓</AppText> : null}
    </View>
  );

  const renderItem = ({item: u}: {item: CoinControlUtxo}) => {
    const key = outpointKey(u.txid, u.vout);
    const checked = !allSelected && !!selectedKeys?.has(key);
    const tag = (u.tag || '').trim();
    const coinId = formatUtxoCoinId(u.txid, u.vout);
    const addr = ADDR_SHORT(u.address);
    return (
      <AppPressable
        style={[styles.row, checked && styles.rowChecked]}
        onPress={() => onToggle(key)}
        accessibilityRole="checkbox"
        accessibilityState={{checked}}
        accessibilityLabel={formatUtxoPickerLabel({
          tag: u.tag,
          txid: u.txid,
          vout: u.vout,
          address: u.address,
        })}>
        <Check checked={checked} />
        <View style={styles.body}>
          {tag ? (
            <View style={styles.tag}>
              <AppText style={styles.tagText} numberOfLines={1}>
                {tag}
              </AppText>
            </View>
          ) : null}
          <AppText style={styles.idLine} numberOfLines={1}>
            {coinId}
          </AppText>
          <AppText style={styles.addrLine} numberOfLines={1}>
            {addr}
            {!u.isConfirmed ? '  ·  pending' : ''}
          </AppText>
        </View>
        <View style={styles.amountCol}>
          <AppText style={styles.amount} numberOfLines={1}>
            {formatAmount(u.valueSats)}
          </AppText>
          <AppText style={styles.fiat} numberOfLines={1}>
            {formatFiat(u.valueSats)}
          </AppText>
        </View>
      </AppPressable>
    );
  };

  return (
    <View style={styles.wrap}>
      <AppPressable
        style={[styles.allRow, allSelected && styles.allRowChecked]}
        onPress={onSelectAll}
        accessibilityRole="checkbox"
        accessibilityState={{checked: allSelected}}
        accessibilityLabel="All coins">
        <Check checked={allSelected} />
        <View style={styles.allBody}>
          <AppText style={styles.allLabel}>All coins</AppText>
          <AppText style={styles.allMeta} numberOfLines={1}>
            {utxos.length === 1 ? '1 UTXO' : `${utxos.length} UTXOs`}
            {allSelected ? '  ·  wallet pool' : ''}
          </AppText>
        </View>
      </AppPressable>
      {utxos.length === 0 ? (
        <View style={styles.empty}>
          <AppText tone="muted">No UTXOs loaded</AppText>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={utxos}
          keyExtractor={item => outpointKey(item.txid, item.vout)}
          renderItem={renderItem}
          getItemLayout={(_data, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          extraData={allSelected ? '*' : [...(selectedKeys || [])].join(',')}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          persistentScrollbar
          overScrollMode="never"
          initialNumToRender={8}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
        />
      )}
      {utxos.length > 0 ? (
        <View style={styles.footer}>
          <AppText style={styles.footerText}>
            {allSelected
              ? `${utxos.length} available`
              : `${selectedCount} of ${utxos.length} selected`}
          </AppText>
          {canScroll ? (
            <AppText style={styles.footerText}>Scroll for more</AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

export default UtxoCoinControlList;
