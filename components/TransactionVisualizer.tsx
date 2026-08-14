import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Animated,
  Easing,
  TouchableOpacity,
  Linking,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { createStyles } from './Styles';
import { useTheme } from '../theme';

export type Phase = 'idle' | 'signing' | 'broadcasting' | 'mempool' | 'confirmed';

interface Props {
  txid?: string | null;
  initialPhase?: Phase;
  network?: 'mainnet' | 'testnet';
  explorerBaseUrl?: string | null;
  onPhaseChange?: (phase: Phase) => void;
  compact?: boolean;
}

const MAX_POLL_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 6500;

export const ActiveTxVisualizer: React.FC<Props> = ({
  txid = null,
  initialPhase = 'idle',
  network = 'mainnet',
  explorerBaseUrl = null,
  onPhaseChange = () => {},
  compact = false,
}) => {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [confirmations, setConfirmations] = useState(0);
  const [confirmedBlockHeight, setConfirmedBlockHeight] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const pollAttempts = useRef(0);
  const pollInterval = useRef<NodeJS.Timeout | null>(null);

  // Animations
  const progressAnim = useRef(new Animated.Value(0)).current;
  const sig1Scale = useRef(new Animated.Value(0.8)).current;
  const sig2Scale = useRef(new Animated.Value(0.8)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  
  const {theme} = useTheme();
  const styles = createStyles(theme);

  const getMempoolApiBase = () => {
    return network === 'testnet'
      ? 'https://mempool.space/testnet/api'
      : 'https://mempool.space/api';
  };

  const getExplorerBase = () => {
    if (explorerBaseUrl && explorerBaseUrl.trim()) {
      return explorerBaseUrl.trim().replace(/\/+$/, '');
    }
    return getMempoolApiBase().replace(/\/api\/?$/i, '');
  };

  const openTxOnExplorer = () => {
    if (!txid) return;
    const url = `${getExplorerBase()}/tx/${txid}`;
    Linking.openURL(url).catch((err) => console.error('Failed to open URL:', err));
  };

  // --- Animation Controllers ---
  useEffect(() => {
    // Pulse animation loop for nodes and payload
    Animated.loop(
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
      ])
    ).start();
  }, [pulseAnim]);

  useEffect(() => {
    onPhaseChange(phase);
    
    let targetProgress = 0;
    
    switch (phase) {
      case 'idle':
        targetProgress = 0;
        break;
      case 'signing':
        targetProgress = 35;
        Animated.sequence([
          Animated.spring(sig1Scale, { toValue: 1.04, useNativeDriver: true }),
          Animated.delay(900),
          Animated.spring(sig2Scale, { toValue: 1.04, useNativeDriver: true }),
        ]).start(({ finished }) => {
          if (finished) setTimeout(() => setPhase('broadcasting'), 1200);
        });
        break;
      case 'broadcasting':
        targetProgress = 62;
        setTimeout(() => setPhase('mempool'), 1400);
        break;
      case 'mempool':
        targetProgress = 86;
        if (txid) startPolling(txid);
        break;
      case 'confirmed':
        targetProgress = 100;
        if (pollInterval.current) clearInterval(pollInterval.current);
        break;
    }

    Animated.timing(progressAnim, {
      toValue: targetProgress,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // width/percentage cannot use native driver
    }).start();

  }, [phase, txid]);

  // --- API Polling ---
  const pollTxStatus = useCallback(async (currentTxid: string) => {
    pollAttempts.current += 1;

    if (pollAttempts.current > MAX_POLL_ATTEMPTS) {
      setErrorMessage('Transaction status timeout — please check mempool.space');
      if (pollInterval.current) clearInterval(pollInterval.current);
      return;
    }

    try {
      const url = `${getMempoolApiBase()}/tx/${currentTxid}/status`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        setErrorMessage(null);
        
        const isConfirmed = data.confirmed;
        const blockHeight = isConfirmed ? Number(data.block_height) : null;
        
        setConfirmedBlockHeight(blockHeight);
        setConfirmations(isConfirmed ? 1 : 0);

        if (isConfirmed && phase !== 'confirmed') {
          setPhase('confirmed');
        }
      }
    } catch (e) {
      console.warn('[ActiveTxVisualizer] poll error', e);
      if (pollAttempts.current >= MAX_POLL_ATTEMPTS) {
        setErrorMessage('Failed to fetch transaction status');
        if (pollInterval.current) clearInterval(pollInterval.current);
      }
    }
  }, [phase, network]);

  const startPolling = (currentTxid: string) => {
    if (pollInterval.current) clearInterval(pollInterval.current);
    pollAttempts.current = 0;
    setErrorMessage(null);
    pollTxStatus(currentTxid);
    pollInterval.current = setInterval(() => pollTxStatus(currentTxid), POLL_INTERVAL_MS);
  };

  useEffect(() => {
    if (txid && phase === 'idle') {
      setPhase('mempool');
    }
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [txid]);

  // --- Interpolations ---
  const sig1Color = sig1Scale.interpolate({ inputRange: [0.8, 1.04], outputRange: ['#00ffcc', '#ffd700'] });
  const sig2Color = sig2Scale.interpolate({ inputRange: [0.8, 1.04], outputRange: ['#00ffcc', '#ffd700'] });
  
  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const pulseScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] });

  return (
    <View style={[styles.containerTransaction, compact && styles.containerCompact]}>
      
      {/* Top Labels */}
      <View style={styles.trackLabelRow}>
        <Text style={[styles.trackLabel, styles.walletLabel]}>WALLET</Text>
        <Text style={[styles.trackLabel, phase === 'confirmed' ? styles.validatedLabel : null]}>
          {phase === 'confirmed' ? 'VALIDATED' : 'BLOCKCHAIN'}
        </Text>
      </View>

      {/* Main Visual Track */}
      <View style={styles.visualTrack}>
        <View style={styles.sigGroup}>
          {phase !== 'idle' && (
            <Animated.View style={[styles.sigCircle, { transform: [{ scale: sig1Scale }], borderColor: sig1Color }]}>
              <Animated.Text style={[styles.sigText, { color: sig1Color }]}>SIG 1</Animated.Text>
            </Animated.View>
          )}
          {['signing', 'broadcasting', 'mempool', 'confirmed'].includes(phase) && (
            <Animated.View style={[styles.sigCircle, { transform: [{ scale: sig2Scale }], borderColor: sig2Color }]}>
              <Animated.Text style={[styles.sigText, { color: sig2Color }]}>SIG 2</Animated.Text>
            </Animated.View>
          )}
        </View>

        {/* Progress Line */}
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
              phase === 'broadcasting' && styles.progressLaunched,
              ['mempool', 'confirmed'].includes(phase) && styles.progressInCube,
            ]}
          />
        </View>

        {/* Destination Node/Cube */}
        <View style={styles.cubeGraphic}>
          {phase !== 'confirmed' ? (
            <View style={styles.nodeRow}>
              <View style={styles.chainNode} />
              <View style={styles.chainNode} />
              <Animated.View style={[styles.chainNode, styles.chainNodeHot, phase === 'mempool' && { opacity: pulseOpacity }]} />
            </View>
          ) : (
            <Animated.View style={styles.validatedBlock}>
              <Svg width="48" height="48" viewBox="0 0 64 64" fill="none">
                <Path d="M32 8L52 18L32 28L12 18L32 8Z" stroke="#00ffaa" strokeWidth="2" strokeLinejoin="round" />
                <Path d="M12 18V42L32 52V28L12 18Z" stroke="#00ffaa" strokeWidth="2" strokeLinejoin="round" />
                <Path d="M52 18V42L32 52V28L52 18Z" stroke="#00ffaa" strokeWidth="2" strokeLinejoin="round" />
                <AnimatedCircle cx="32" cy="30" r="5" fill="#ffb700" opacity={pulseOpacity} scale={pulseScale} origin="32, 30" />
              </Svg>
            </Animated.View>
          )}
        </View>
      </View>

      {/* Status Panel */}
      <View style={[styles.statusPanel, compact && styles.statusPanelCompact]}>
        {errorMessage ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <TouchableOpacity onPress={() => txid && startPolling(txid)} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.centered}>
            <Text style={[styles.statusText, phase === 'confirmed' && styles.statusTextConfirmed]}>
              {phase === 'idle' && 'Awaiting transaction'}
              {phase === 'signing' && 'Dual-signing in progress…'}
              {phase === 'broadcasting' && 'Broadcasting to network'}
              {phase === 'mempool' && `In mempool${confirmations > 0 ? ` • ${confirmations} confs` : ''}`}
              {phase === 'confirmed' && (confirmedBlockHeight ? `Confirmed in Block #${confirmedBlockHeight}` : 'Confirmed on-chain ✓')}
            </Text>
          </View>
        )}

        {txid && !errorMessage && (
          <TouchableOpacity onPress={openTxOnExplorer} style={styles.txidPill} activeOpacity={0.7}>
            <Text style={styles.txidText}>
              {txid.slice(0, 8)}…{txid.slice(-6)}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

// SVG Animated Circle Wrapper
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

