import React from 'react';
import {
  Image,
  ImageSourcePropType,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import {useTheme} from '../theme';

type Props = {
  icon: ImageSourcePropType;
  title: string;
  subtitle?: string;
  style?: ViewStyle;
};

/** Logo top-left with title (and optional subtitle) beside it for MPC progress modals. */
export function MpcProgressModalHeader({
  icon,
  title,
  subtitle,
  style,
}: Props) {
  const {theme} = useTheme();
  const accent =
    theme.colors.background === '#ffffff'
      ? theme.colors.primary
      : theme.colors.bitcoinOrange;

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        <View style={[styles.iconBg, {backgroundColor: accent + '20'}]}>
          <Image
            source={icon}
            style={[styles.icon, {tintColor: accent}]}
            resizeMode="contain"
          />
        </View>
        <Text
          style={[
            styles.title,
            {
              color: theme.colors.text,
              fontFamily: theme.fontFamilies?.bold,
              fontSize: theme.fontSizes?.xl || 18,
            },
          ]}
          numberOfLines={2}>
          {title}
        </Text>
      </View>
      {subtitle ? (
        <Text
          style={[
            styles.subtitle,
            {
              color: theme.colors.textSecondary,
              fontFamily: theme.fontFamilies?.regular,
              fontSize: theme.fontSizes?.base || 14,
            },
          ]}
          numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    width: '100%',
    marginBottom: 16,
  },
  row: {
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
    textAlign: 'left',
    lineHeight: 24,
  },
  subtitle: {
    textAlign: 'left',
    lineHeight: 20,
    marginTop: 10,
  },
});
