import React from 'react';
import {View, StyleSheet, ActivityIndicator, Image} from 'react-native';
import AppModal from './AppModal';
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
  progress?: {current: number; total: number};
}> = ({visible, chain, index = 0, gapIndex = 0, phase, progress}) => {
  const {theme} = useTheme();
  const accent =
    theme.colors.background === '#ffffff'
      ? theme.colors.primary
      : theme.colors.bitcoinOrange;
  const chainLabel =
    chain === 'external' ? 'Receive' : chain === 'internal' ? 'Change' : null;
  const progressLabel = formatSyncFillProgress(progress);
  const title = phase ? 'Syncing wallet' : 'Restoring indexes';
  const hint = phase
    ? 'Addresses and balances are updating. Keep Bold open.'
    : 'Scanning the chain for your addresses. Keep Bold open.';
  const statusLine = phase
    ? progressLabel
      ? `${phase} ${progressLabel}`
      : phase
    : chainLabel
      ? `Scanning ${chainLabel} chain… index ${index}, gap ${gapIndex}/${getGapLimit()}`
      : 'Scanning chain for addresses…';

  return (
    <AppModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        // Non-dismissible: ignore back button
      }}
      statusBarTranslucent>
      <GlassModalOverlay style={styles.overlay}>
        <View
          style={[
            styles.content,
            {
              backgroundColor: theme.colors.cardBackground,
              borderColor:
                theme.colors.background === '#ffffff'
                  ? theme.colors.blackOverlay10
                  : theme.colors.whiteOverlay20,
            },
          ]}>
          <View style={styles.headerRow}>
            <View style={[styles.iconBg, {backgroundColor: accent + '20'}]}>
              <Image
                source={require('../assets/refresh-icon.png')}
                style={[styles.icon, {tintColor: accent}]}
                resizeMode="contain"
              />
            </View>
            <AppText
              style={[
                styles.title,
                {
                  color: theme.colors.text,
                  fontFamily: theme.fontFamilies?.bold,
                },
              ]}>
              {title}
            </AppText>
          </View>
          <AppText
            style={[
              styles.hint,
              {
                color: theme.colors.textSecondary,
                fontFamily: theme.fontFamilies?.regular,
              },
            ]}
            tone="muted">
            {hint}
          </AppText>
          <ActivityIndicator
            size="large"
            color={accent}
            style={styles.spinner}
          />
          <AppText
            style={[
              styles.subtitle,
              {
                color: theme.colors.textSecondary,
                fontFamily: theme.fontFamilies?.regular,
              },
            ]}
            tone="muted">
            {statusLine}
          </AppText>
        </View>
      </GlassModalOverlay>
    </AppModal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 20,
    borderRadius: 16,
    width: '86%',
    maxWidth: 360,
    borderWidth: 1,
    alignItems: 'stretch',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 22,
    height: 22,
  },
  title: {
    flex: 1,
    marginLeft: 12,
    fontSize: 18,
    textAlign: 'left',
    lineHeight: 24,
  },
  hint: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'left',
  },
  spinner: {
    marginTop: 18,
    marginBottom: 12,
    alignSelf: 'center',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});

export default RestoringIndexesModal;
