/**
 * Floating bottom tab bar: centered pill (max 90% width) with horizontal scroll.
 * Positioned absolutely so tab screens stretch full device height underneath.
 */
import React, {useCallback, useContext, useEffect} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import {CommonActions} from '@react-navigation/native';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {BottomTabBarHeightCallbackContext} from '@react-navigation/bottom-tabs';
import {useTheme} from '../theme';
import AppPressable from './AppPressable';

const TAB_ICON_SIZE = 22;
const TAB_ITEM_MIN_WIDTH = 64;
/** Shared by pill shell and active tab highlight so corners align. */
export const FLOATING_PILL_RADIUS = 12;
const PILL_BOTTOM_GAP = 8;
/** Content height of the pill (icons + labels); excludes safe-area / gap. */
export const FLOATING_TAB_BAR_CONTENT_HEIGHT = 56;

function resolveLabel(
  options: BottomTabBarProps['descriptors'][string]['options'],
  routeName: string,
): string {
  if (typeof options.tabBarLabel === 'string') {
    return options.tabBarLabel;
  }
  if (typeof options.title === 'string') {
    return options.title;
  }
  return routeName;
}

const FloatingTabBar: React.FC<BottomTabBarProps> = ({
  state,
  descriptors,
  navigation,
  insets,
}) => {
  const {theme} = useTheme();
  const {width: windowWidth} = useWindowDimensions();
  const onHeightChange = useContext(BottomTabBarHeightCallbackContext);
  const isDarkMode = theme.colors.background !== '#ffffff';
  const maxPillWidth = windowWidth * 0.9;
  const bottomPad = Math.max(insets.bottom, 0) + PILL_BOTTOM_GAP;

  // Overlay mode: reserve no layout height so screens fill the device.
  useEffect(() => {
    onHeightChange?.(0);
  }, [onHeightChange]);

  const focusedOptions = descriptors[state.routes[state.index].key]?.options;
  const activeTint =
    focusedOptions?.tabBarActiveTintColor ??
    (isDarkMode ? theme.colors.text : theme.colors.primary || theme.colors.text);
  const inactiveTint =
    focusedOptions?.tabBarInactiveTintColor ?? theme.colors.textSecondary;

  const borderColor = isDarkMode
    ? theme.colors.whiteOverlay12
    : theme.colors.blackOverlay10;
  const activeBg = isDarkMode
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(0,0,0,0.06)';

  const onTabPress = useCallback(
    (route: (typeof state.routes)[number], isFocused: boolean) => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!isFocused && !event.defaultPrevented) {
        navigation.dispatch({
          ...CommonActions.navigate(route),
          target: state.key,
        });
      }
    },
    [navigation, state.key],
  );

  const onTabLongPress = useCallback(
    (route: (typeof state.routes)[number]) => {
      navigation.emit({
        type: 'tabLongPress',
        target: route.key,
      });
    },
    [navigation],
  );

  return (
    <View
      style={[
        styles.outer,
        {
          paddingBottom: bottomPad,
          paddingTop: PILL_BOTTOM_GAP,
        },
      ]}
      pointerEvents="box-none">
      {/*
        Android: elevation must live on the same view as backgroundColor +
        borderRadius, with no overflow:hidden — nesting/clipping draws a
        square outline under the pill.
      */}
      <View
        style={[
          styles.pillElevated,
          {
            maxWidth: maxPillWidth,
            backgroundColor: theme.colors.cardBackground,
            shadowColor: theme.colors.shadowColor || '#000',
          },
        ]}>
        <View
          style={[
            styles.pillClip,
            {
              borderColor,
            },
          ]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.scrollContent}
            style={styles.scroll}>
            {state.routes.map((route, index) => {
              const {options} = descriptors[route.key];
              const focused = state.index === index;
              const color = focused ? activeTint : inactiveTint;
              const label = resolveLabel(options, route.name);
              const icon = options.tabBarIcon?.({
                focused,
                color,
                size: TAB_ICON_SIZE,
              });

              const labelNode =
                typeof options.tabBarLabel === 'function' ? (
                  options.tabBarLabel({
                    focused,
                    color,
                    position: 'below-icon',
                    children: label,
                  })
                ) : (
                  <Text
                    style={[
                      styles.label,
                      {
                        color,
                        fontSize: theme.fontSizes?.xs || 10,
                        fontFamily: theme.fontFamilies?.medium,
                      },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.5}>
                    {label}
                  </Text>
                );

              return (
                <AppPressable
                  key={route.key}
                  accessibilityRole="button"
                  accessibilityState={focused ? {selected: true} : {}}
                  accessibilityLabel={
                    options.tabBarAccessibilityLabel ?? label
                  }
                  testID={options.tabBarButtonTestID}
                  onPress={(_e: GestureResponderEvent) =>
                    onTabPress(route, focused)
                  }
                  onLongPress={() => onTabLongPress(route)}
                  style={[
                    styles.tabItem,
                    focused && {backgroundColor: activeBg},
                  ]}>
                  <View style={styles.iconWrap}>{icon}</View>
                  <View style={styles.labelWrap}>{labelNode}</View>
                </AppPressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    // No elevation here — transparent full-width views cast square shadows on Android.
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  pillElevated: {
    alignSelf: 'center',
    borderRadius: FLOATING_PILL_RADIUS,
    minHeight: FLOATING_TAB_BAR_CONTENT_HEIGHT,
    ...Platform.select({
      ios: {
        shadowOffset: {width: 0, height: 8},
        shadowOpacity: 0.28,
        shadowRadius: 16,
      },
      android: {
        elevation: 10,
      },
      default: {},
    }),
  },
  pillClip: {
    flexDirection: 'row',
    borderRadius: FLOATING_PILL_RADIUS,
    borderWidth: 1,
    overflow: 'hidden',
    minHeight: FLOATING_TAB_BAR_CONTENT_HEIGHT,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexGrow: 0,
    // No inset padding: active tab corners meet the pill shell.
  },
  tabItem: {
    minWidth: TAB_ITEM_MIN_WIDTH,
    minHeight: FLOATING_TAB_BAR_CONTENT_HEIGHT,
    paddingHorizontal: 10,
    paddingVertical: 6,
    // Same radius as pill so selected ends share the outer curve.
    borderRadius: FLOATING_PILL_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: TAB_ICON_SIZE,
    height: TAB_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  labelWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  label: {
    textAlign: 'center',
  },
});

export default FloatingTabBar;
