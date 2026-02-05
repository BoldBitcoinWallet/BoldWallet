import React from 'react';
import {
  Text,
  View as RNView,
  StyleSheet,
  Platform,
} from 'react-native';
import AppPressable from './AppPressable';
import {Image} from 'react-native';
import {View} from 'react-native';
import {useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import AppText from './AppText';
import {createStyles} from './Styles';
import {presentFiat, getCurrencySymbol} from '../utils';
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
  onSettingsPress?: () => void;
}

/** Shared width for price (left) and network (right) buttons so they match. */
export const SIDE_BUTTON_WIDTH = 90;

export const HeaderNetworkProvider: React.FC<HeaderNetworkProviderProps> = ({
  network,
  apiBase,
  onPress,
  onSettingsPress,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const cleanProviderUrl = apiBase
    ? apiBase.replace('https://', '').replace('/api', '').replace(/\/+$/, '')
    : 'Loading...';
  const providerHost = cleanProviderUrl.includes('/')
    ? cleanProviderUrl.split('/')[0]
    : cleanProviderUrl;
  const networkLabel = network
    ? network === 'mainnet'
      ? 'MAINNET'
      : 'TESTNET'
    : '';
  const hasProvider = Boolean(providerHost && providerHost !== 'Loading...');
  const hasNetwork = Boolean(networkLabel);
  if (!hasProvider && !hasNetwork && !onSettingsPress) {
    return null;
  }
  const showLeftContent = hasProvider || hasNetwork;
  const isMainnet = networkLabel === 'MAINNET';
  const isDarkMode = theme.colors.background !== '#ffffff';
  // Theme-aware: match HeaderPriceButton container (cardBackground / blackOverlay06 + border)
  const containerBg = isDarkMode
    ? theme.colors.cardBackground
    : theme.colors.blackOverlay06;
  const containerBorderColor = isDarkMode
    ? theme.colors.border + '80'
    : theme.colors.blackOverlay10;
  // Network: same base as provider but visibly darker (light = cardBackground, dark = border)
  const networkBg = isDarkMode
    ? theme.colors.border
    : theme.colors.cardBackground;
  const providerBg = containerBg;
  const providerTextColor = isMainnet
    ? theme.colors.primary
    : theme.colors.secondary;
  const segmentDividerColor = theme.colors.border;
  const pillHeight = 46;
  const innerHeight = pillHeight - 2;
  const innerRadius = 9;
  const rowHeight = Math.floor(innerHeight / 2);
  const containerStyle: any = {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: pillHeight,
    minWidth: !showLeftContent && onSettingsPress ? 56 : undefined,
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: containerBorderColor,
    backgroundColor: containerBg,
    overflow: 'hidden',
  };
  const leftContentStyle: any = {
    flexShrink: 0,
    justifyContent: 'center',
    borderRadius: 10,
    overflow: 'hidden',
  };
  const stackWrapStyle: any = {
    flexDirection: 'column',
    height: innerHeight,
  };
  const networkSegmentStyle: any = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: rowHeight,
    paddingHorizontal: 10,
    backgroundColor: networkBg,
    borderTopLeftRadius: innerRadius,
    borderTopRightRadius: innerRadius,
    overflow: 'hidden',
    ...(!hasProvider && hasNetwork
      ? {
          borderBottomLeftRadius: innerRadius,
          borderBottomRightRadius: innerRadius,
        }
      : {}),
  };
  const horizontalDividerStyle: any = {
    height: 1,
    backgroundColor: segmentDividerColor,
    alignSelf: 'stretch',
  };
  const verticalDividerStyle: any = {
    width: 1,
    backgroundColor: segmentDividerColor,
    alignSelf: 'stretch',
  };
  const providerSegmentStyle: any = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    height: rowHeight,
    paddingLeft: 10,
    paddingRight: 10,
    flexShrink: 1,
    backgroundColor: providerBg,
    borderBottomLeftRadius: innerRadius,
    borderBottomRightRadius: innerRadius,
    overflow: 'hidden',
    ...(hasProvider && !hasNetwork
      ? {borderTopLeftRadius: innerRadius, borderTopRightRadius: innerRadius}
      : {}),
  };
  const segmentIconStyle: any = {
    width: 14,
    height: 14,
    resizeMode: 'contain',
    marginRight: 5,
  };
  const providerTextWrapStyle: any = {
    flex: 1,
    justifyContent: 'center',
  };
  const providerTextStyle: any = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.medium,
    color: providerTextColor,
    textAlign: 'left',
  };
  const providerIconStyle: any = {
    ...segmentIconStyle,
    tintColor: providerTextColor,
  };
  const networkTextStyle: any = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    letterSpacing: 0.3,
    marginLeft: 4,
    flexShrink: 0,
  };
  const networkIconStyle: any = {
    ...segmentIconStyle,
    tintColor: theme.colors.text,
  };
  const settingsStripStyle: any = {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: providerBg,
  };
  const leftContent = showLeftContent ? (
    <View style={stackWrapStyle}>
      {hasNetwork ? (
        <View style={networkSegmentStyle}>
          <Image
            source={
              isMainnet
                ? require('../assets/mainnet-icon.png')
                : require('../assets/testnet-icon.png')
            }
            style={networkIconStyle}
          />
          <AppText style={networkTextStyle}>{networkLabel}</AppText>
        </View>
      ) : null}
      {hasProvider && hasNetwork ? (
        <View style={horizontalDividerStyle} />
      ) : null}
      {hasProvider ? (
        <View style={providerSegmentStyle}>
          <Image
            source={require('../assets/api-icon.png')}
            style={providerIconStyle}
          />
          <View style={providerTextWrapStyle}>
            <AppText
              style={providerTextStyle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}>
              {providerHost}
            </AppText>
          </View>
        </View>
      ) : null}
    </View>
  ) : null;
  const leftWrapped =
    onPress && showLeftContent ? (
      <AppPressable
        style={leftContentStyle}
        onPress={() => {
          onPress();
        }}
        android_ripple={{color: 'rgba(0,0,0,0.08)'}}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`Provider: ${providerHost}. Network: ${networkLabel}. Double tap to open settings.`}>
        {leftContent}
      </AppPressable>
    ) : (
      <View style={leftContentStyle}>{leftContent}</View>
    );
  const rightStrip = onSettingsPress ? (
    <>
      <View style={verticalDividerStyle} />
      <AppPressable
        style={settingsStripStyle}
        onPress={() => {
          onSettingsPress();
        }}
        android_ripple={{color: 'rgba(0,0,0,0.08)'}}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        accessibilityHint="Double tap to open settings">
        <Image
          source={require('../assets/settings-icon.png')}
          style={styles.settingsLogo}
        />
      </AppPressable>
    </>
  ) : null;
  return (
    <View style={containerStyle}>
      {leftWrapped}
      {rightStrip}
    </View>
  );
};

interface HeaderProviderProps {
  apiBase?: string;
}
export const HeaderProvider: React.FC<HeaderProviderProps> = ({apiBase}) => {
  const {theme} = useTheme();
  const cleanProviderUrl = apiBase
    ? apiBase.replace('https://', '').replace('/api', '').replace(/\/+$/, '')
    : '';
  const providerHost = cleanProviderUrl.includes('/')
    ? cleanProviderUrl.split('/')[0]
    : cleanProviderUrl;
  const hasProvider = Boolean(providerHost && providerHost !== 'Loading...');
  if (!hasProvider) {
    return null;
  }
  const isDarkMode = theme.colors.background !== '#ffffff';
  const containerBg = isDarkMode
    ? theme.colors.cardBackground
    : theme.colors.blackOverlay06;
  const containerBorderColor = isDarkMode
    ? theme.colors.border + '80'
    : theme.colors.blackOverlay10;
  const providerTextColor = theme.colors.text;
  const pillHeight = 36;
  const innerRadius = 9;
  const containerStyle: any = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    alignSelf: 'stretch',
    minWidth: 80,
    height: pillHeight,
    paddingLeft: 10,
    paddingRight: 10,
    borderRadius: innerRadius,
    borderWidth: 1,
    borderColor: containerBorderColor,
    backgroundColor: containerBg,
    overflow: 'hidden',
  };
  const innerRowStyle: any = {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: '100%',
    flexShrink: 1,
  };
  const providerTextWrapStyle: any = {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  };
  const providerTextStyle: any = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.medium,
    color: providerTextColor,
    textAlign: 'center',
  };
  const providerIconStyle: any = {
    width: 14,
    height: 14,
    marginRight: 5,
    tintColor: providerTextColor,
  };
  const wrapperStyle: any = {
    paddingTop: 12,
    paddingBottom: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
    alignSelf: 'stretch',
  };
  return (
    <View style={wrapperStyle}>
      <View style={containerStyle}>
        <View style={innerRowStyle}>
          <Image
            source={require('../assets/api-icon.png')}
            style={providerIconStyle}
          />
          <View style={providerTextWrapStyle}>
            <Text
              style={providerTextStyle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.3}
              ellipsizeMode="tail">
              {providerHost}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

interface HeaderNetworkProps {
  network?: string;
  onPress?: () => void;
}
export const HeaderNetwork: React.FC<HeaderNetworkProps> = ({
  network,
  onPress,
}) => {
  const {theme} = useTheme();
  const networkLabel = network
    ? network === 'mainnet'
      ? 'MAINNET'
      : 'TESTNET'
    : '';
  if (!networkLabel) {
    return null;
  }
  const isMainnet = networkLabel === 'MAINNET';
  const isDarkMode = theme.colors.background !== '#ffffff';
  const containerBorderColor = isDarkMode
    ? theme.colors.border + '80'
    : theme.colors.blackOverlay10;
  const networkBg = isMainnet
    ? theme.colors.primary
    : isDarkMode
    ? theme.colors.bitcoinOrange
    : theme.colors.accent;
  const pillHeight = 36;
  const innerRadius = 9;
  // Pill style: same shape as price button so ripple is clipped to the visible button
  const pillStyle: any = {
    width: SIDE_BUTTON_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: pillHeight,
    borderRadius: innerRadius,
    borderWidth: 1,
    borderColor: containerBorderColor,
    backgroundColor: networkBg,
    overflow: 'hidden',
  };
  const wrapperStyle: any = {
    paddingTop: 12,
    paddingBottom: 12,
    marginRight: 16,
    justifyContent: 'center',
  };
  const textStyle: any = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textOnPrimary,
    letterSpacing: 0.3,
    marginLeft: 4,
  };
  const networkIconStyle: any = {
    width: 14,
    height: 14,
    tintColor: theme.colors.textOnPrimary,
  };
  const content = (
    <>
      <Image
        source={
          isMainnet
            ? require('../assets/mainnet-icon.png')
            : require('../assets/testnet-icon.png')
        }
        style={networkIconStyle}
      />
      <Text style={textStyle}>{networkLabel}</Text>
    </>
  );
  if (onPress) {
    return (
      <RNView style={wrapperStyle}>
        <AppPressable
          onPress={() => {
            onPress();
          }}
          android_ripple={{color: 'rgba(0,0,0,0.1)'}}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Network: ${networkLabel}. Double tap to open settings.`}
          style={pillStyle}>
          {content}
        </AppPressable>
      </RNView>
    );
  }
  return (
    <RNView style={wrapperStyle}>
      <View style={pillStyle}>{content}</View>
    </RNView>
  );
};

export const HeaderPriceButton: React.FC<HeaderPriceButtonProps> = ({
  btcPrice,
  selectedCurrency,
  onCurrencyPress,
}) => {
  const {theme} = useTheme();
  const isDarkMode = theme.colors.background !== '#ffffff';
  const priceButtonStyle: any = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: isDarkMode
      ? theme.colors.cardBackground
      : theme.colors.blackOverlay06, // Light mode background
    borderWidth: 1,
    borderColor: isDarkMode
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
  if (btcPrice === undefined || !onCurrencyPress) {
    return null;
  }
  const containerStyle: any = {
    width: SIDE_BUTTON_WIDTH,
    paddingLeft: 16,
    paddingTop: 12,
    paddingBottom: 12,
    justifyContent: 'center',
  };
  return (
    <RNView style={containerStyle}>
      <AppPressable
        style={priceButtonStyle}
        onPress={() => {
          onCurrencyPress();
        }}
        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
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
          {btcPrice ? presentFiat(btcPrice) : '-'}{' '}
          {getCurrencySymbol(selectedCurrency) || ''}
        </Text>
      </AppPressable>
    </RNView>
  );
};

interface HeaderPriceProviderNetworkProps {
  btcPrice?: string;
  selectedCurrency?: string;
  onCurrencyPress?: () => void;
  network?: string;
  apiBase?: string;
  onSettingsPress?: () => void;
}
export const HeaderPriceProviderNetwork: React.FC<
  HeaderPriceProviderNetworkProps
> = ({
  btcPrice,
  selectedCurrency,
  onCurrencyPress,
  network,
  apiBase,
  onSettingsPress,
}) => {
  const barStyle: any = {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    paddingHorizontal: 8,
  };
  const leftSlotStyle: any = {
    width: SIDE_BUTTON_WIDTH,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  };
  const middleSlotStyle: any = {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  };
  const rightSlotStyle: any = {
    width: SIDE_BUTTON_WIDTH,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  };
  return (
    <View style={barStyle}>
      <View style={leftSlotStyle}>
        <HeaderPriceButton
          btcPrice={btcPrice}
          selectedCurrency={selectedCurrency}
          onCurrencyPress={onCurrencyPress}
        />
      </View>
      <View style={middleSlotStyle}>
        <HeaderProvider apiBase={apiBase} />
      </View>
      <View style={rightSlotStyle}>
        <HeaderNetwork network={network} onPress={onSettingsPress} />
      </View>
    </View>
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
  const headerButtonsContainer: any = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 12,
    paddingBottom: 12,
    paddingRight: 16,
    paddingLeft: 16,
    minHeight: 60,
  };
  return (
    <RNView style={headerButtonsContainer}>
      <HeaderNetworkProvider
        network={network}
        apiBase={apiBase}
        onPress={() => navigation.navigate('Settings')}
        onSettingsPress={() => navigation.navigate('Settings')}
      />
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
      Device: '',
      Wallet: 'Home',
      PSBT: '',
      Settings: '',
      Home: 'Home',
      Welcome: 'Welcome',
      'Devices Pairing': 'Local Pairing',
      'Nostr Connect': 'Nostr Link',
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
      <AppPressable
        onPress={() => {
          navigation.goBack();
        }}
        style={headerStyles.backButton}
        android_ripple={{color: 'rgba(0,0,0,0.1)'}}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Go back">
        <Text style={headerStyles.backButtonText}>←</Text>
      </AppPressable>
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
  const isDarkMode = theme.colors.background !== '#ffffff';
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
      flex: 1,
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
