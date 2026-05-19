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
};

const TssBackendBadge: React.FC<Props> = ({backend}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const isDkls = backend === 'dkls23';
  return (
    <View
      style={[
        styles.keyshareBadge,
        isDkls ? styles.keyshareBadgeDkls : styles.keyshareBadgeGg18,
        badgeStyles.container,
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
  },
  label: {
    flex: 0,
    flexGrow: 0,
    flexShrink: 1,
  },
};

export default TssBackendBadge;
