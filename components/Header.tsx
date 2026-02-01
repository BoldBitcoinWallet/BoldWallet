import React from 'react';
import {
  Text,
  Pressable,
  View as RNView,
  StyleSheet,
  Platform,
} from 'react-native';
import {Image} from 'react-native';
import {View} from 'react-native';
import {useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {createStyles} from './Styles';
import {HapticFeedback, presentFiat, getCurrencySymbol} from '../utils';
import type {NativeStackHeaderProps} from '@react-navigation/native-stack';
interface HeaderPriceButtonProps {
  btcPrice?: string;
  selectedCurrency?: string;
  onCurrencyPress?: () => void;
}
interface HeaderNetworkProviderProps {
  network?: string;
  apiBase?: string;
  onPress?: () => void;
}
export const HeaderNetworkProvider: React.FC<HeaderNetworkProviderProps> = ({
  network,
  apiBase,
  onPress,
}) => {
  const {theme} = useTheme();
  const isDarkMode = theme.colors.background !== '#ffffff';
  const cleanProviderUrl = apiBase
    ? apiBase.replace('https://', '').replace('/api', '').replace(/\/+$/, '')
    : 'Loading...';
  const networkLabel = network
    ? network === 'mainnet'
      ? 'MAINNET'
      : 'TESTNET'
    : '';
  const hasProvider = Boolean(cleanProviderUrl);
  const hasNetwork = Boolean(networkLabel);
  if (!hasProvider && !hasNetwork) {
    return null;
  }
  const pillBorder = isDarkMode
    ? theme.colors.border + '80'
    : theme.colors.blackOverlay10;
  // Part 1 (top 50%): distinct background – clearly different from part 2
  const part1Bg = isDarkMode
    ? theme.colors.whiteOverlay15
    : theme.colors.blackOverlay10;
  // Part 2 (bottom 50%)
  const part2Bg = isDarkMode
    ? theme.colors.whiteOverlay08
    : theme.colors.blackOverlay05;
  const containerStyle: any = {
    height: 36,
    minWidth: 160,
    maxWidth: 280,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: pillBorder,
    overflow: 'hidden',
  };
  const innerColumnStyle: any = {
    flex: 1,
    flexDirection: 'column',
    height: 36,
  };
  // Each part exactly 18px (50%); content centered vertical + horizontal
  const partBase: any = {
    height: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  };
  const part1Style: any = { ...partBase, backgroundColor: part1Bg };
  const part2Style: any = { ...partBase, backgroundColor: part2Bg };
  const providerTextStyle: any = {
    fontSize: theme.fontSizes?.xs || 9,
    fontFamily: theme.fontFamilies?.medium,
    color: theme.colors.textSecondary,
    flexShrink: 1,
    maxWidth: 264,
    textAlign: 'center',
  };
  const networkBadgeStyle: any = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  };
  const networkBadgeTextStyle: any = {
    fontSize: theme.fontSizes?.xs || 8,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textSecondary,
    letterSpacing: 0.2,
  };
  const dotStyle: any = {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.textSecondary,
  };
  const content = (
    <View style={innerColumnStyle}>
      <View style={part1Style}>
        {hasNetwork ? (
          <View style={networkBadgeStyle}>
            <View style={dotStyle} />
            <Text style={networkBadgeTextStyle}>{networkLabel}</Text>
          </View>
        ) : null}
      </View>
      <View style={part2Style}>
        {hasProvider ? (
          <Text
            style={providerTextStyle}
            numberOfLines={1}
            ellipsizeMode="middle">
            {cleanProviderUrl}
          </Text>
        ) : null}
      </View>
    </View>
  );
  if (onPress) {
    return (
      <Pressable
        style={containerStyle}
        onPress={() => {
          HapticFeedback.light();
          onPress();
        }}
        android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`Provider: ${cleanProviderUrl}. Network: ${networkLabel}. Double tap to open settings.`}>
        {content}
      </Pressable>
    );
  }
  return <View style={containerStyle}>{content}</View>;
};
export const HeaderPriceButton: React.FC<HeaderPriceButtonProps> = ({
  btcPrice,
  selectedCurrency,
  onCurrencyPress,
}) => {
  const {theme} = useTheme();
  const priceButtonStyle: any = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor:
      theme.colors.background === '#121212' ||
      theme.colors.background.includes('12')
        ? theme.colors.cardBackground
        : theme.colors.blackOverlay06, // Light mode background
    borderWidth: 1,
    borderColor:
      theme.colors.background === '#121212' ||
      theme.colors.background.includes('12')
        ? theme.colors.border + '80'
        : theme.colors.blackOverlay10, // Light mode border
    paddingHorizontal: 14,
    paddingVertical: 0,
    borderRadius: 10,
    height: 36,
    minWidth: 90,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: Platform.OS === 'android' ? 0 : 1,
  };
  const headerBtcLogoStyle: any = {
    width: 20,
    height: 20,
    resizeMode: 'contain',
  };
  const headerBtcPriceStyle: any = {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    lineHeight: 14,
  };
  const headerCurrencySymbolStyle: any = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textSecondary,
    lineHeight: 14,
  };
  if (btcPrice === undefined || !onCurrencyPress) {
    return null;
  }
  const containerStyle: any = {
    paddingLeft: 16,
    paddingTop: 12,
    paddingBottom: 12,
  };
  const currencySymbol = selectedCurrency
    ? getCurrencySymbol(selectedCurrency)
    : '';
  return (
    <RNView style={containerStyle}>
      <Pressable
        style={priceButtonStyle}
        onPress={() => {
          HapticFeedback.light();
          onCurrencyPress();
        }}
        android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`Bitcoin price: ${
          btcPrice ? presentFiat(btcPrice) : '-'
        } ${selectedCurrency || ''}`}
        accessibilityHint="Double tap to change currency">
        <Image
          source={require('../assets/bitcoin-logo.png')}
          style={headerBtcLogoStyle}
        />
        <Text style={headerBtcPriceStyle}>
          {btcPrice ? presentFiat(btcPrice) : '-'} {currencySymbol}
        </Text>
      </Pressable>
    </RNView>
  );
};
interface HeaderRightButtonProps {
  navigation: any;
  network?: string;
  apiBase?: string;
}
export const HeaderRightButton: React.FC<HeaderRightButtonProps> = ({
  navigation,
  network,
  apiBase,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const headerButtonsContainer: any = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    paddingTop: 12,
    paddingBottom: 12,
    paddingRight: 16,
    paddingLeft: 16,
    minHeight: 60,
  };
  const isDarkMode =
    theme.colors.background === '#121212' ||
    theme.colors.background.includes('12');
  const settingsButtonStyle: any = {
    ...styles.settingsButton,
    backgroundColor: isDarkMode
      ? theme.colors.cardBackground
      : theme.colors.blackOverlay06,
    borderWidth: 1,
    borderColor: isDarkMode
      ? theme.colors.border + '80'
      : theme.colors.blackOverlay10,
  };
  return (
    <RNView style={headerButtonsContainer}>
      {(network || apiBase) && (
        <HeaderNetworkProvider
          network={network}
          apiBase={apiBase}
          onPress={() => navigation.navigate('Settings')}
        />
      )}
      <Pressable
        style={settingsButtonStyle}
        onPress={() => {
          HapticFeedback.light();
          navigation.navigate('Settings');
        }}
        android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Settings">
        <Image
          source={require('../assets/settings-icon.png')}
          style={styles.settingsLogo}
        />
      </Pressable>
    </RNView>
  );
};
export const HeaderTitle: React.FC<{title?: string}> = () => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const route = useRoute();
  // Map route names to display titles
  const getTitle = () => {
    const routeName = route.name;
    const titleMap: Record<string, string> = {
      Home: 'Home',
      PSBT: 'PSBT',
      Settings: '',
      Welcome: 'Welcome',
      'Devices Pairing': 'Devices Pairing',
      'Nostr Connect': 'Nostr Connect',
    };
    return titleMap[routeName] || '';
  };
  const displayTitle = getTitle();
  const isEmpty = !displayTitle || displayTitle.trim().length === 0;
  // Use inverted icon in dark mode
  const isDarkMode = theme.colors.background !== '#ffffff';
  const iconSource = isDarkMode
    ? require('../assets/icon-inverted.png') // Use inverted icon in dark mode
    : require('../assets/icon.png'); // Original icon in light mode
  // Center the container when title is empty
  const containerStyle = isEmpty
    ? [
        styles.headerTitleContainer,
        {justifyContent: 'center' as const, paddingLeft: 0},
      ]
    : styles.headerTitleContainer;
  // Remove marginRight from logo when title is empty
  const logoStyle = isEmpty
    ? [styles.headerLogo, {marginRight: 0}]
    : styles.headerLogo;
  return (
    <View style={containerStyle}>
      <Image source={iconSource} style={logoStyle} />
      {!isEmpty && <Text style={styles.headerTitleText}>{displayTitle}</Text>}
    </View>
  );
};
/**
 * Custom header component that allows controlling header height
 * @param height - Desired header height in pixels (default: 60)
 */
export const CustomHeader: React.FC<
  NativeStackHeaderProps & {height?: number}
> = ({options, route, navigation, height = 60}) => {
  const insets = useSafeAreaInsets();
  const {theme} = useTheme();
  // Use headerLeft and headerRight from options if provided
  // If headerLeft is not provided and can go back, show default back button
  const canGoBack = navigation.canGoBack();
  let headerLeft: React.ReactNode = null;
  if (options.headerLeft !== undefined) {
    // headerLeft was explicitly set (could be a function or component)
    headerLeft =
      typeof options.headerLeft === 'function'
        ? options.headerLeft({canGoBack})
        : options.headerLeft;
  } else if (canGoBack) {
    // No headerLeft was set, but we can go back - show default back button
    const headerStyles = createCustomHeaderStyles(theme);
    headerLeft = (
      <Pressable
        onPress={() => {
          HapticFeedback.light();
          navigation.goBack();
        }}
        style={headerStyles.backButton}
        android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Go back">
        <Text style={headerStyles.backButtonText}>←</Text>
      </Pressable>
    );
  }
  const headerRight = options.headerRight
    ? typeof options.headerRight === 'function'
      ? options.headerRight({canGoBack: navigation.canGoBack()})
      : options.headerRight
    : null;
  // Get headerTitle - handle function, component, or string
  let headerTitle: React.ReactNode = null;
  if (options.headerTitle) {
    if (typeof options.headerTitle === 'function') {
      headerTitle = options.headerTitle({
        children: options.title || route.name,
      });
    } else {
      headerTitle = options.headerTitle;
    }
  } else if (options.title) {
    headerTitle = options.title;
  } else if (!headerLeft) {
    // Only use route name as fallback if there's no headerLeft
    headerTitle = route.name;
  }
  // Don't render center title if it's empty string or null/undefined
  const shouldRenderCenterTitle =
    headerTitle &&
    headerTitle !== '' &&
    (typeof headerTitle !== 'string' || headerTitle.trim().length > 0);
  const isDarkMode =
    theme.colors.background === '#121212' ||
    theme.colors.background.includes('12');
  const headerBgColor =
    options.headerStyle &&
    typeof options.headerStyle === 'object' &&
    !Array.isArray(options.headerStyle) &&
    'backgroundColor' in options.headerStyle
      ? options.headerStyle.backgroundColor
      : isDarkMode
      ? theme.colors.cardBackground
      : theme.colors.background;
  const headerStyles = createCustomHeaderStyles(theme);
  // Determine what to render in the center
  let centerContent: React.ReactNode = null;
  if (shouldRenderCenterTitle) {
    if (typeof headerTitle === 'string') {
      // Use HeaderTitle component to get the icon + title
      centerContent = <HeaderTitle title={headerTitle} />;
    } else {
      centerContent = headerTitle;
    }
  }
  return (
    <View
      style={[
        headerStyles.container,
        {
          height: height + insets.top,
          paddingTop: insets.top,
          backgroundColor: headerBgColor || theme.colors.background,
        },
      ]}>
      <View style={headerStyles.content}>
        <View style={headerStyles.left}>
          {headerLeft || <View style={headerStyles.placeholder} />}
        </View>
        <View style={headerStyles.center}>{centerContent}</View>
        <View style={headerStyles.right}>
          {headerRight || <View style={headerStyles.placeholder} />}
        </View>
      </View>
    </View>
  );
};
const createCustomHeaderStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      width: '100%',
      justifyContent: 'flex-end',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border + '40', // Use theme border color
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 60,
      paddingHorizontal: 0,
    },
    left: {
      flex: 1,
      alignItems: 'flex-start',
    },
    center: {
      flex: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    right: {
      flex: 1,
      alignItems: 'flex-end',
    },
    placeholder: {
      width: 40,
    },
    backButton: {
      padding: 8,
      marginLeft: 8,
    },
    backButtonText: {
      fontSize: theme.fontSizes?.['3xl'] || 24,
      color: theme.colors.text,
    },
  });
