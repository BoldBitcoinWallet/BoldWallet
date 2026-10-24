import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';

type BackupNudgeCardProps = {
  visible: boolean;
  onBackUp: () => void;
};

/**
 * 3b-6e: soft persistent "backup recommended" indicator. Shown on
 * Wallet home while the stale-backup flag is set (legacy import or
 * post-migration dismissal); clears itself on fresh export.
 * Non-blocking by design — no alert, no scary language.
 */
const BackupNudgeCard: React.FC<BackupNudgeCardProps> = ({
  visible,
  onBackUp,
}) => {
  const {theme} = useTheme();
  if (!visible) {
    return null;
  }
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.warningBg,
          borderColor: theme.colors.warningBorder,
        },
      ]}
      accessibilityRole="alert">
      <Text style={[styles.text, {color: theme.colors.text}]}>
        Backup recommended — your keyshare backup uses an older format.
      </Text>
      <AppPressable
        onPress={onBackUp}
        style={[styles.button, {backgroundColor: theme.colors.primary}]}
        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
        accessibilityRole="button"
        accessibilityLabel="Back up now">
        <Text style={styles.buttonText}>Back up</Text>
      </AppPressable>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 12,
    gap: 12,
  },
  text: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default BackupNudgeCard;
