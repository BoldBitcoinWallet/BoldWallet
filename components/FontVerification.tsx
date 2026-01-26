/**
 * FontVerification Component
 * Simple component to visually verify font unification across platforms
 * Add this to any screen to quickly check if fonts are rendering consistently
 */
import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {useTheme} from '../theme';
const FontVerification: React.FC = () => {
  const {theme} = useTheme();
  const styles = StyleSheet.create({
    container: {
      padding: 16,
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 8,
      margin: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    title: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies.bold,
      color: theme.colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    testRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    label: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies.regular,
      color: theme.colors.textSecondary,
      width: 80,
    },
    testText: {
      flex: 1,
      fontSize: theme.fontSizes?.base || 14,
      color: theme.colors.text,
    },
    regular: {
      fontFamily: theme.fontFamilies.regular,
    },
    medium: {
      fontFamily: theme.fontFamilies.medium,
    },
    bold: {
      fontFamily: theme.fontFamilies.bold,
    },
    mono: {
      fontFamily: theme.fontFamilies.monospace,
    },
  });
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Font Verification Test</Text>
      <View style={styles.testRow}>
        <Text style={styles.label}>Regular:</Text>
        <Text style={[styles.testText, styles.regular]}>
          The quick brown fox jumps
        </Text>
      </View>
      <View style={styles.testRow}>
        <Text style={styles.label}>Medium:</Text>
        <Text style={[styles.testText, styles.medium]}>
          The quick brown fox jumps
        </Text>
      </View>
      <View style={styles.testRow}>
        <Text style={styles.label}>Bold:</Text>
        <Text style={[styles.testText, styles.bold]}>
          The quick brown fox jumps
        </Text>
      </View>
      <View style={styles.testRow}>
        <Text style={styles.label}>Monospace:</Text>
        <Text style={[styles.testText, styles.mono]}>
          1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
        </Text>
      </View>
    </View>
  );
};
export default FontVerification;
