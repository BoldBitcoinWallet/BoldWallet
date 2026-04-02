import React, {useEffect, useMemo, useRef, useState, useCallback} from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Image,
  Animated,
  Easing,
  Pressable,
  Modal,
  AccessibilityInfo,
  AppState,
  Platform,
  PixelRatio,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Toast from 'react-native-toast-message';
import {WebView} from 'react-native-webview';
import {dbg} from '../utils';
import {createToastConfig} from '../utils/toastConfig';
import AppPressable from '../components/AppPressable';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import DeviceInfo from 'react-native-device-info';
import {useTheme} from '../theme';
import {waitMS} from '../services/WalletService';
import {
  getCachedQuotes,
  syncLoadingQuotes,
} from '../services/LoadingQuotesCache';

type LoadingQuotesMarqueeStyles = {
  strip: ViewStyle;
  lineWrap: ViewStyle;
  marqueeText: TextStyle;
  staticText: TextStyle;
  webMarquee: ViewStyle;
  webMarqueePlaceholder: ViewStyle;
};

/**
 * WKWebView maps the same CSS px to a much larger on-screen size than Android WebView
 * (often ~2× in practice). Scale iOS CSS so the ticker matches Android visually.
 */
const WEB_MARQUEE_IOS_CSS_FONT_MULTIPLIER = 1;

/** HTML/CSS marquee runs inside WebView (native WKWebView), not in the RN Yoga tree. */
function escapeHtmlForWebMarquee(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Split on `**` — odd segments (1,3,…) are bold; even segments are plain. */
function splitMarkdownBoldSegments(s: string): string[] {
  return s.split('**');
}

/** `**bold**` → `<strong>`; each segment HTML-escaped. */
function marqueeMarkdownBoldToHtml(line: string): string {
  const parts = splitMarkdownBoldSegments(line);
  return parts
    .map((part, i) => {
      const escaped = escapeHtmlForWebMarquee(part);
      return i % 2 === 1 ? `<strong>${escaped}</strong>` : escaped;
    })
    .join('');
}

function buildQuotesMarqueeHtml(
  singleLinePlain: string,
  durationSec: number,
  fontSizePx: number,
  colorCss: string,
  isAndroid: boolean,
): string {
  const escaped = marqueeMarkdownBoldToHtml(singleLinePlain);
  const pad = '10px';
  const scaled = fontSizePx * PixelRatio.getFontScale();
  const cssFontPx =
    Math.round(
      scaled * (isAndroid ? 1.1 : WEB_MARQUEE_IOS_CSS_FONT_MULTIPLIER) * 100,
    ) / 100;
  /** Avoid `-apple-system` in WKWebView — it can inflate size vs Android Roboto at the same px. */
  const fontStack = isAndroid
    ? 'Roboto, sans-serif'
    : 'Helvetica Neue, Helvetica, Arial, sans-serif';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<style>
 * { box-sizing: border-box; margin: 0; padding: 0; }
 html, body {
   width: 100%;
   height: 100%;
   overflow: hidden;
   background: transparent;
   -webkit-text-size-adjust: 100%;
   text-size-adjust: 100%;
 }
 .viewport {
   width: 100%;
   height: 100%;
   overflow: hidden;
   display: flex;
   align-items: center;
 }
 .track {
   display: flex;
   flex-direction: row;
   flex-wrap: nowrap;
   width: max-content;
   animation: marq ${durationSec}s linear infinite;
 }
 .seg {
   font-size: ${cssFontPx}px;
   line-height: 1.25;
   color: ${colorCss};
   font-family: ${fontStack};
   font-weight: 500;
   padding-right: ${pad};
   white-space: nowrap;
 }
 .seg strong {
   font-weight: 700;
 }
 @keyframes marq {
   0% { transform: translateX(0); }
   100% { transform: translateX(-50%); }
 }
</style></head><body>
<div class="viewport"><div class="track"><span class="seg">${escaped}</span><span class="seg">${escaped}</span></div></div>
</body></html>`;
}

/**
 * Any whitespace (newlines, tabs, Unicode spaces, regular spaces) lets RN Text wrap to
 * many lines. Replace runs with NBSP so the string is one unbreakable line; only the
 * strip clips (overflow hidden), not per-line clipping inside Text.
 */
function toMarqueeSingleLine(s: string): string {
  return s.replace(/[\u200B\uFEFF]/g, '').replace(/\s+/gu, '\u00A0');
}

/** Between quotes on the manchette (spaces are normalized when we build the single line). */
const MANCHETTE_QUOTE_SEPARATOR = '  •  ';

/**
 * Build one continuous string from all quotes, then coerce the whole thing to a single
 * unbreakable line for RN Text (NBSP, no wrapping). Order: concatenate first, treat once.
 */
function buildManchetteMarqueeLine(quotes: string[]): string {
  const parts = quotes.map(q => q.trim()).filter(q => q.length > 0);
  if (parts.length === 0) {
    return '';
  }
  const fullLine = `${parts.join(
    MANCHETTE_QUOTE_SEPARATOR,
  )}${MANCHETTE_QUOTE_SEPARATOR}`;
  return toMarqueeSingleLine(fullLine);
}

/** Reduced-motion path: same `**bold**` segments as the WebView marquee. */
function MarqueeStaticQuotesText({
  quotes,
  style,
}: {
  quotes: string[];
  style: TextStyle;
}) {
  const children: React.ReactNode[] = [];
  quotes.forEach((q, qi) => {
    if (qi > 0) {
      children.push('\n\n');
    }
    splitMarkdownBoldSegments(q).forEach((part, pi) => {
      children.push(
        <Text
          key={`${qi}-${pi}`}
          style={pi % 2 === 1 ? [style, {fontWeight: '700'}] : style}>
          {part}
        </Text>,
      );
    });
  });
  const a11yLabel = quotes.map(q => q.replace(/\*\*/g, '')).join(' ');
  return (
    <Text selectable style={style} accessibilityLabel={a11yLabel}>
      {children}
    </Text>
  );
}

/** Bottom manchette: WebView CSS ticker when motion is allowed; static text when reduced motion. */
function LoadingQuotesMarquee({
  quotes,
  reduceMotion,
  styles: s,
  bottomInset = 0,
  appActive,
  textColor,
  fontSize,
}: {
  quotes: string[];
  reduceMotion: boolean;
  styles: LoadingQuotesMarqueeStyles;
  bottomInset?: number;
  appActive: boolean;
  textColor: string;
  fontSize: number;
}) {
  const segmentLine = useMemo(
    () => buildManchetteMarqueeLine(quotes),
    [quotes],
  );
  const stripStyle = useMemo(
    () => [s.strip, {paddingBottom: 10 + bottomInset}],
    [s.strip, bottomInset],
  );

  const [webReady, setWebReady] = useState(false);
  useEffect(() => {
    if (!appActive || reduceMotion || !segmentLine) {
      setWebReady(false);
      return;
    }
    const t = setTimeout(() => setWebReady(true), 600);
    return () => clearTimeout(t);
  }, [appActive, reduceMotion, segmentLine]);

  const htmlSource = useMemo(() => {
    if (!segmentLine) {
      return null;
    }
    const dur = Math.max(
      12,
      Math.min(90, Math.round(segmentLine.length * 0.12)),
    );
    return buildQuotesMarqueeHtml(
      segmentLine,
      dur,
      fontSize,
      textColor,
      Platform.OS === 'android',
    );
  }, [segmentLine, fontSize, textColor]);

  if (!segmentLine) {
    return null;
  }

  if (reduceMotion) {
    return (
      <View style={stripStyle} accessibilityRole="text">
        <MarqueeStaticQuotesText quotes={quotes} style={s.staticText} />
      </View>
    );
  }

  if (!appActive || !webReady || !htmlSource) {
    return (
      <View
        style={stripStyle}
        accessibilityRole="text"
        accessibilityLabel={quotes.join(' ')}>
        <View style={[s.lineWrap, s.webMarqueePlaceholder]} />
      </View>
    );
  }

  return (
    <View
      style={stripStyle}
      accessibilityRole="text"
      accessibilityLabel="Wallet quotes">
      <View style={s.lineWrap}>
        <WebView
          key={`${segmentLine.length}:${segmentLine.slice(0, 80)}`}
          originWhitelist={['*']}
          source={{html: htmlSource}}
          style={s.webMarquee}
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          androidLayerType="hardware"
          setSupportMultipleWindows={false}
          opaque={false}
          textZoom={Platform.OS === 'android' ? 100 : undefined}
        />
      </View>
    </View>
  );
}

// Error boundary for particle animation - on old/slow devices rendering many Animated.Image can crash
class ParticlesErrorBoundary extends React.Component<
  {onError: () => void; children: React.ReactNode},
  {hasError: boolean}
> {
  state = {hasError: false};

  static getDerivedStateFromError() {
    return {hasError: true};
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

/** iOS reports a large bottom safe area; with strip padding it sits too high vs Android — trim only for the manchette. */
const IOS_QUOTES_STRIP_BOTTOM_INSET_TRIM = 32;

const LoadingScreen = ({onRetry}: any) => {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const quotesStripBottomInset = useMemo(() => {
    if (Platform.OS !== 'ios') {
      return insets.bottom;
    }
    return Math.max(0, insets.bottom - IOS_QUOTES_STRIP_BOTTOM_INSET_TRIM);
  }, [insets.bottom]);
  const [appActive, setAppActive] = useState(
    () => AppState.currentState === 'active',
  );
  const [loading, setLoading] = useState(false);
  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [version, setVersion] = useState<string>('');
  const [buildNumber, setBuildNumber] = useState<string>('');
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  /** Background GitHub check — no chip spinner, no delay, no toast (manual uses checkingUpdate + optional delay). */
  const backgroundVersionCheckRef = useRef(false);
  const manualVersionCheckRef = useRef(false);
  const quotesSyncInFlightRef = useRef(false);
  const [loadingQuotes, setLoadingQuotes] = useState<string[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const cached = getCachedQuotes();
    if (cached?.length) {
      setLoadingQuotes(cached);
    }
    syncLoadingQuotes()
      .then(list => {
        if (list.length > 0) {
          setLoadingQuotes(list);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      setAppActive(state === 'active');
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!appActive || quotesSyncInFlightRef.current) {
      return;
    }
    quotesSyncInFlightRef.current = true;
    syncLoadingQuotes()
      .then(list => {
        if (list.length > 0) {
          setLoadingQuotes(list);
        }
      })
      .catch(() => {})
      .finally(() => {
        quotesSyncInFlightRef.current = false;
      });
  }, [appActive]);

  useEffect(() => {
    Promise.all([DeviceInfo.getVersion(), DeviceInfo.getBuildNumber()]).then(
      ([v, b]) => {
        setVersion(v);
        setBuildNumber(String(b));
      },
    );
  }, []);
  const [particles, setParticles] = useState<
    Array<{
      id: number;
      x: Animated.Value;
      y: Animated.Value;
      opacity: Animated.Value;
      scale: Animated.Value;
      rotate: Animated.Value;
      duration: number;
      size: number;
    }>
  >([]);
  const logoLayoutRef = useRef<{width: number; height: number}>({
    width: 0,
    height: 0,
  });
  const turbulenceRef = useRef(0); // increases briefly on tap
  const emitterRef = useRef<number | null>(null);
  const loadingRef = useRef(false);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  const fadeAnim = useRef(new Animated.Value(0.6)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const iconPulse = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(1)).current;

  const handlePress = async () => {
    setLoading(true);
    try {
      await onRetry();
    } finally {
      setLoading(false);
    }
  };
  const handlePressIn = () => {
    Animated.spring(buttonScale, {
      toValue: 0.97,
      useNativeDriver: true,
      friction: 6,
      tension: 200,
    }).start();
    Animated.parallel([
      Animated.timing(glowOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.spring(glowScale, {
        toValue: 1.15,
        useNativeDriver: true,
        friction: 5,
        tension: 160,
      }),
    ]).start();
  };
  const handlePressOut = () => {
    Animated.spring(buttonScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 6,
      tension: 200,
    }).start();
    Animated.parallel([
      Animated.timing(glowOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.spring(glowScale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6,
        tension: 200,
      }),
    ]).start();
  };
  const disableParticles = () => {
    setParticlesEnabled(false);
    setParticles([]);
    if (emitterRef.current != null) {
      clearInterval(emitterRef.current as unknown as number);
      emitterRef.current = null;
    }
  };

  const createFountain = (count: number = 2, intensity: number = 1) => {
    if (!particlesEnabled || !appActive || loadingRef.current) return;
    try {
      // Continuous vapor-like emission from the logo center
      const newParticles: Array<{
        id: number;
        x: Animated.Value;
        y: Animated.Value;
        opacity: Animated.Value;
        scale: Animated.Value;
        rotate: Animated.Value;
        duration: number;
        size: number;
      }> = [];
      for (let i = 0; i < count; i++) {
        // Start positions jittered by turbulence for better separation
        const originJitterX =
          (Math.random() - 0.5) * (30 + 18 * turbulenceRef.current);
        const originJitterY =
          (Math.random() - 0.5) * (20 + 10 * turbulenceRef.current);
        newParticles.push({
          id: Date.now() + i,
          x: new Animated.Value(originJitterX),
          y: new Animated.Value(originJitterY),
          opacity: new Animated.Value(0.9),
          scale: new Animated.Value(0.7),
          rotate: new Animated.Value(0),
          duration: (2500 + Math.floor(Math.random() * 1400)) * intensity, // slower
          size:
            10 +
            Math.floor(Math.random() * 8) +
            Math.floor(3 * turbulenceRef.current),
        });
      }
      setParticles(prev => [...prev, ...newParticles]);
      // Animate each particle along a gentle upward drift with slight jitter
      newParticles.forEach(p => {
        // Mostly vertical, slight horizontal jitter; amplified by turbulence
        const turbulence = 1 + turbulenceRef.current * 1.2;
        // Increase horizontal spread substantially with turbulence
        const baseSpread = 40;
        const extraSpread = 90 * turbulence; // scales with turbulence level
        const dx = (Math.random() - 0.5) * (baseSpread + extraSpread);
        const distance = (160 + Math.random() * 220) * (1 + 0.6 * turbulence);
        const dy = -distance; // upward
        const rotateTo = ((Math.random() * 60 - 30) * Math.PI) / 180; // small rotation
        const scaleTo = 0.9 + Math.random() * 0.4;
        Animated.parallel(
          [
            Animated.timing(p.x, {
              toValue: dx,
              duration: p.duration,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(p.y, {
              toValue: dy,
              duration: p.duration,
              easing: Easing.linear,
              useNativeDriver: true,
            }),
            Animated.timing(p.opacity, {
              toValue: 0,
              duration: p.duration,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(p.scale, {
              toValue: scaleTo,
              duration: p.duration,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(p.rotate, {
              toValue: rotateTo,
              duration: p.duration,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ],
          {stopTogether: true},
        ).start(() => {
          // Remove particle after animation finishes
          setParticles(prev => prev.filter(part => part.id !== p.id));
        });
      });
    } catch {
      disableParticles();
    }
  };
  const handleLogoPress = () => {
    if (!particlesEnabled || !appActive || loadingRef.current) return;
    try {
      // Stronger turbulence boost that decays more slowly
      turbulenceRef.current = Math.min(2, turbulenceRef.current + 1.2);
      // Emit a larger burst to emphasize spread
      createFountain(7, 1);
      // Decay turbulence
      const decaySteps = 8;
      let step = 0;
      const decayer = setInterval(() => {
        step += 1;
        turbulenceRef.current = Math.max(0, turbulenceRef.current - 0.2);
        if (step >= decaySteps) {
          clearInterval(decayer);
        }
      }, 160);
    } catch {
      disableParticles();
    }
  };
  const startLogoTouch = () => {
    if (!appActive || loadingRef.current) {
      return;
    }
    if (emitterRef.current != null) {
      return;
    }
    Animated.spring(logoScale, {
      toValue: 0.92,
      useNativeDriver: true,
      friction: 5,
      tension: 180,
    }).start();
    if (!particlesEnabled) {
      return;
    }
    try {
      turbulenceRef.current = Math.min(1.2, turbulenceRef.current + 0.6);
      emitterRef.current = setInterval(() => {
        try {
          createFountain(2, 1);
        } catch {
          disableParticles();
        }
      }, 140) as unknown as number;
    } catch {
      disableParticles();
    }
  };
  const endLogoTouch = () => {
    if (emitterRef.current != null) {
      clearInterval(emitterRef.current as unknown as number);
      emitterRef.current = null;
    }
    Animated.spring(logoScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 4,
      tension: 200,
    }).start();
    const decaySteps = 6;
    let step = 0;
    const decayer = setInterval(() => {
      step += 1;
      turbulenceRef.current = Math.max(0, turbulenceRef.current - 0.25);
      if (step >= decaySteps) {
        clearInterval(decayer);
      }
    }, 120);
  };
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.cubic,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0.7,
          duration: 1000,
          easing: Easing.cubic,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [fadeAnim]);
  useEffect(() => {
    if (loading) {
      iconPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(iconPulse, {
          toValue: 1.08,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(iconPulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [iconPulse, loading]);
  useEffect(() => {
    if (appActive) {
      return;
    }
    if (emitterRef.current != null) {
      clearInterval(emitterRef.current as unknown as number);
      emitterRef.current = null;
    }
    turbulenceRef.current = 0;
    setParticles([]);
  }, [appActive]);

  const compareVersions = (a: string, b: string) => {
    const norm = (v: string) =>
      v
        .replace(/^v/i, '')
        .split('.')
        .map(part => parseInt(part, 10) || 0);
    const [a1, a2, a3] = norm(a);
    const [b1, b2, b3] = norm(b);
    if (a1 !== b1) {
      return a1 - b1;
    }
    if (a2 !== b2) {
      return a2 - b2;
    }
    return a3 - b3;
  };

  const checkForUpdate = useCallback(
    async (silent: boolean) => {
      if (!version) {
        return;
      }
      if (silent) {
        if (backgroundVersionCheckRef.current) {
          return;
        }
        backgroundVersionCheckRef.current = true;
      } else {
        if (manualVersionCheckRef.current) {
          return;
        }
        manualVersionCheckRef.current = true;
        setCheckingUpdate(true);
      }
      try {
        const effectiveVersion = __DEV__ ? '0.0.0' : version;
        dbg('LoadingScreen: checking for update...', {
          version,
          effectiveVersion,
          silent,
        });
        if (!silent) {
          await waitMS(1000);
        }
        const res = await fetch(
          'https://api.github.com/repos/BoldBitcoinWallet/BoldWallet/releases/latest',
          {
            headers: {
              Accept: 'application/vnd.github+json',
            },
          },
        );
        if (!res.ok) {
          throw new Error(`status ${res.status}`);
        }
        const json = await res.json();
        const tag =
          typeof json?.tag_name === 'string' && json.tag_name.length > 0
            ? json.tag_name
            : null;
        if (!tag) {
          throw new Error('no tag_name');
        }
        setLatestVersion(tag);
        const cmp = compareVersions(effectiveVersion, tag);
        setUpdateAvailable(cmp < 0);
        dbg('LoadingScreen: update check result', {
          current: effectiveVersion,
          latest: tag,
          updateAvailable: cmp < 0,
        });
        if (!silent && cmp >= 0) {
          Toast.show({
            type: 'success',
            text1: "You're up to date",
            text2: `Bold Wallet v${version} matches the latest release.`,
            position: 'top',
          });
        }
      } catch {
        dbg('LoadingScreen: update check failed');
        if (!silent) {
          Toast.show({
            type: 'error',
            text1: 'Could not check for updates',
            text2:
              'Please check your internet connection and update from your original app store.',
            position: 'top',
          });
        }
      } finally {
        if (silent) {
          backgroundVersionCheckRef.current = false;
        } else {
          manualVersionCheckRef.current = false;
          setCheckingUpdate(false);
        }
      }
    },
    [version],
  );

  const handleVersionPress = () => {
    if (updateAvailable && latestVersion) {
      setShowUpdateModal(true);
      return;
    }
    checkForUpdate(false);
  };

  const showVersionChip = !!version && !!buildNumber;

  // Background check once the local version is known (no UI: no chip spinner, no delay, no toast)
  useEffect(() => {
    if (!version) {
      return;
    }
    checkForUpdate(true);
  }, [version, checkForUpdate]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    contentContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      width: '100%',
    },
    logoContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 32,
      padding: 20,
      backgroundColor: 'transparent',
      position: 'relative',
      overflow: 'visible',
    },
    particlesContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      overflow: 'visible',
      pointerEvents: 'none',
    },
    particle: {
      position: 'absolute',
      pointerEvents: 'none',
    },
    storeIcon: {
      width: 128,
      height: 128,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderRadius: 32,
      paddingVertical: 0,
      paddingHorizontal: 0,
      borderWidth: 0,
      borderColor: 'transparent',
      shadowColor: 'transparent',
      shadowOffset: {width: 0, height: 0},
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
      marginBottom: 24,
      minWidth: 160,
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    buttonText: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.primary,
      marginLeft: 12,
      letterSpacing: 0.5,
    },
    iconWrapper: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: '#000000',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: '#1a1a1a',
    },
    glowCircle: {
      position: 'absolute',
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: '#000000',
      opacity: 0.3,
    },
    icon: {
      width: 40,
      height: 40,
      tintColor: theme.colors.white,
    },
    versionText: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      opacity: 0.8,
      marginBottom: 8,
    },
    versionBuildText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      opacity: 0.8,
      marginTop: 12,
    },
    bottomContainer: {
      alignItems: 'center',
      width: '100%',
      paddingBottom: 64,
    },
    buttonAnimatedContainer: {
      position: 'relative',
    },
    buttonLift: {
      transform: [{translateY: -2}],
    },
    dropShadow: {
      display: 'none',
    },
    circleWrap: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
      width: 96,
      height: 96,
    },
    circleShadowUnder: {
      position: 'absolute',
      bottom: 10,
      right: 10,
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: 'rgba(0, 0, 0, 0.2)',
    },
    loadingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadingText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white,
      marginLeft: 12,
    },
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    versionChip: {
      marginTop: 12,
      paddingHorizontal: 14,
      paddingVertical: 0,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: updateAvailable ? theme.colors.accent : theme.colors.border,
      backgroundColor: theme.colors.cardBackground,
      alignSelf: 'center',
      width: 100,
      height: 32,
      justifyContent: 'center',
    },
    versionChipContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      justifyContent: 'center',
      width: '100%',
    },
    versionChipLabel: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
    },
    versionChipDot: {
      width: 4,
      height: 4,
      borderRadius: 3,
      backgroundColor: theme.colors.secondary,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    modalContent: {
      width: '100%',
      maxWidth: 360,
      borderRadius: 16,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 16,
      backgroundColor: theme.colors.cardBackground,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    modalHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    modalHeaderTitle: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    modalBodyText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      lineHeight: 20,
      marginTop: 4,
      marginBottom: 16,
    },
    modalButtonsRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 12,
      borderTopWidth: 1,
      borderColor: theme.colors.border,
      paddingTop: 16,
    },
    modalButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      minWidth: 96,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalSecondaryButton: {
      backgroundColor: theme.colors.cardBackground,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    modalPrimaryButton: {
      backgroundColor: theme.colors.primary,
    },
    modalSecondaryText: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
    },
    modalPrimaryText: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.background,
    },
    bottomStack: {
      width: '100%',
      alignItems: 'stretch',
    },
    quotesTickerOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
    },
    quotesTickerStrip: {
      width: '100%',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      backgroundColor: theme.colors.cardBackground,
      paddingTop: 10,
      minHeight: 20,
      justifyContent: 'center',
    },
    quotesTickerLineWrap: {
      width: '100%',
      overflow: 'hidden',
    },
    quotesTickerMarqueeText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      maxWidth: 1_000_000,
      ...(Platform.OS === 'android'
        ? {includeFontPadding: false, textBreakStrategy: 'simple' as const}
        : {}),
    },
    quotesTickerStaticText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      width: '100%',
    },
    quotesTickerWebMarquee: {
      height: 28,
      width: '100%',
      backgroundColor: 'transparent',
    },
    quotesTickerWebMarqueePlaceholder: {
      minHeight: 28,
    },
    toastWrapper: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      elevation: 9999,
    },
  });
  // Use simple background color instead of gradient, especially in dark mode
  const isDarkMode = theme.colors.background !== '#ffffff';
  const backgroundColor = isDarkMode ? '#1A1A1A' : theme.colors.background;
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={[styles.container, {backgroundColor}]}>
        <View style={[styles.contentContainer]}>
          <Animated.View
            style={styles.logoContainer}
            onLayout={e => {
              const {width, height} = e.nativeEvent.layout;
              logoLayoutRef.current = {width, height};
            }}>
            {particlesEnabled && (
              <ParticlesErrorBoundary onError={disableParticles}>
                <View style={styles.particlesContainer}>
                  {particles.map(p => {
                    const rotateInterpolate = p.rotate.interpolate({
                      inputRange: [-Math.PI, Math.PI],
                      outputRange: ['-180deg', '180deg'],
                    });
                    const centerX = logoLayoutRef.current.width / 2;
                    const centerY = logoLayoutRef.current.height / 2;
                    return (
                      <Animated.Image
                        key={p.id}
                        source={require('../assets/bitcoin-icon.png')}
                        style={[
                          styles.particle,
                          {
                            left: centerX - p.size / 2,
                            top: centerY - p.size / 2,
                            width: p.size,
                            height: p.size,
                            opacity: p.opacity,
                            transform: [
                              {translateX: p.x},
                              {translateY: p.y},
                              {scale: p.scale},
                              {rotate: rotateInterpolate},
                            ],
                          },
                        ]}
                        resizeMode="contain"
                      />
                    );
                  })}
                </View>
              </ParticlesErrorBoundary>
            )}
            <Pressable
              onPress={handleLogoPress}
              onPressIn={startLogoTouch}
              onPressOut={endLogoTouch}
              accessibilityRole="button"
              accessibilityLabel="Activate vapor turbulence"
              accessibilityHint="Double tap to increase particle spread">
              <Animated.View style={{transform: [{scale: logoScale}]}}>
                <Image
                  style={[styles.storeIcon]}
                  source={
                    theme.colors.background === '#ffffff'
                      ? require('../assets/bold-icon.png') // Original icon in light mode
                      : require('../assets/bold-icon-inverted.png') // Use inverted icon in dark mode
                  }
                />
              </Animated.View>
            </Pressable>
          </Animated.View>
        </View>
        <View
          style={[
            styles.bottomStack,
            loadingQuotes.length > 0
              ? {
                  paddingBottom:
                    44 +
                    (Platform.OS === 'ios'
                      ? quotesStripBottomInset
                      : insets.bottom),
                }
              : null,
          ]}>
          <View style={styles.bottomContainer}>
            <Animated.View
              style={[
                styles.buttonAnimatedContainer,
                styles.buttonLift,
                {transform: [{scale: buttonScale}]},
              ]}>
              {/* Floating drop shadow to emphasize FAB look */}
              <View style={styles.dropShadow} />
              <Pressable
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handlePress}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Unlock with biometrics"
                accessibilityHint="Double tap to authenticate and unlock"
                testID="unlock-biometric-button">
                {loading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.white}
                    />
                    <Text style={styles.loadingText}>Unlocking...</Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.circleWrap}>
                      <View style={styles.circleShadowUnder} />
                      <View style={styles.iconWrapper}>
                        <Animated.View
                          style={{
                            ...StyleSheet.flatten(styles.glowCircle),
                            transform: [{scale: glowScale}],
                            opacity: glowOpacity,
                          }}
                        />
                        <Animated.Image
                          source={require('../assets/fingerprint.png')}
                          style={[
                            styles.icon,
                            {transform: [{scale: iconPulse}]},
                          ]}
                        />
                      </View>
                    </View>
                  </>
                )}
              </Pressable>
            </Animated.View>
            {showVersionChip ? (
              <Pressable
                onPress={handleVersionPress}
                style={styles.versionChip}
                accessibilityRole="button"
                accessibilityLabel="Check for Bold Wallet updates"
                hitSlop={8}>
                {checkingUpdate ? (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.secondary}
                  />
                ) : (
                  <View style={styles.versionChipContent}>
                    <Text style={styles.versionChipLabel}>
                      v{version} • {buildNumber}
                    </Text>
                  </View>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
        {loadingQuotes.length > 0 ? (
          <View style={styles.quotesTickerOverlay} pointerEvents="none">
            <LoadingQuotesMarquee
              quotes={loadingQuotes}
              reduceMotion={reduceMotion}
              bottomInset={quotesStripBottomInset}
              appActive={appActive}
              textColor={theme.colors.textSecondary}
              fontSize={theme.fontSizes?.md || 15}
              styles={{
                strip: styles.quotesTickerStrip,
                lineWrap: styles.quotesTickerLineWrap,
                marqueeText: styles.quotesTickerMarqueeText,
                staticText: styles.quotesTickerStaticText,
                webMarquee: styles.quotesTickerWebMarquee,
                webMarqueePlaceholder: styles.quotesTickerWebMarqueePlaceholder,
              }}
            />
          </View>
        ) : null}
        <Modal
          visible={showUpdateModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowUpdateModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Image
                  source={require('../assets/bold-icon.png')}
                  style={styles.icon}
                  resizeMode="contain"
                  tintColor={theme.colors.secondary}
                />
                <Text style={styles.modalHeaderTitle}>Update available</Text>
              </View>
              <Text style={styles.modalBodyText}>
                New version ({latestVersion ?? 'latest'}) available.
                {'\n\n'}
                For best interoperability and stability, please update all your
                devices from the same source you originally installed Bold from
                (App Store, Play Store, F-Droid, or other stores).
              </Text>
              <View style={styles.modalButtonsRow}>
                <AppPressable
                  style={[styles.modalButton, styles.modalPrimaryButton]}
                  onPress={() => {
                    setShowUpdateModal(false);
                  }}>
                  <Text style={styles.modalPrimaryText}>Okay</Text>
                </AppPressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
      <View pointerEvents="box-none" style={styles.toastWrapper}>
        <Toast config={createToastConfig(theme)} />
      </View>
    </SafeAreaView>
  );
};
export default LoadingScreen;
