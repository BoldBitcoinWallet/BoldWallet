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
import {DeviceEventEmitter} from 'react-native';
import {useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {createStyles} from './Styles';
import {HapticFeedback, presentFiat} from '../utils';
import type {NativeStackHeaderProps} from '@react-navigation/native-stack';
interface HeaderPriceButtonProps {
  btcPrice?: string;
  selectedCurrency?: string;
  onCurrencyPress?: () => void;
}
interface HeaderNetworkProviderProps {
  network?: string;
  apiBase?: string;
}
export const HeaderNetworkProvider: React.FC<HeaderNetworkProviderProps> = ({
  network,
  apiBase,
}) => {
  const {theme} = useTheme();
  const isDarkMode = theme.colors.background !== '#ffffff';
  // Single bordered container for both network and provider - 2 lines layout
  const containerStyle: any = {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 1,
    paddingHorizontal: 8,
    paddingVertical: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: isDarkMode
      ? theme.colors.border + '80'
      : theme.colors.blackOverlay10,
    backgroundColor: isDarkMode
      ? theme.colors.cardBackground
      : theme.colors.blackOverlay06,
    height: 36, // Match price button and lock button height
    maxWidth: 140, // Reduced to prevent overlap with left/right buttons
    flexShrink: 1, // Allow shrinking if needed
    flexGrow: 0, // Don't grow beyond maxWidth
    alignSelf: 'center', // Center within parent
    position: 'relative', // Enable absolute positioning for children
    overflow: 'hidden', // Clip badge to container border radius
  };
  const networkBadgeStyle: any = {
    position: 'absolute',
    top: 0, // Align with container top
    left: 0, // Align with container left
    right: 0, // Align with container right
    backgroundColor: isDarkMode
      ? theme.colors.border + '80'
      : theme.colors.blackOverlay05,
    paddingHorizontal: 6,
    height: 17,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  };
  const networkBadgeTextStyle: any = {
    fontSize: theme.fontSizes?.xs || 8,
    fontFamily: theme.fontFamilies?.bold,
    color:
      theme.colors.background === '#ffffff'
        ? theme.colors.secondary
        : theme.colors.text,
    letterSpacing: 0.2,
    lineHeight: 10,
  };
  const providerTextStyle: any = {
    fontSize: theme.fontSizes?.xs || 9,
    color: theme.colors.textSecondary,
    flexShrink: 1, // Allow text to shrink
    textAlign: 'center',
    maxWidth: 120, // Limit provider text width to prevent overflow
    top: '50%',
    marginTop: 2,
  };
  const cleanProviderUrl = apiBase
    ? apiBase.replace('https://', '').replace('/api', '').replace(/\/+$/, '')
    : 'Loading...';
  if (!network && !apiBase) {
    return null;
  }
  return (
    <View style={containerStyle}>
      {network && (
        <View style={networkBadgeStyle}>
          <Text style={networkBadgeTextStyle}>
            {network === 'mainnet' ? 'MAINNET' : 'TESTNET'}
          </Text>
        </View>
      )}
      {apiBase && (
        <Text
          style={providerTextStyle}
          adjustsFontSizeToFit={true}
          numberOfLines={1}
          minimumFontScale={0.7}>
          {cleanProviderUrl}
        </Text>
      )}
    </View>
  );
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
  const headerCurrencyBadgeStyle: any = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textSecondary,
    lineHeight: 12,
  };
  const priceTextContainerStyle: any = {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
  };
  if (btcPrice === undefined || !onCurrencyPress) {
    return null;
  }
  const containerStyle: any = {
    paddingLeft: 16,
    paddingTop: 12,
    paddingBottom: 12,
  };
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
        <View style={priceTextContainerStyle}>
          <Text style={headerBtcPriceStyle}>
            {btcPrice ? presentFiat(btcPrice) : '-'}
          </Text>
          {selectedCurrency && (
            <Text style={headerCurrencyBadgeStyle}>{selectedCurrency}</Text>
          )}
        </View>
      </Pressable>
    </RNView>
  );
};
interface HeaderRightButtonProps {
  navigation: any;
  btcPrice?: string;
  selectedCurrency?: string;
  onCurrencyPress?: () => void;
}
export const HeaderRightButton: React.FC<HeaderRightButtonProps> = ({
  navigation,
  btcPrice,
  selectedCurrency,
  onCurrencyPress,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const headerButtonsContainer: any = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
    paddingTop: 12,
    paddingBottom: 12,
    paddingRight: 16,
    paddingLeft: 16,
    minHeight: 60,
  };
  // Keep the price pill visually symmetric with the right-side buttons cluster.
  // Each right button is 36px wide and there is a 16px gap between them:
  // cluster width = 36 * 2 + 16 = 88. Add a small buffer for internal padding.
  const settingsBtnWidth = Number(styles.settingsButton?.width ?? 36);
  const buttonsGap = Number(headerButtonsContainer.gap ?? 16);
  const rightClusterWidth = settingsBtnWidth * 2 + buttonsGap;
  const priceMinWidth = rightClusterWidth + 8; // ~96px target footprint
  const priceButtonStyle: any = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.blackOverlay06 // Light mode background
        : theme.colors.cardBackground, // Dark mode background
    borderWidth: 4,
    borderColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.blackOverlay10 // Light mode border
        : theme.colors.border + '80', // Dark mode border
    paddingHorizontal: 16,
    paddingVertical: 0,
    borderRadius: 10,
    height: 36,
    minWidth: priceMinWidth,
    maxWidth: 140, // avoid over-expansion when currency codes are long
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: Platform.OS === 'android' ? 0 : 1,
  };
  const headerBtcLogoStyle: any = {
    width: 20,
    height: 20,
    resizeMode: 'contain',
    // No tint - keep Bitcoin logo as is in both light and dark mode
  };
  const headerBtcPriceStyle: any = {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    lineHeight: 14,
  };
  const headerCurrencyBadgeStyle: any = {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textSecondary,
    lineHeight: 12,
  };
  const priceTextContainerStyle: any = {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
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
      {btcPrice !== undefined && onCurrencyPress && (
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
          <View style={priceTextContainerStyle}>
            <Text style={headerBtcPriceStyle}>
              {btcPrice ? presentFiat(btcPrice) : '-'}
            </Text>
            {selectedCurrency && (
              <Text style={headerCurrencyBadgeStyle}>{selectedCurrency}</Text>
            )}
          </View>
        </Pressable>
      )}
      <Pressable
        style={settingsButtonStyle}
        onPress={() => {
          HapticFeedback.light();
          DeviceEventEmitter.emit('app:reload');
        }}
        android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Lock wallet"
        accessibilityHint="Double tap to lock the wallet">
        <Image
          source={require('../assets/locker-icon.png')}
          style={styles.settingsLogo}
        />
      </Pressable>
      <Pressable
        style={settingsButtonStyle}
        onPress={() => {
          HapticFeedback.light();
          navigation.navigate('Settings');
        }}
        android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
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
