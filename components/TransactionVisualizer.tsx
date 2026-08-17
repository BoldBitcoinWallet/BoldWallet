import React, {useState, useEffect, useRef, useCallback, useMemo} from 'react';
import {View, Animated, Easing, Linking, LayoutChangeEvent} from 'react-native';
import Svg, {Path, Circle} from 'react-native-svg';
import {createStyles} from './Styles';
import {useTheme} from '../theme';
import AppPressable from './AppPressable';
import AppText from './AppText';
import mempoolClient from '../services/MempoolClient';
import {explorerWebBaseFromApiUrl} from '../utils';
import moment from 'moment';
import {
  CANONICAL_TESTNET_MEMPOOL_API_BASE,
  isTestnetNetworkKey,
} from '../services/mempoolApiBase';

export type Phase =
  | 'idle'
  | 'signing'
  | 'broadcasting'
  | 'mempool'
  | 'confirmed';

interface Props {
  txid?: string | null;
  initialPhase?: Phase;
  network?: 'mainnet' | 'testnet' | string;
  explorerBaseUrl?: string | null;
  onPhaseChange?: (phase: Phase) => void;
  compact?: boolean;
  /** Known block height (e.g. from local tx record); preferred over poll state. */
  blockHeight?: number | null;
  /** Confirmation or broadcast timestamp in ms. */
  confirmedAtMs?: number | null;
}

const TRACK_H = 64;
const KEY_W = 38;
const MERGE_PATH_LEN = 280;
const STEM_PATH_LEN = 220;

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Classic key silhouette: bow + hole + shaft + bit, pointing right. */
const KeyGlyph: React.FC<{cy: number; color: string}> = ({cy, color}) => (
  <>
    <Circle cx={10} cy={cy} r={7.5} stroke={color} strokeWidth={2} fill="none" />
    <Circle cx={10} cy={cy} r={2.6} fill={color} />
    <Path
      d={`M 17.5 ${cy} H 34`}
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
    />
    <Path
      d={`M 26 ${cy} V ${cy + 5} M 30 ${cy} V ${cy + 7} M 34 ${cy} V ${cy + 4}`}
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
  </>
);

/**
 * Compact 2-of-2 track: two keys on the left, cubic curves that meet at
 * mid-width, then one stem to the block. Draws on mount.
 */
const CompactCosignTrack: React.FC<{
  accentColor: string;
  successColor: string;
  confirmed: boolean;
}> = ({accentColor, successColor, confirmed}) => {
  const [trackWidth, setTrackWidth] = useState(0);
  const keyAnim = useRef(new Animated.Value(0)).current;
  const drawAnim = useRef(new Animated.Value(0)).current;

  const color = confirmed ? successColor : accentColor;

  useEffect(() => {
    if (trackWidth <= 0) {
      return;
    }
    keyAnim.setValue(0);
    drawAnim.setValue(0);
    Animated.sequence([
      Animated.timing(keyAnim, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(drawAnim, {
        toValue: 1,
        duration: 920,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [drawAnim, keyAnim, trackWidth]);

  const onLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const midX = Math.max(trackWidth * 0.5, 24);
  const endX = Math.max(trackWidth, midX + 8);
  const y1 = 16;
  const y2 = 48;
  const midY = 32;
  const c1 = midX * 0.42;
  const c2 = midX * 0.78;

  const upperD = `M 0 ${y1} C ${c1} ${y1}, ${c2} ${midY}, ${midX} ${midY}`;
  const lowerD = `M 0 ${y2} C ${c1} ${y2}, ${c2} ${midY}, ${midX} ${midY}`;
  const stemD = `M ${midX} ${midY} L ${endX} ${midY}`;

  const curveDash = drawAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [MERGE_PATH_LEN, 0],
  });
  const stemDash = drawAnim.interpolate({
    inputRange: [0, 0.55, 1],
    outputRange: [STEM_PATH_LEN, STEM_PATH_LEN, 0],
  });
  const stemOpacity = drawAnim.interpolate({
    inputRange: [0, 0.55, 1],
    outputRange: [0, 0, 1],
  });

  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        height: TRACK_H,
      }}>
      <Animated.View
        style={{
          width: KEY_W,
          height: TRACK_H,
          opacity: keyAnim,
          transform: [
            {
              scale: keyAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.82, 1],
              }),
            },
          ],
        }}>
        <Svg width={KEY_W} height={TRACK_H} viewBox={`0 0 ${KEY_W} ${TRACK_H}`}>
          <KeyGlyph cy={y1} color={color} />
          <KeyGlyph cy={y2} color={color} />
        </Svg>
      </Animated.View>
      <View style={{flex: 1, height: TRACK_H}} onLayout={onLayout}>
        {trackWidth > 0 && (
          <Svg width={trackWidth} height={TRACK_H}>
            <AnimatedPath
              d={upperD}
              stroke={color}
              strokeWidth={2.4}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${MERGE_PATH_LEN} ${MERGE_PATH_LEN}`}
              strokeDashoffset={curveDash}
            />
            <AnimatedPath
              d={lowerD}
              stroke={color}
              strokeWidth={2.4}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${MERGE_PATH_LEN} ${MERGE_PATH_LEN}`}
              strokeDashoffset={curveDash}
            />
            <AnimatedPath
              d={stemD}
              stroke={color}
              strokeWidth={2.6}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${STEM_PATH_LEN} ${STEM_PATH_LEN}`}
              strokeDashoffset={stemDash}
              opacity={stemOpacity}
            />
          </Svg>
        )}
      </View>
    </View>
  );
};

type CubeBadge = 'check' | 'question' | 'dot';

/** Isometric block with a padded, bordered badge (tick, ?, or chain-tip dot). */
const IsometricCube: React.FC<{
  stroke: string;
  background: string;
  badge: CubeBadge;
  size?: number;
}> = ({stroke, background, badge, size = 48}) => (
  <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <Path
      d="M32 8L52 18L32 28L12 18L32 8Z"
      stroke={stroke}
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <Path
      d="M12 18V42L32 52V28L12 18Z"
      stroke={stroke}
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <Path
      d="M52 18V42L32 52V28L52 18Z"
      stroke={stroke}
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <Circle
      cx="32"
      cy="30"
      r="11"
      fill={background}
      stroke={stroke}
      strokeWidth="1.7"
    />
    {badge === 'check' ? (
      <Path
        d="M26.8 30.6L30.4 34.2L38.6 25.8"
        stroke={stroke}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : badge === 'question' ? (
      <>
        <Path
          d="M28.2 26.2C28.2 23.6 30.1 22 32 22C33.9 22 35.8 23.6 35.8 26.2C35.8 28.2 34.4 29.2 33.2 30.2C32.6 30.7 32 31.2 32 32.2"
          stroke={stroke}
          strokeWidth="2.3"
          strokeLinecap="round"
          fill="none"
        />
        <Circle cx="32" cy="36.4" r="1.6" fill={stroke} />
      </>
    ) : (
      <Circle cx="32" cy="30" r="3.4" fill={stroke} />
    )}
  </Svg>
);

/** Three dots then a short stem into the next block. */
const ChainConnector: React.FC<{color: string; muted?: boolean}> = ({
  color,
  muted = false,
}) => {
  const opacity = muted ? 0.38 : 1;
  return (
    <Svg width={36} height={TRACK_H}>
      <Circle cx={5} cy={32} r={2.1} fill={color} opacity={opacity} />
      <Circle cx={13} cy={32} r={2.1} fill={color} opacity={opacity} />
      <Circle cx={21} cy={32} r={2.1} fill={color} opacity={opacity} />
      <Path
        d="M 25 32 H 36"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        opacity={opacity}
      />
    </Svg>
  );
};

const TXID_RE = /^[a-fA-F0-9]{64}$/;
const MAX_POLL_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 6500;
const STATUS_POLL_TTL_MS = 5000;

function resolveMempoolApiBase(
  explorerBaseUrl: string | null | undefined,
  network: string,
): string {
  if (explorerBaseUrl && explorerBaseUrl.trim()) {
    let normalized = explorerBaseUrl.trim().replace(/\/+$/, '');
    if (!/\/api\/?$/i.test(normalized)) {
      normalized = `${normalized}/api`;
    }
    return normalized;
  }
  return isTestnetNetworkKey(network)
    ? CANONICAL_TESTNET_MEMPOOL_API_BASE
    : 'https://mempool.space/api';
}

export const ActiveTxVisualizer: React.FC<Props> = ({
  txid = null,
  initialPhase = 'idle',
  network = 'mainnet',
  explorerBaseUrl = null,
  onPhaseChange = () => {},
  compact = false,
  blockHeight: blockHeightProp = null,
  confirmedAtMs = null,
}) => {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [confirmations, setConfirmations] = useState(0);
  const [confirmedBlockHeight, setConfirmedBlockHeight] = useState<
    number | null
  >(null);
  const [tipHeight, setTipHeight] = useState<number | null>(null);
  const [tipUnavailable, setTipUnavailable] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollAttempts = useRef(0);
  const pollInterval = useRef<NodeJS.Timeout | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const sig1Scale = useRef(new Animated.Value(0.8)).current;
  const sig2Scale = useRef(new Animated.Value(0.8)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  const {theme} = useTheme();
  const styles = createStyles(theme);
  const isLightMode = theme.colors.background === '#ffffff';
  const accentColor = isLightMode
    ? theme.colors.accent || theme.colors.primary
    : theme.colors.bitcoinOrange;
  const successColor = theme.colors.success;
  const secondaryColor = theme.colors.secondary;

  const mempoolApiBase = useMemo(
    () => resolveMempoolApiBase(explorerBaseUrl, network),
    [explorerBaseUrl, network],
  );

  const explorerWebBase = useMemo(() => {
    const fromApi = explorerWebBaseFromApiUrl(mempoolApiBase);
    if (fromApi) {
      return fromApi;
    }
    return isTestnetNetworkKey(network)
      ? 'https://mempool.space/testnet'
      : 'https://mempool.space';
  }, [mempoolApiBase, network]);

  const stopPolling = useCallback(() => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current);
      pollInterval.current = null;
    }
    if (pollAbortRef.current) {
      pollAbortRef.current.abort();
      pollAbortRef.current = null;
    }
  }, []);

  const openTxOnExplorer = () => {
    if (!txid || !TXID_RE.test(txid)) {
      return;
    }
    const url = `${explorerWebBase}/tx/${txid}`;
    Linking.openURL(url).catch(err =>
      console.error('Failed to open URL:', err),
    );
  };

  const openBlockOnExplorer = (height: number | null) => {
    if (height == null || !Number.isFinite(height)) {
      return;
    }
    const url = `${explorerWebBase}/block/${height}`;
    Linking.openURL(url).catch(err =>
      console.error('Failed to open URL:', err),
    );
  };

  useEffect(() => {
    if (!compact) {
      return;
    }
    let cancelled = false;
    const loadTip = async () => {
      try {
        const url = `${mempoolApiBase.replace(/\/+$/, '')}/blocks/tip/height`;
        const response = await mempoolClient.get<number>(url, {
          ttl: STATUS_POLL_TTL_MS,
          timeoutMs: 8000,
        });
        const height = Number(response.data);
        if (cancelled) {
          return;
        }
        if (response.ok && Number.isFinite(height) && height > 0) {
          setTipHeight(height);
          setTipUnavailable(false);
        } else {
          setTipUnavailable(true);
        }
      } catch {
        if (!cancelled) {
          setTipUnavailable(true);
        }
      }
    };
    loadTip();
    const id = setInterval(loadTip, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [compact, mempoolApiBase]);

  useEffect(() => {
    if (phase === 'confirmed') {
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulseAnim]);

  const pollTxStatus = useCallback(
    async (currentTxid: string) => {
      if (!TXID_RE.test(currentTxid)) {
        return;
      }

      pollAttempts.current += 1;
      if (pollAttempts.current > MAX_POLL_ATTEMPTS) {
        setErrorMessage(
          compact
            ? 'Live status unavailable'
            : 'Transaction status timeout — please check explorer',
        );
        stopPolling();
        return;
      }

      if (pollAbortRef.current) {
        pollAbortRef.current.abort();
      }
      const controller = new AbortController();
      pollAbortRef.current = controller;

      try {
        const url = `${mempoolApiBase.replace(/\/+$/, '')}/tx/${currentTxid}/status`;
        const response = await mempoolClient.get<{
          confirmed?: boolean;
          block_height?: number;
        }>(url, {
          signal: controller.signal,
          ttl: STATUS_POLL_TTL_MS,
          timeoutMs: 8000,
        });

        if (!response.ok) {
          return;
        }

        const data = response.data ?? {};
        setErrorMessage(null);

        const isConfirmed = !!data.confirmed;
        const blockHeight = isConfirmed ? Number(data.block_height) : null;

        setConfirmedBlockHeight(
          blockHeight != null && Number.isFinite(blockHeight) ? blockHeight : null,
        );
        setConfirmations(isConfirmed ? 1 : 0);

        if (isConfirmed) {
          setPhase('confirmed');
        }
      } catch (e) {
        if (controller.signal.aborted) {
          return;
        }
        console.warn('[ActiveTxVisualizer] poll error', e);
        if (pollAttempts.current >= MAX_POLL_ATTEMPTS) {
          setErrorMessage(
            compact ? 'Live status unavailable' : 'Failed to fetch transaction status',
          );
          stopPolling();
        }
      }
    },
    [compact, mempoolApiBase, stopPolling],
  );

  const startPolling = useCallback(
    (currentTxid: string) => {
      if (initialPhase === 'confirmed' || !TXID_RE.test(currentTxid)) {
        return;
      }
      stopPolling();
      pollAttempts.current = 0;
      setErrorMessage(null);
      pollTxStatus(currentTxid);
      pollInterval.current = setInterval(
        () => pollTxStatus(currentTxid),
        POLL_INTERVAL_MS,
      );
    },
    [initialPhase, pollTxStatus, stopPolling],
  );

  useEffect(() => {
    onPhaseChange(phase);
  }, [phase, onPhaseChange]);

  useEffect(() => {
    let targetProgress = 0;

    if (compact) {
      switch (phase) {
        case 'idle':
          targetProgress = 0;
          break;
        case 'mempool':
          targetProgress = 75;
          if (txid) {
            startPolling(txid);
          }
          break;
        case 'confirmed':
          targetProgress = 100;
          stopPolling();
          break;
        default:
          targetProgress = phase === 'signing' ? 35 : 62;
          break;
      }
    } else {
      switch (phase) {
        case 'idle':
          targetProgress = 0;
          break;
        case 'signing':
          targetProgress = 35;
          Animated.sequence([
            Animated.spring(sig1Scale, {
              toValue: 1.04,
              useNativeDriver: false,
            }),
            Animated.delay(900),
            Animated.spring(sig2Scale, {
              toValue: 1.04,
              useNativeDriver: false,
            }),
          ]).start(({finished}) => {
            if (finished) {
              setTimeout(() => setPhase('broadcasting'), 1200);
            }
          });
          break;
        case 'broadcasting':
          targetProgress = 62;
          setTimeout(() => setPhase('mempool'), 1400);
          break;
        case 'mempool':
          targetProgress = 86;
          if (txid) {
            startPolling(txid);
          }
          break;
        case 'confirmed':
          targetProgress = 100;
          stopPolling();
          break;
      }
    }

    Animated.timing(progressAnim, {
      toValue: targetProgress,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [
    phase,
    txid,
    compact,
    progressAnim,
    sig1Scale,
    sig2Scale,
    startPolling,
    stopPolling,
  ]);

  useEffect(() => {
    if (txid && phase === 'idle' && initialPhase !== 'confirmed') {
      setPhase(compact ? 'mempool' : 'mempool');
    }
    return () => {
      stopPolling();
    };
  }, [txid, compact, initialPhase, phase, stopPolling]);

  const sig1Color = sig1Scale.interpolate({
    inputRange: [0.8, 1.04],
    outputRange: [secondaryColor, accentColor],
  });
  const sig2Color = sig2Scale.interpolate({
    inputRange: [0.8, 1.04],
    outputRange: [secondaryColor, accentColor],
  });

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  const effectiveBlockHeight =
    blockHeightProp != null && Number.isFinite(blockHeightProp)
      ? blockHeightProp
      : confirmedBlockHeight;

  const formatTimestamp = (ms: number | null | undefined) => {
    if (ms == null || !Number.isFinite(ms)) {
      return null;
    }
    return moment(ms).format('MMM D, YYYY h:mm A');
  };

  const confirmedStatusLine =
    phase === 'confirmed'
      ? effectiveBlockHeight != null
        ? `Confirmed in block #${effectiveBlockHeight}`
        : 'Confirmed on-chain'
      : null;

  const mempoolStatusLine =
    phase === 'mempool'
      ? tipHeight != null
        ? `In mempool · next #${tipHeight + 1}`
        : tipUnavailable
        ? 'In mempool · tip unavailable'
        : 'In mempool'
      : null;

  const networkHint =
    compact && tipUnavailable && tipHeight == null
      ? 'Last block unavailable — retrying'
      : compact && errorMessage
      ? errorMessage
      : null;

  const sameAsTip =
    phase === 'confirmed' &&
    effectiveBlockHeight != null &&
    tipHeight != null &&
    effectiveBlockHeight === tipHeight;

  const showTipCube = compact && !sameAsTip && (phase !== 'confirmed' || tipHeight != null);
  const txCubeStroke = phase === 'confirmed' ? successColor : accentColor;
  // Tip is a later (or last-known) chain head, never the tx's confirm block
  // (that case hides this cube). Use a dot, not a check, so it isn't confused
  // with confirmation.
  const tipCubeStroke = theme.colors.textSecondary;
  const tipCubeBadge: CubeBadge = tipHeight == null ? 'question' : 'dot';
  const connectorColor =
    phase === 'confirmed' ? successColor : accentColor;

  const secondaryStatusLine =
    phase === 'confirmed'
      ? formatTimestamp(confirmedAtMs)
      : phase === 'mempool' && confirmedAtMs
      ? formatTimestamp(confirmedAtMs)
      : null;

  return (
    <View style={[styles.containerTransaction, compact && styles.containerCompact]}>
      <View style={styles.trackLabelRow}>
        <AppText style={[styles.trackLabel, styles.walletLabel]}>WALLET</AppText>
        <AppText
          style={[
            styles.trackLabel,
            phase === 'confirmed' ? styles.validatedLabel : null,
          ]}>
          {phase === 'confirmed' ? 'CONFIRMED' : 'BLOCKCHAIN'}
        </AppText>
      </View>

      <View style={[styles.visualTrack, compact && styles.visualTrackCompact]}>
        {compact ? (
          <CompactCosignTrack
            accentColor={accentColor}
            successColor={successColor}
            confirmed={phase === 'confirmed'}
          />
        ) : (
          <View style={styles.sigGroup}>
            {phase !== 'idle' && (
              <Animated.View
                style={[
                  styles.sigCircle,
                  {transform: [{scale: sig1Scale}], borderColor: sig1Color},
                ]}>
                <Animated.Text style={[styles.sigText, {color: sig1Color}]}>
                  SIG 1
                </Animated.Text>
              </Animated.View>
            )}
            {['signing', 'broadcasting', 'mempool', 'confirmed'].includes(
              phase,
            ) && (
              <Animated.View
                style={[
                  styles.sigCircle,
                  {transform: [{scale: sig2Scale}], borderColor: sig2Color},
                ]}>
                <Animated.Text style={[styles.sigText, {color: sig2Color}]}>
                  SIG 2
                </Animated.Text>
              </Animated.View>
            )}
          </View>
        )}

        {!compact && (
          <View style={styles.progressWrapper}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
        )}

        <View style={styles.cubeGraphic}>
          {compact ? (
            <Animated.View
              style={
                phase !== 'confirmed' ? {opacity: pulseOpacity} : undefined
              }>
              <AppPressable
                onPress={openTxOnExplorer}
                disabled={!txid}
                haptic={false}
                android_ripple={{color: 'rgba(0,0,0,0.1)', borderless: true}}>
                <IsometricCube
                  stroke={txCubeStroke}
                  background={theme.colors.background}
                  badge={phase === 'confirmed' ? 'check' : 'question'}
                />
              </AppPressable>
            </Animated.View>
          ) : phase !== 'confirmed' ? (
            <View style={styles.nodeRow}>
              <View style={styles.chainNode} />
              <View style={styles.chainNode} />
              <Animated.View
                style={[
                  styles.chainNode,
                  styles.chainNodeHot,
                  phase === 'mempool' && {opacity: pulseOpacity},
                ]}
              />
            </View>
          ) : (
            <AppPressable
              onPress={openTxOnExplorer}
              disabled={!txid}
              haptic={false}
              android_ripple={{color: 'rgba(0,0,0,0.1)', borderless: true}}>
              <IsometricCube
                stroke={successColor}
                background={theme.colors.background}
                badge="check"
              />
            </AppPressable>
          )}
          {compact && (
            <AppText
              variant="caption"
              tone="muted"
              style={styles.blockHeightCaption}>
              {phase === 'confirmed'
                ? effectiveBlockHeight != null
                  ? `#${effectiveBlockHeight}`
                  : 'confirmed'
                : 'pending'}
            </AppText>
          )}
        </View>

        {showTipCube && (
          <View style={styles.chainAhead}>
            <ChainConnector
              color={connectorColor}
              muted={tipHeight == null}
            />
            <View style={styles.cubeGraphic}>
              <AppPressable
                onPress={() => openBlockOnExplorer(tipHeight)}
                disabled={tipHeight == null}
                haptic={false}
                android_ripple={{color: 'rgba(0,0,0,0.1)', borderless: true}}>
                <IsometricCube
                  stroke={tipCubeStroke}
                  background={theme.colors.background}
                  badge={tipCubeBadge}
                />
              </AppPressable>
              <AppText
                variant="caption"
                tone="muted"
                style={styles.blockHeightCaption}>
                {tipHeight != null ? `#${tipHeight}` : 'offline'}
              </AppText>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.statusPanel, compact && styles.statusPanelCompact]}>
        {errorMessage && !compact ? (
          <View style={styles.centered}>
            <AppText style={styles.errorText}>{errorMessage}</AppText>
            <AppPressable
              onPress={() => txid && startPolling(txid)}
              style={styles.retryBtn}>
              <AppText style={styles.retryBtnText}>Retry</AppText>
            </AppPressable>
          </View>
        ) : (
          <View style={styles.centered}>
            <AppText
              style={[
                styles.statusText,
                phase === 'confirmed' && styles.statusTextConfirmed,
              ]}>
              {phase === 'idle' && 'Awaiting transaction'}
              {!compact && phase === 'signing' && 'Dual-signing in progress…'}
              {!compact && phase === 'broadcasting' && 'Broadcasting to network'}
              {mempoolStatusLine}
              {confirmedStatusLine}
            </AppText>
            {secondaryStatusLine ? (
              <AppText variant="caption" tone="muted" style={styles.statusSubtext}>
                {secondaryStatusLine}
              </AppText>
            ) : null}
            {networkHint ? (
              <AppText variant="caption" tone="muted" style={styles.statusSubtext}>
                {networkHint}
              </AppText>
            ) : null}
          </View>
        )}

        {txid && !errorMessage && !compact && (
          <AppPressable onPress={openTxOnExplorer} style={styles.txidPill}>
            <AppText style={styles.txidText}>
              {txid.slice(0, 8)}…{txid.slice(-6)}
            </AppText>
          </AppPressable>
        )}
      </View>
    </View>
  );
};
