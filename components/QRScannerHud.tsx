import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../theme';
import {
  elapsedScanSecondsSince,
  formatElapsedScanSeconds,
  withElapsedScanLabel,
} from '../utils/scanElapsed';
import {
  createUrScanFrameTracker,
  recordUrScanFrame,
  type UrBytesProgress,
} from '../utils/urBytesQr';

export type ScanHudProgress = {
  received: number;
  total: number;
  percentage?: number;
};

export {formatElapsedScanSeconds, withElapsedScanLabel, elapsedScanSecondsSince};

export function useElapsedScanSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [active]);
  return elapsed;
}

/** Live unique-UR-frame counts + whether this payload is new (for haptics). */
export function useUrScanFrameHud(active: boolean): {
  frameProgress: UrBytesProgress | null;
  noteScannedFrame: (value: string) => boolean;
} {
  const trackerRef = useRef(createUrScanFrameTracker());
  const seenPayloadsRef = useRef<Set<string>>(new Set());
  const lastHapticAtRef = useRef(0);
  const [frameProgress, setFrameProgress] = useState<UrBytesProgress | null>(
    null,
  );

  useEffect(() => {
    if (!active) {
      trackerRef.current = createUrScanFrameTracker();
      seenPayloadsRef.current = new Set();
      lastHapticAtRef.current = 0;
      setFrameProgress(null);
    }
  }, [active]);

  const noteScannedFrame = useCallback((value: string): boolean => {
    const payloadNovel = !seenPayloadsRef.current.has(value);
    if (payloadNovel) {
      seenPayloadsRef.current.add(value);
    }
    const {novel: seqNovel, progress} = recordUrScanFrame(
      trackerRef.current,
      value,
    );
    if (progress) {
      setFrameProgress(progress);
    }
    const novel = payloadNovel || seqNovel;
    const now = Date.now();
    if (novel && now - lastHapticAtRef.current > 80) {
      lastHapticAtRef.current = now;
      return true;
    }
    return false;
  }, []);

  return {frameProgress, noteScannedFrame};
}

type ScannerHudProps = {
  title: string;
  subtitle: string;
  elapsedSeconds: number;
  showProgress?: boolean;
  progress?: ScanHudProgress;
};

export const ScannerHud: React.FC<ScannerHudProps> = ({
  title,
  subtitle,
  elapsedSeconds,
  showProgress = false,
  progress,
}) => {
  const {theme} = useTheme();
  const isAnimatedQR = !!(showProgress && progress && progress.total > 1);
  const progressPercent = isAnimatedQR
    ? Math.min(
        100,
        progress!.percentage ||
          Math.round((progress!.received / progress!.total) * 100),
      )
    : 0;
  const styles = StyleSheet.create({
    header: {
      position: 'absolute',
      top: 56,
      left: 16,
      right: 16,
      alignItems: 'center',
    },
    card: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: theme.colors.blackOverlay50,
      borderRadius: 16,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: theme.colors.whiteOverlay20,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      marginBottom: 8,
    },
    title: {
      flex: 1,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white,
    },
    elapsedChip: {
      backgroundColor: theme.colors.bitcoinOrange,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      minWidth: 52,
      alignItems: 'center',
    },
    elapsedText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white,
      letterSpacing: 0.3,
    },
    subtitle: {
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.white,
      opacity: 0.92,
      lineHeight: 18,
    },
    progressMeta: {
      marginTop: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    progressMetaText: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white,
    },
    progressBarContainer: {
      marginTop: 6,
      width: '100%',
      height: 8,
      backgroundColor: theme.colors.whiteOverlay20,
      borderRadius: 4,
      overflow: 'hidden',
    },
    progressBar: {
      height: '100%',
      backgroundColor: theme.colors.bitcoinOrange,
      borderRadius: 4,
    },
    frame: {
      position: 'absolute',
      width: 260,
      height: 260,
      alignSelf: 'center',
      top: '32%',
    },
    corner: {
      position: 'absolute',
      width: 28,
      height: 28,
      borderColor: theme.colors.bitcoinOrange,
    },
    cornerTL: {
      top: 0,
      left: 0,
      borderTopWidth: 4,
      borderLeftWidth: 4,
      borderTopLeftRadius: 10,
    },
    cornerTR: {
      top: 0,
      right: 0,
      borderTopWidth: 4,
      borderRightWidth: 4,
      borderTopRightRadius: 10,
    },
    cornerBL: {
      bottom: 0,
      left: 0,
      borderBottomWidth: 4,
      borderLeftWidth: 4,
      borderBottomLeftRadius: 10,
    },
    cornerBR: {
      bottom: 0,
      right: 0,
      borderBottomWidth: 4,
      borderRightWidth: 4,
      borderBottomRightRadius: 10,
    },
  });

  return (
    <>
      <View style={styles.header}>
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.elapsedChip}>
              <Text style={styles.elapsedText}>
                {formatElapsedScanSeconds(elapsedSeconds)}
              </Text>
            </View>
          </View>
          {subtitle ? (
            <Text style={styles.subtitle}>{subtitle}</Text>
          ) : null}
          {isAnimatedQR ? (
            <>
              <View style={styles.progressMeta}>
                <Text style={styles.progressMetaText}>
                  {progress!.received} / {progress!.total}
                </Text>
                <Text style={styles.progressMetaText}>{progressPercent}%</Text>
              </View>
              <View style={styles.progressBarContainer}>
                <View
                  style={[styles.progressBar, {width: `${progressPercent}%`}]}
                />
              </View>
            </>
          ) : null}
        </View>
      </View>
      <View style={styles.frame} pointerEvents="none">
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </View>
    </>
  );
};
