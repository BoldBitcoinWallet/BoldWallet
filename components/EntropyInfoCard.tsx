import React, {useEffect, useState, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Image,
  Modal,
  Animated,
  PanResponder,
  Dimensions,
  TouchableWithoutFeedback,
} from 'react-native';
import {useTheme} from '../theme';
import {
  getDeviceEntropyMetadata,
  type DeviceEntropyMetadata,
} from '../native_modules';
import AppPressable from './AppPressable';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_THRESHOLD = 120; // px to drag down before dismissing
const SHEET_MAX_HEIGHT = 0.85; // 85% of screen

export type EntropyInfoCardProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Bottom-sheet info card showing device RNG / entropy source metadata.
 * Slides up from the bottom, drag handle + swipe-down to dismiss.
 */
export default function EntropyInfoCard({visible, onClose}: EntropyInfoCardProps) {
  const {theme} = useTheme();
  const {colors, fontSizes, fontFamilies, spacing, borderRadius} = theme;

  const [metadata, setMetadata] = useState<DeviceEntropyMetadata | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Swipe-to-dismiss animation ──
  const translateY = useRef(new Animated.Value(0)).current;
  const sheetHeightRef = useRef(SCREEN_HEIGHT * SHEET_MAX_HEIGHT);

  const resetPosition = useCallback(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 4,
      speed: 14,
    }).start();
  }, [translateY]);

  const dismiss = useCallback(() => {
    Animated.timing(translateY, {
      toValue: sheetHeightRef.current + 60,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [translateY, onClose]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > 6,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > DISMISS_THRESHOLD || gestureState.vy > 0.5) {
          dismiss();
        } else {
          resetPosition();
        }
      },
    }),
  ).current;

  // Reset animation when modal opens
  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
    }
  }, [visible, translateY]);

  // ── Fetch metadata ──
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const md = await getDeviceEntropyMetadata();
        if (!cancelled) setMetadata(md);
      } catch {
        if (!cancelled) setMetadata(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const isStrong = metadata?.rng_assessment === 'Strong';
  const assessmentColor = isStrong ? colors.received : colors.danger;
  const assessIcon = isStrong
    ? require('../assets/assess-ok-icon.png')
    : require('../assets/assess-risk-icon.png');

  const styles = makeStyles(colors, spacing, borderRadius, fontSizes, fontFamilies);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tap backdrop to dismiss */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        {/* Bottom sheet card */}
        <Animated.View
          style={[
            styles.sheet,
            {transform: [{translateY}]},
          ]}
          onLayout={e => {
            sheetHeightRef.current = e.nativeEvent.layout.height;
          }}>
          {/* Drag handle — swipe target */}
          <View style={styles.handleArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>

          {/* Header row */}
          <View style={styles.headerRow}>
            <Image
              source={require('../assets/dice-icon.png')}
              style={styles.diceIcon}
              resizeMode="contain"
            />
            <Text style={styles.title} numberOfLines={1}>
              Device Entropy Sources
            </Text>
          </View>

          <View style={styles.accentBar} />


          {/* Scrollable content */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}>
            <Text style={styles.subtitle}>
              Your device's random number generator (RNG) is the cryptographic
              foundation of your wallet's key security.
            </Text>

            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.bitcoinOrange} />
                <Text style={styles.loadingText}>
                  Reading device entropy metadata…
                </Text>
              </View>
            ) : metadata ? (
              <View style={styles.metadataSection}>
                {/* RNG assessment badge */}
                <View
                  style={[
                    styles.assessmentBadge,
                    {
                      backgroundColor: isStrong
                        ? colors.receivedOverlay15
                        : colors.warningBg,
                      borderColor: assessmentColor,
                    },
                  ]}>
                  <Image
                    source={assessIcon}
                    style={[styles.assessIcon, {tintColor: assessmentColor}]}
                    resizeMode="contain"
                  />
                  <Text style={[styles.assessmentText, {color: assessmentColor}]}>
                    RNG Assessment: {metadata.rng_assessment}
                  </Text>
                </View>

                {/* Key insight */}
                <View style={styles.insightBox}>
                  <Text style={styles.insightTitle}>💡 Why this matters</Text>
                  <Text style={styles.insightText}>
                    BoldWallet uses Distributed Key Generation (DKG) across
                    multiple independent devices. Each device contributes its own
                    entropy. The resulting key is a mathematical joint function —
                    no single RNG, no single device, no single point of failure.
                  </Text>
                </View>

                {/* Entropy stats tiles */}
                <View style={styles.entropyStatsRow}>
                  <View style={styles.entropyStatTile}>
                    <Text style={styles.entropyStatValue}>256-bit</Text>
                    <Text style={styles.entropyStatLabel}>Key share entropy</Text>
                    <Text style={styles.entropyStatHint}>
                      Full-entropy CSPRNG output per device
                    </Text>
                  </View>
                  <View style={styles.entropyStatDivider} />
                  <View style={styles.entropyStatTile}>
                    <Text style={styles.entropyStatValue}>up to 3 devices</Text>
                    <Text style={styles.entropyStatLabel}>
                      Independent RNG sources
                    </Text>
                    <Text style={styles.entropyStatHint}>
                      DKG — one honest device protects the key
                    </Text>
                  </View>
                </View>

                {/* Metadata grid */}
                <View style={styles.metadataGrid}>
                  <MetadataRow label="Platform" value={metadata.platform.toUpperCase()} styles={styles} even />
                  <MetadataRow label="OS Version" value={metadata.os_version} styles={styles} />
                  <MetadataRow label="Device" value={metadata.device_model} styles={styles} even />
                  <MetadataRow label="Crypto Framework" value={metadata.crypto_framework} styles={styles} />
                  <MetadataRow label="RNG Source" value={metadata.rng_source} styles={styles} even />
                  <MetadataRow label="Hardware RNG" value={metadata.hardware_rng} styles={styles} />
                  <MetadataRow label="Entropy Pool Health" value={metadata.entropy_pool_health} styles={styles} even />
                </View>
              </View>
            ) : (
              <View style={styles.unknownRow}>
                <Text style={styles.unknownText}>
                  ⚠️ Unable to read device entropy metadata. Your OS CSPRNG is
                  still operating normally — this is likely a bridge issue.
                </Text>
              </View>
            )}

          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function MetadataRow({
  label,
  value,
  styles,
  even,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
  even?: boolean;
}) {
  return (
    <View style={[styles.metadataRow, even && styles.metadataRowEven]}>
      <Text style={styles.metadataRowLabel}>{label}</Text>
      <Text style={styles.metadataRowValue} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

const makeStyles = (
  colors: any,
  spacing: any,
  borderRadius: any,
  fontSizes: any,
  fontFamilies: any,
) =>
  StyleSheet.create({
    // ── Backdrop & sheet container ──
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.cardBackground,
      borderTopLeftRadius: borderRadius.large,
      borderTopRightRadius: borderRadius.large,
      maxHeight: SCREEN_HEIGHT * SHEET_MAX_HEIGHT,
      overflow: 'hidden',
    },

    // ── Drag handle ──
    handleArea: {
      alignItems: 'center',
      paddingTop: 10,
      paddingBottom: 6,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.textSecondary,
      opacity: 0.4,
    },

    // ── Accent bar ──
    accentBar: {
      height: 5,
      backgroundColor: colors.bitcoinOrange,
    },

    // ── Header row ──
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.large,
      paddingVertical: spacing.medium,
    },
    diceIcon: {
      width: 28,
      height: 28,
      marginRight: spacing.small,
      tintColor: colors.bitcoinOrange,
    },
    title: {
      fontSize: fontSizes.lg,
      fontFamily: fontFamilies.bold,
      color: colors.text,
      flexShrink: 1,
    },

    // ── Scrollable area ──
    scrollArea: {
      flexGrow: 0,
    },
    scrollContent: {
      padding: spacing.large,
      paddingBottom: spacing.large + 20,
    },

    // ── Subtitle ──
    subtitle: {
      fontSize: fontSizes.sm,
      fontFamily: fontFamilies.regular,
      color: colors.textSecondary,
      lineHeight: 18,
      marginBottom: 12,
    },

    // ── Loading ──
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      gap: 10,
    },
    loadingText: {
      fontSize: fontSizes.sm,
      fontFamily: fontFamilies.regular,
      color: colors.textSecondary,
    },

    // ── Metadata section ──
    metadataSection: {
      marginBottom: 4,
    },

    // ── Assessment badge ──
    assessmentBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: borderRadius.small,
      borderWidth: 1,
      gap: 8,
      marginBottom: 10,
    },
    assessIcon: {
      width: 20,
      height: 20,
    },
    assessmentText: {
      fontSize: fontSizes.sm,
      fontFamily: fontFamilies.bold,
    },

    // ── Entropy stats tiles ──
    entropyStatsRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      marginTop: 10,
      marginBottom: 10,
    },
    entropyStatTile: {
      flex: 1,
      backgroundColor: colors.blackOverlay04,
      borderRadius: borderRadius.small,
      paddingVertical: 12,
      paddingHorizontal: 8,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    entropyStatValue: {
      fontSize: fontSizes.xl,
      fontFamily: fontFamilies.bold,
      color: colors.bitcoinOrange,
      marginBottom: 2,
    },
    entropyStatLabel: {
      fontSize: fontSizes.xs,
      fontFamily: fontFamilies.bold,
      color: colors.text,
      textAlign: 'center',
    },
    entropyStatHint: {
      fontSize: 10,
      fontFamily: fontFamilies.regular,
      color: colors.textSecondary,
      marginTop: 2,
      textAlign: 'center',
    },
    entropyStatDivider: {
      width: 8,
    },

    // ── Metadata grid ──
    metadataGrid: {
      borderRadius: borderRadius.small,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    metadataRow: {
      paddingVertical: 8,
      paddingHorizontal: 10,
    },
    metadataRowEven: {
      backgroundColor: colors.blackOverlay04,
    },
    metadataRowLabel: {
      fontSize: fontSizes.xs,
      fontFamily: fontFamilies.bold,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 2,
    },
    metadataRowValue: {
      fontSize: fontSizes.sm,
      fontFamily: fontFamilies.monospace,
      color: colors.text,
      lineHeight: 17,
    },

    // ── Unknown / fallback ──
    unknownRow: {
      backgroundColor: colors.warningBg,
      padding: 10,
      borderRadius: borderRadius.small,
      marginBottom: 8,
    },
    unknownText: {
      fontSize: fontSizes.sm,
      fontFamily: fontFamilies.regular,
      color: colors.warningText,
      lineHeight: 18,
    },

    // ── Insight box ──
    insightBox: {
      backgroundColor: colors.blackOverlay04,
      padding: 12,
      borderRadius: borderRadius.small,
      marginTop: 8,
      borderLeftWidth: 3,
      borderLeftColor: colors.bitcoinOrange,
    },
    insightTitle: {
      fontSize: fontSizes.sm,
      fontFamily: fontFamilies.bold,
      color: colors.text,
      marginBottom: 4,
    },
    insightText: {
      fontSize: fontSizes.xs,
      fontFamily: fontFamilies.regular,
      color: colors.textSecondary,
      lineHeight: 17,
    },
  });
