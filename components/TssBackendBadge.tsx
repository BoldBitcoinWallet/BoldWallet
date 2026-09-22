import React from 'react';
import {View, Text} from 'react-native';
import {useTheme} from '../theme';
import {createStyles} from './Styles';
import {
  getTssBackendDisplayLabel,
  type TssBackend,
} from '../services/tssBackend';

type Props = {
  backend: TssBackend;
  /** Match the device-entropy pill height. Default stays the compact keyshare chip. */
  size?: 'default' | 'pairing';
};

const TssBackendBadge: React.FC<Props> = ({backend, size = 'default'}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const isDkls = backend === 'dkls23';
  const pairing = size === 'pairing';
  return (
    <View
      style={[
        styles.keyshareBadge,
        isDkls ? styles.keyshareBadgeDkls : styles.keyshareBadgeGg18,
        pairing ? badgeStyles.pairing : badgeStyles.container,
      ]}>
      <Text style={[styles.keyshareBadgeText, badgeStyles.label]} numberOfLines={1}>
        {getTssBackendDisplayLabel(backend)}
      </Text>
    </View>
  );
};

/** Compact badge for pairing screens — avoid keyshareBadgeText flex:1 stretching vertically. */
const badgeStyles = {
  container: {
    alignSelf: 'center' as const,
    minHeight: 28,
    justifyContent: 'center' as const,
  },
  pairing: {
    alignSelf: 'stretch' as const,
    height: 40,
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 0,
    justifyContent: 'center' as const,
  },
  label: {
    flex: 0,
    flexGrow: 0,
    flexShrink: 1,
  },
};

export default TssBackendBadge;
