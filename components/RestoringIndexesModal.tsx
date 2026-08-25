import React from 'react';
import {Modal, View, StyleSheet, ActivityIndicator} from 'react-native';
import AppText from './AppText';
import GlassModalOverlay from './GlassModalOverlay';
import {useTheme} from '../theme';
import {getGapLimit} from '../services/HdOptionsConfig';
import {formatSyncFillProgress} from '../services/syncFillWindow';

/**
 * Non-dismissible modal shown during restore discovery / chain indexing.
 * Used when clearing storage or importing keyshare.
 *
 * phase — optional free-text label (e.g. "Syncing balances…", "Syncing transactions…").
 * progress — when set with phase, show address progress e.g. "3 of 5 addresses".
 */
const RestoringIndexesModal: React.FC<{
  visible: boolean;
  chain?: 'external' | 'internal';
  index?: number;
  gapIndex?: number;
  phase?: string;
  progress?: { current: number; total: number };
}> = ({visible, chain, index = 0, gapIndex = 0, phase, progress}) => {
  const {theme} = useTheme();
  const chainLabel = chain === 'external' ? 'Receive' : chain === 'internal' ? 'Change' : null;
  const progressLabel = formatSyncFillProgress(progress);
  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: {
      backgroundColor: theme.colors.cardBackground,
      padding: 24,
      borderRadius: 12,
      alignItems: 'center',
      minWidth: 240,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    spinner: {
      marginBottom: 16,
    },
    title: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 4,
    },
    subtitle: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        // Non-dismissible: ignore back button
      }}
      statusBarTranslucent>
      <GlassModalOverlay style={styles.overlay}>
        <View style={styles.content}>
          <ActivityIndicator
            size="large"
            color={theme.colors.primary}
            style={styles.spinner}
          />
          <AppText style={styles.title}>
            {phase ? 'Syncing wallet' : 'Restoring indexes'}
          </AppText>
          <AppText style={styles.subtitle} tone="muted">
            {phase
              ? progressLabel
                ? `${phase} ${progressLabel}`
                : phase
              : chainLabel
              ? `Scanning ${chainLabel} chain… index ${index}, gap ${gapIndex}/${getGapLimit()}`
              : 'Scanning chain for addresses…'}
          </AppText>
        </View>
      </GlassModalOverlay>
    </Modal>
  );
};

export default RestoringIndexesModal;
