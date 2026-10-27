/**
 * Bottom tab bar. Docked spans the screen with icon and label.
 * Floating is a centered pill only as wide as its icons.
 * Selection is one sliding shape. Press uses that same shape, with no extra ripple.
 */
import React, {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavMenuStyle} from '../services/navMenuStore';
import {DISSOLVE_FADE} from './DissolveFade';
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
import {BlurView} from '@sbaiahmed1/react-native-blur';
import {useTheme} from '../theme';
import {consumeNotedTabEnter, noteTabEnter} from '../services/tabFade';
import AppPressable from './AppPressable';

const TAB_ICON_SIZE = 22;
const FLOATING_ICON_SIZE = 25;
const FLOATING_ITEM_MIN_WIDTH = 50;
const DOCKED_ITEM_MIN_WIDTH = 68;
/** Circle behind a floating icon. Same size for selected and pressed. */
const FLOATING_DISC = 42;
const DOCKED_HIGHLIGHT_RADIUS = 12;
/** Shared by the floating pill shell. */
export const FLOATING_PILL_RADIUS = 30;
/** Outline of the undocked pill. Docked chrome stays on hairlineWidth. */
const FLOATING_PILL_BORDER_WIDTH = 1.5;
const FLOATING_SIDE_MARGIN = 16;
const PILL_BOTTOM_GAP = 10;
/** Icon-only pill. Excludes safe-area and the gap under the pill. */
export const FLOATING_TAB_BAR_CONTENT_HEIGHT = 60;
/** Docked bar keeps a label under each icon. */
export const DOCKED_TAB_BAR_CONTENT_HEIGHT = 62;
const LABEL_SLOT_HEIGHT = 16;
const SHAPE_MS = 220;
/** Room between the last scroll content and the top of the pill. */
export const FLOATING_TAB_CONTENT_GAP = 20;

/**
 * Extra scroll distance so the last content can be moved above the floating
 * pill. The screen itself stays full height; the pill keeps overlaying it.
 */
export function floatingTabBarClearance(bottomInset: number): number {
  const safeBottom = Math.max(bottomInset, 0);
  return (
    PILL_BOTTOM_GAP +
    FLOATING_TAB_BAR_CONTENT_HEIGHT +
    safeBottom +
    PILL_BOTTOM_GAP +
    FLOATING_TAB_CONTENT_GAP
  );
}

/** 0 when the menu is docked. Added to scroll content, not to the screen. */
export function useFloatingScrollPadding(): number {
  const menuStyle = useNavMenuStyle();
  const insets = useSafeAreaInsets();
  if (menuStyle !== 'floating') {
    return 0;
  }
  return floatingTabBarClearance(insets.bottom);
}

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
  pressed,
  children,
}: {
  focused: boolean;
  pressed: boolean;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  useEffect(() => {
    const next = pressed ? 0.92 : focused ? 1.06 : 1;
    scale.value = withSpring(next, SPRING);
  }, [focused, pressed, scale]);
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
  const menuStyle = useNavMenuStyle();
  const floating = menuStyle === 'floating';
  const {width: windowWidth} = useWindowDimensions();
  const onHeightChange = useContext(BottomTabBarHeightCallbackContext);
  const isDarkMode = theme.colors.background !== '#ffffff';
  const bottomPad = Math.max(insets.bottom, 0) + PILL_BOTTOM_GAP;
  const scrollRef = useRef<ScrollView>(null);
  const [layouts, setLayouts] = useState<Record<string, ItemLayout>>({});
  const indicatorX = useSharedValue(0);
  const indicatorW = useSharedValue(0);
  const pillY = useSharedValue(floating ? 16 : 0);
  const pillOpacity = useSharedValue(floating ? 0 : 1);
  const barHeight = useSharedValue(
    floating ? FLOATING_TAB_BAR_CONTENT_HEIGHT : DOCKED_TAB_BAR_CONTENT_HEIGHT,
  );
  const barRadius = useSharedValue(floating ? FLOATING_PILL_RADIUS : 0);
  const labelOpen = useSharedValue(floating ? 0 : 1);
  const barWidth = useSharedValue(
    floating
      ? Math.min(
          state.routes.length * FLOATING_ITEM_MIN_WIDTH + 8,
          Math.max(0, windowWidth - FLOATING_SIDE_MARGIN * 2),
        )
      : windowWidth,
  );
  const floatingMax = Math.max(0, windowWidth - FLOATING_SIDE_MARGIN * 2);
  const hugWidth = React.useMemo(() => {
    let maxEdge = 0;
    let count = 0;
    for (const route of state.routes) {
      const layout = layouts[route.key];
      if (!layout) {
        continue;
      }
      count += 1;
      maxEdge = Math.max(maxEdge, layout.x + layout.width);
    }
    if (count !== state.routes.length || maxEdge <= 0) {
      return 0;
    }
    return maxEdge + 4;
  }, [layouts, state.routes]);
  const fittedWidth =
    hugWidth > 0
      ? Math.min(hugWidth + FLOATING_PILL_BORDER_WIDTH * 2, floatingMax)
      : 0;
  const dockedOverflows = !floating && hugWidth > windowWidth;

  useEffect(() => {
    onHeightChange?.(0);
  }, [onHeightChange]);

  useEffect(() => {
    if (!floating) {
      pillY.value = 0;
      pillOpacity.value = 1;
      return;
    }
    pillY.value = withSpring(0, {damping: 16, stiffness: 180});
    pillOpacity.value = withTiming(1, {duration: SHAPE_MS});
  }, [floating, pillOpacity, pillY]);

  useEffect(() => {
    const nextHeight = floating
      ? FLOATING_TAB_BAR_CONTENT_HEIGHT
      : DOCKED_TAB_BAR_CONTENT_HEIGHT;
    barHeight.value = withTiming(nextHeight, {duration: SHAPE_MS});
    barRadius.value = withTiming(floating ? FLOATING_PILL_RADIUS : 0, {
      duration: SHAPE_MS,
    });
    labelOpen.value = withTiming(floating ? 0 : 1, {duration: SHAPE_MS});
  }, [barHeight, barRadius, floating, labelOpen]);

  const wasFloating = useRef(floating);
  useEffect(() => {
    const target = floating ? fittedWidth : windowWidth;
    if (target <= 0) {
      return;
    }
    const modeChanged = wasFloating.current !== floating;
    wasFloating.current = floating;
    barWidth.value = modeChanged
      ? withTiming(target, {duration: SHAPE_MS})
      : target;
  }, [barWidth, fittedWidth, floating, windowWidth]);

  const focusedRoute = state.routes[state.index];
  const focusedLayout = focusedRoute ? layouts[focusedRoute.key] : undefined;

  useEffect(() => {
    if (!focusedLayout || focusedLayout.width <= INDICATOR_INSET * 2) {
      return;
    }
    if (floating) {
      indicatorX.value = withSpring(
        focusedLayout.x + (focusedLayout.width - FLOATING_DISC) / 2,
        SPRING,
      );
      indicatorW.value = withSpring(FLOATING_DISC, SPRING);
    } else {
      indicatorX.value = withSpring(focusedLayout.x + INDICATOR_INSET, SPRING);
      indicatorW.value = withSpring(
        focusedLayout.width - INDICATOR_INSET * 2,
        SPRING,
      );
    }
    scrollRef.current?.scrollTo({
      x: Math.max(0, focusedLayout.x - 20),
      animated: true,
    });
  }, [floating, focusedLayout, indicatorW, indicatorX]);

  const indicatorStyle = useAnimatedStyle(() => {
    const height = floating
      ? FLOATING_DISC
      : Math.max(0, barHeight.value - 8);
    return {
      transform: [{translateX: indicatorX.value}],
      width: indicatorW.value,
      opacity: indicatorW.value > 0 ? 1 : 0,
      height,
      borderRadius: floating ? FLOATING_DISC / 2 : DOCKED_HIGHLIGHT_RADIUS,
      top: floating ? Math.max(0, (barHeight.value - height) / 2) : 4,
    };
  });

  const pillStyle = useAnimatedStyle(() => ({
    opacity: DISSOLVE_FADE ? 1 : pillOpacity.value,
    transform: [{translateY: pillY.value}],
    borderRadius: barRadius.value,
    minHeight: barHeight.value,
    width: barWidth.value,
  }));

  const clipStyle = useAnimatedStyle(() => ({
    borderRadius: barRadius.value,
    minHeight: barHeight.value,
  }));

  const labelSlotStyle = useAnimatedStyle(() => ({
    opacity: DISSOLVE_FADE ? 1 : labelOpen.value,
    height: labelOpen.value * LABEL_SLOT_HEIGHT,
    marginTop: labelOpen.value * 2,
  }));

  const activeTint = theme.colors.bitcoinOrange;
  const inactiveTint = theme.colors.textSecondary;
  const borderColor = isDarkMode
    ? theme.colors.whiteOverlay12
    : theme.colors.blackOverlay10;
  const indicatorColor = isDarkMode
    ? 'rgba(247,147,26,0.28)'
    : 'rgba(247,147,26,0.18)';
  const pressedColor = isDarkMode
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(0,0,0,0.07)';

  const tabIndexRef = useRef(state.index);
  useEffect(() => {
    if (tabIndexRef.current === state.index) {
      return;
    }
    const from = tabIndexRef.current;
    tabIndexRef.current = state.index;
    if (consumeNotedTabEnter(state.index)) {
      return;
    }
    noteTabEnter(from, state.index);
  }, [state.index]);

  const onTabPress = useCallback(
    (route: (typeof state.routes)[number], isFocused: boolean) => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!isFocused && !event.defaultPrevented) {
        const to = state.routes.findIndex(item => item.key === route.key);
        noteTabEnter(state.index, to);
        navigation.dispatch({
          ...CommonActions.navigate(route),
          target: state.key,
        });
      }
    },
    [navigation, state],
  );

  const onTabLongPress = useCallback(
    (route: (typeof state.routes)[number]) => {
      navigation.emit({
        type: 'tabLongPress',
        target: route.key,
      });
    },
    [navigation, state],
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

  const outerPadStyle = floating
    ? {paddingBottom: bottomPad, paddingTop: PILL_BOTTOM_GAP}
    : {
        paddingBottom: Math.max(insets.bottom, 0),
        backgroundColor: theme.colors.background,
        borderTopColor: borderColor,
      };
  // iOS shadow only. Android elevation plus the blur overlay
  // paints a gray box around the pill.
  const elevatedSurfaceStyle = {
    backgroundColor: floating
      ? Platform.OS === 'android'
        ? isDarkMode
          ? 'rgba(30,30,30,0.96)'
          : 'rgba(255,255,255,0.96)'
        : 'transparent'
      : theme.colors.background,
    shadowColor:
      Platform.OS === 'ios'
        ? theme.colors.shadowColor || '#000'
        : 'transparent',
    shadowOpacity: Platform.OS === 'ios' && floating ? 0.22 : 0,
    elevation: 0,
  };
  return (
    <View
      pointerEvents="box-none"
      style={[
        floating ? styles.outerFloating : styles.outerDocked,
        outerPadStyle,
      ]}>
      <Animated.View
        style={[
          floating ? styles.pillElevated : styles.dockElevated,
          pillStyle,
          elevatedSurfaceStyle,
        ]}>
        <Animated.View
          style={[
            styles.pillClip,
            floating && styles.pillClipFloating,
            clipStyle,
            {borderColor},
          ]}>
          {floating && Platform.OS === 'ios' ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={
                  isDarkMode
                    ? 'systemUltraThinMaterialDark'
                    : 'systemUltraThinMaterialLight'
                }
                blurAmount={16}
                overlayColor={
                  isDarkMode ? 'rgba(18,18,20,0.12)' : 'rgba(255,255,255,0.18)'
                }
                reducedTransparencyFallbackColor={theme.colors.cardBackground}
              />
            </View>
          ) : null}
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={[
              styles.scrollContent,
              floating
                ? styles.scrollContentHug
                : dockedOverflows
                  ? styles.scrollContentDockedScroll
                  : styles.scrollContentDocked,
            ]}
            style={[styles.scroll, !floating && styles.scrollDocked]}>
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
              const iconSize = floating ? FLOATING_ICON_SIZE : TAB_ICON_SIZE;
              const icon = options.tabBarIcon?.({
                focused,
                color,
                size: iconSize,
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
                  variant="none"
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
                  style={[
                    styles.tabItem,
                    floating && styles.tabItemFloating,
                    {
                      minWidth: floating
                        ? FLOATING_ITEM_MIN_WIDTH
                        : DOCKED_ITEM_MIN_WIDTH,
                      minHeight:
                        (floating
                          ? FLOATING_TAB_BAR_CONTENT_HEIGHT
                          : DOCKED_TAB_BAR_CONTENT_HEIGHT) - 8,
                    },
                  ]}>
                  {({pressed}) => (
                    <>
                      {pressed && !focused && !floating ? (
                        <View
                          pointerEvents="none"
                          style={[
                            styles.pressDock,
                            {backgroundColor: pressedColor},
                          ]}
                        />
                      ) : null}
                      <View
                        style={floating ? styles.floatingIconAnchor : undefined}
                        pointerEvents="none">
                        {pressed && !focused && floating ? (
                          <View
                            style={[
                              styles.pressDisc,
                              {backgroundColor: pressedColor},
                            ]}
                          />
                        ) : null}
                        <View
                          style={[
                            styles.iconWrap,
                            floating && styles.floatingIconWrap,
                          ]}>
                          <TabIconSlot focused={focused} pressed={pressed}>
                            {icon}
                          </TabIconSlot>
                        </View>
                      </View>
                      <Animated.View
                        style={[styles.labelWrap, labelSlotStyle]}
                        accessibilityElementsHidden={floating}
                        importantForAccessibility={
                          floating ? 'no-hide-descendants' : 'auto'
                        }>
                        {labelNode}
                      </Animated.View>
                    </>
                  )}
                </AppPressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerFloating: {
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
  outerDocked: {
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'stretch',
  },
  pillElevated: {
    alignSelf: 'center',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowOffset: {width: 0, height: 10},
        shadowRadius: 18,
      },
      android: {},
      default: {},
    }),
  },
  dockElevated: {
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  pillClip: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  pillClipFloating: {
    borderWidth: FLOATING_PILL_BORDER_WIDTH,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollDocked: {
    flexGrow: 1,
    alignSelf: 'stretch',
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  scrollContentHug: {
    flexGrow: 0,
  },
  scrollContentDocked: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  scrollContentDockedScroll: {
    flexGrow: 1,
    justifyContent: 'flex-start',
  },
  indicator: {
    position: 'absolute',
    left: 0,
  },
  floatingIconAnchor: {
    width: FLOATING_DISC,
    height: FLOATING_DISC,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressDisc: {
    position: 'absolute',
    width: FLOATING_DISC,
    height: FLOATING_DISC,
    borderRadius: FLOATING_DISC / 2,
  },
  pressDock: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: 4,
    bottom: 4,
    borderRadius: DOCKED_HIGHLIGHT_RADIUS,
  },
  tabItem: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabItemFloating: {
    paddingVertical: 0,
  },
  iconWrap: {
    width: TAB_ICON_SIZE + 4,
    height: TAB_ICON_SIZE + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingIconWrap: {
    width: FLOATING_ICON_SIZE + 4,
    height: FLOATING_ICON_SIZE + 4,
  },
  labelWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    overflow: 'hidden',
    minWidth: 0,
  },
  label: {
    textAlign: 'center',
  },
});

export default FloatingTabBar;
