/**
 * FontComparisonScreen Component
 * Optimized for visual comparison between iOS and Android
 * Shows real-world app patterns in a compact, screenshot-friendly format
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import {useTheme} from '../theme';
import {FONT_STYLES, COMMON_FONT_CONFIGS} from '../theme/fonts';
interface ComparisonRowProps {
  label: string;
  children: React.ReactNode;
  rowStyle: any;
  labelContainerStyle: any;
  rowLabelStyle: any;
  contentContainerStyle: any;
  borderColor: string;
  textSecondaryColor: string;
}
const ComparisonRow: React.FC<ComparisonRowProps> = ({
  label,
  children,
  rowStyle,
  labelContainerStyle,
  rowLabelStyle,
  contentContainerStyle,
  borderColor,
  textSecondaryColor,
}) => {
  return (
    <View style={[rowStyle, {borderBottomColor: borderColor}]}>
      <View style={labelContainerStyle}>
        <Text style={[rowLabelStyle, {color: textSecondaryColor}]}>
          {label}
        </Text>
      </View>
      <View style={contentContainerStyle}>{children}</View>
    </View>
  );
};
const FontComparisonScreen: React.FC = () => {
  const {theme} = useTheme();
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      padding: 16,
      paddingBottom: 32,
    },
    header: {
      marginBottom: 24,
      paddingBottom: 16,
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.border,
    },
    title: {
      fontSize: theme.fontSizes?.['3xl'] || 24,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    platformBadge: {
      alignSelf: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      backgroundColor:
        Platform.OS === 'ios'
          ? theme.colors.primary + '20'
          : theme.colors.bitcoinOrange + '20',
    },
    platformText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      color:
        Platform.OS === 'ios' ? theme.colors.primary : theme.colors.bitcoinOrange,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    row: {
      flexDirection: 'row',
      paddingVertical: 16,
      borderBottomWidth: 1,
    },
    labelContainer: {
      width: 120,
      paddingRight: 12,
    },
    rowLabel: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
    },
    contentContainer: {
      flex: 1,
    },
    // Real-world patterns - matching WalletHome styles
    balanceAmount: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.monospaceBold, // Match WalletHome balanceBTC
      color: theme.colors.text,
      lineHeight: theme.fontSizes?.['2xl'] ? theme.fontSizes['2xl'] * 1.2 : 24,
      includeFontPadding: false,
    },
    balanceFiat: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.monospace, // Match WalletHome balanceFiat
      color: theme.colors.textSecondary,
      lineHeight: theme.fontSizes?.lg ? theme.fontSizes.lg * 1.2 : 19,
      includeFontPadding: false,
    },
    bitcoinAddress: {
      ...COMMON_FONT_CONFIGS.bitcoinAddress,
      color: theme.colors.text,
    },
    transactionAmount: {
      ...FONT_STYLES.amount,
      color: theme.colors.received,
    },
    transactionAmountSent: {
      ...FONT_STYLES.amount,
      color: theme.colors.sent,
    },
    buttonText: {
      ...FONT_STYLES.button,
      color: theme.colors.textOnPrimary,
    },
    headerText: {
      ...FONT_STYLES.h2,
      color: theme.colors.text,
    },
    bodyText: {
      ...FONT_STYLES.body,
      color: theme.colors.text,
    },
    captionText: {
      ...FONT_STYLES.caption,
      color: theme.colors.textSecondary,
    },
    sectionTitle: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginTop: 24,
      marginBottom: 12,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    note: {
      marginTop: 24,
      padding: 12,
      borderRadius: 8,
      backgroundColor: theme.colors.cardBackground,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    noteText: {
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
      lineHeight: 18,
      textAlign: 'center',
    },
    buttonContainer: {
      backgroundColor: theme.colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 8,
      marginTop: 8,
    },
  });
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      overScrollMode="never"
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Font Comparison Test</Text>
        <View style={styles.platformBadge}>
          <Text style={styles.platformText}>{Platform.OS.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.sectionTitle}>Bitcoin Wallet UI Patterns</Text>
      <ComparisonRow
        label="Balance (BTC)"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text style={styles.balanceAmount}>0.12345678</Text>
      </ComparisonRow>
      <ComparisonRow
        label="Balance (Fiat)"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text style={styles.balanceFiat}>$5,234.56</Text>
      </ComparisonRow>
      <ComparisonRow
        label="Bitcoin Address"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text style={styles.bitcoinAddress}>
          bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh
        </Text>
      </ComparisonRow>
      <ComparisonRow
        label="Transaction (Received)"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text style={styles.transactionAmount}>+0.00123456 BTC</Text>
      </ComparisonRow>
      <ComparisonRow
        label="Transaction (Sent)"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text style={styles.transactionAmountSent}>-0.00050000 BTC</Text>
      </ComparisonRow>
      <ComparisonRow
        label="Header Text"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text style={styles.headerText}>Wallet Balance</Text>
      </ComparisonRow>
      <ComparisonRow
        label="Body Text"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text style={styles.bodyText}>
          This is regular body text used throughout the app for descriptions and
          information.
        </Text>
      </ComparisonRow>
      <ComparisonRow
        label="Caption Text"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text style={styles.captionText}>
          Small caption text for secondary information
        </Text>
      </ComparisonRow>
      <ComparisonRow
        label="Button Text"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <View style={styles.buttonContainer}>
          <Text style={styles.buttonText}>Send Bitcoin</Text>
        </View>
      </ComparisonRow>
      <Text style={styles.sectionTitle}>Font Weights</Text>
      <ComparisonRow
        label="Regular (400)"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text
          style={{
            fontSize: theme.fontSizes?.base || 14,
            color: theme.colors.text,
          }}>
          Inter Regular weight text
        </Text>
      </ComparisonRow>
      <ComparisonRow
        label="Medium (500)"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text
          style={{
            fontSize: theme.fontSizes?.base || 14,
            fontFamily: theme.fontFamilies?.medium,
            color: theme.colors.text,
          }}>
          Inter Medium weight text
        </Text>
      </ComparisonRow>
      <ComparisonRow
        label="SemiBold (600)"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text
          style={{
            fontSize: theme.fontSizes?.base || 14,
            fontFamily: theme.fontFamilies?.bold,
            color: theme.colors.text,
          }}>
          Inter SemiBold weight text
        </Text>
      </ComparisonRow>
      <Text style={styles.sectionTitle}>Monospace (Bitcoin Content)</Text>
      <ComparisonRow
        label="Address (14px)"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text
          style={{
            ...COMMON_FONT_CONFIGS.bitcoinAddress,
            color: theme.colors.text,
          }}>
          bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4
        </Text>
      </ComparisonRow>
      <ComparisonRow
        label="Transaction ID"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text
          style={{
            fontSize: theme.fontSizes?.sm || 12,
            fontFamily: theme.fontFamilies?.monospace,
            color: theme.colors.text,
          }}>
          a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d
        </Text>
      </ComparisonRow>
      <ComparisonRow
        label="Seed Phrase"
        rowStyle={styles.row}
        labelContainerStyle={styles.labelContainer}
        rowLabelStyle={styles.rowLabel}
        contentContainerStyle={styles.contentContainer}
        borderColor={theme.colors.border}
        textSecondaryColor={theme.colors.textSecondary}>
        <Text
          style={{
            ...COMMON_FONT_CONFIGS.seedPhrase,
            color: theme.colors.text,
          }}>
          abandon ability able about above absent absorb abstract
        </Text>
      </ComparisonRow>
      <View style={styles.note}>
        <Text style={styles.noteText}>
          📸 Screenshot this screen on both iOS and Android, then compare
          side-by-side. All text should look identical across platforms.
        </Text>
      </View>
    </ScrollView>
  );
};
export default FontComparisonScreen;
