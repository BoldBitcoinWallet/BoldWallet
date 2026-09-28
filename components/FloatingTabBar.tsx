/**
 * Floating bottom tab bar: centered pill (max 90% width).
 * A highlight slides to the selected tab; the icon settles with a short spring.
 */
import React, {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {CommonActions} from '@react-navigation/native';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {BottomTabBarHeightCallbackContext} from '@react-navigation/bottom-tabs';
import {useTheme} from '../theme';
import AppPressable from './AppPressable';

const TAB_ICON_SIZE = 22;
const TAB_ITEM_MIN_WIDTH = 68;
/** Shared by pill shell and active tab highlight so corners align. */
export const FLOATING_PILL_RADIUS = 28;
const PILL_BOTTOM_GAP = 10;
/** Content height of the pill (icons + labels); excludes safe-area / gap. */
export const FLOATING_TAB_BAR_CONTENT_HEIGHT = 62;
const INDICATOR_INSET = 5;

const SPRING = {damping: 18, stiffness: 220, mass: 0.7};

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

type ItemLayout = {x: number; width: number};

function TabIconSlot({
  focused,
  children,
}: {
  focused: boolean;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(focused ? 1 : 0.94);
  useEffect(() => {
    scale.value = withSpring(focused ? 1.12 : 1, SPRING);
  }, [focused, scale]);
  const anim = useAnimatedStyle(() => ({
    transform: [{scale: scale.value}],
  }));
  return <Animated.View style={anim}>{children}</Animated.View>;
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
  const scrollRef = useRef<ScrollView>(null);
  const [layouts, setLayouts] = useState<Record<string, ItemLayout>>({});
  const indicatorX = useSharedValue(0);
  const indicatorW = useSharedValue(0);
  const pillY = useSharedValue(16);
  const pillOpacity = useSharedValue(0);

  useEffect(() => {
    onHeightChange?.(0);
  }, [onHeightChange]);

  useEffect(() => {
    pillY.value = withSpring(0, {damping: 16, stiffness: 180});
    pillOpacity.value = withTiming(1, {duration: 220});
  }, [pillOpacity, pillY]);

  const focusedRoute = state.routes[state.index];
  const focusedLayout = focusedRoute ? layouts[focusedRoute.key] : undefined;

  useEffect(() => {
    if (!focusedLayout || focusedLayout.width <= INDICATOR_INSET * 2) {
      return;
    }
    indicatorX.value = withSpring(focusedLayout.x + INDICATOR_INSET, SPRING);
    indicatorW.value = withSpring(
      focusedLayout.width - INDICATOR_INSET * 2,
      SPRING,
    );
    scrollRef.current?.scrollTo({
      x: Math.max(0, focusedLayout.x - 20),
      animated: true,
    });
  }, [focusedLayout, indicatorW, indicatorX]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{translateX: indicatorX.value}],
    width: indicatorW.value,
    opacity: indicatorW.value > 0 ? 1 : 0,
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillOpacity.value,
    transform: [{translateY: pillY.value}],
  }));

  const activeTint = theme.colors.bitcoinOrange;
  const inactiveTint = theme.colors.textSecondary;
  const borderColor = isDarkMode
    ? theme.colors.whiteOverlay12
    : theme.colors.blackOverlay10;
  const indicatorColor = isDarkMode
    ? 'rgba(247,147,26,0.22)'
    : 'rgba(247,147,26,0.16)';

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

  const onItemLayout = useCallback(
    (key: string) => (event: LayoutChangeEvent) => {
      const {x, width} = event.nativeEvent.layout;
      setLayouts(prev => {
        const current = prev[key];
        if (current && current.x === x && current.width === width) {
          return prev;
        }
        return {...prev, [key]: {x, width}};
      });
    },
    [],
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
      <Animated.View
        style={[
          styles.pillElevated,
          pillStyle,
          {
            maxWidth: maxPillWidth,
            backgroundColor: theme.colors.cardBackground,
            shadowColor: theme.colors.shadowColor || '#000',
          },
        ]}>
        <View style={[styles.pillClip, {borderColor}]}>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.scrollContent}
            style={styles.scroll}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.indicator,
                indicatorStyle,
                {backgroundColor: indicatorColor},
              ]}
            />
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
                        fontSize: theme.fontSizes?.xs || 11,
                        fontFamily: focused
                          ? theme.fontFamilies?.bold
                          : theme.fontFamilies?.medium,
                      },
                    ]}
                    numberOfLines={1}>
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
                  onLayout={onItemLayout(route.key)}
                  style={styles.tabItem}>
                  <View style={styles.iconWrap}>
                    <TabIconSlot focused={focused}>{icon}</TabIconSlot>
                  </View>
                  <View style={styles.labelWrap}>{labelNode}</View>
                </AppPressable>
              );
            })}
          </ScrollView>
        </View>
      </Animated.View>
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
        shadowOffset: {width: 0, height: 10},
        shadowOpacity: 0.22,
        shadowRadius: 18,
      },
      android: {
        elevation: 12,
      },
      default: {},
    }),
  },
  pillClip: {
    flexDirection: 'row',
    borderRadius: FLOATING_PILL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
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
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  indicator: {
    position: 'absolute',
    left: 0,
    top: 4,
    height: FLOATING_TAB_BAR_CONTENT_HEIGHT - 8,
    borderRadius: FLOATING_PILL_RADIUS - 6,
  },
  tabItem: {
    minWidth: TAB_ITEM_MIN_WIDTH,
    minHeight: FLOATING_TAB_BAR_CONTENT_HEIGHT - 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: FLOATING_PILL_RADIUS - 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: TAB_ICON_SIZE + 4,
    height: TAB_ICON_SIZE + 4,
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
