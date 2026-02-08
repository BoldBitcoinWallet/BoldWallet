import React from 'react';
import {Text, TextProps, TextStyle, StyleProp} from 'react-native';
import {useTheme, FONT_STYLES} from '../theme';

type AppTextVariant = 'body' | 'caption' | 'h1' | 'h2' | 'button';

type AppTextTone =
  | 'default'
  | 'muted'
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'onPrimary';

export interface AppTextProps extends TextProps {
  variant?: AppTextVariant;
  tone?: AppTextTone;
  style?: StyleProp<TextStyle>;
}

const AppText: React.FC<AppTextProps> = ({
  variant = 'body',
  tone = 'default',
  style,
  children,
  ...rest
}) => {
  const {theme} = useTheme();

  let base: TextStyle;
  switch (variant) {
    case 'h1':
      base = FONT_STYLES.h1;
      break;
    case 'h2':
      base = FONT_STYLES.h2;
      break;
    case 'button':
      base = FONT_STYLES.button;
      break;
    case 'caption':
      base = FONT_STYLES.caption;
      break;
    case 'body':
    default:
      base = FONT_STYLES.body;
      break;
  }

  let colorStyle: TextStyle;
  switch (tone) {
    case 'muted':
      colorStyle = {color: theme.colors.textSecondary};
      break;
    case 'primary':
      colorStyle = {color: theme.colors.primary};
      break;
    case 'secondary':
      colorStyle = {color: theme.colors.secondary};
      break;
    case 'danger':
      colorStyle = {color: theme.colors.danger};
      break;
    case 'onPrimary':
      colorStyle = {color: theme.colors.textOnPrimary};
      break;
    case 'default':
    default:
      colorStyle = {color: theme.colors.text};
      break;
  }

  return (
    <Text {...rest} style={[base, colorStyle, style]}>
      {children}
    </Text>
  );
};

export default AppText;

