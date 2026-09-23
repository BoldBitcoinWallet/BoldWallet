/**
 * DiceEntropySheet — local dice entry for the master chaincode.
 * Three steps: choose dice, enter the sequence, confirm.
 * Rolls stay on this phone. Air-gap QR is optical only.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-toast-message';
import GlassModalOverlay from './GlassModalOverlay';
import QRScanner from './QRScanner';
import StaticQRCode from './StaticQRCode';
import {useTheme} from '../theme';
import AppPressable from './AppPressable';
import {
  DiceSet,
  DiceKind,
  REQUIRED_ROLLS,
  bitsForSets,
  diceCommitmentHex,
  sidesForKind,
  validateDiceSet,
  MIN_DICE_BITS,
} from '../services/diceEntropy';

interface Props {
  visible: boolean;
  modeLabel?: string;
  initialSets?: DiceSet[];
  onClose?: () => void;
  onUseDice: (result: DiceEntropyResult) => void;
  onSkip: () => void;
}

export interface DiceEntropyResult {
  sets: DiceSet[];
}

type Step = 1 | 2 | 3;

const QR_PREFIX = 'BOLD-DICE-QR-v1';

const KIND_CARDS: {kind: DiceKind; title: string; detail: string}[] = [
  {kind: 'd6', title: 'D6 · 100 rolls', detail: '5 dice, 20 throws. Recommended.'},
  {kind: 'd20', title: 'D20 · 60 rolls', detail: 'One die, 60 throws.'},
  {kind: 'coin', title: 'Coin · 256 flips', detail: 'Heads or tails, 256 times.'},
];

function shuffledFaces(sides: number, salt: number): number[] {
  const arr = Array.from({length: sides}, (_, i) => i + 1);
  const offset = sides > 0 ? salt % sides : 0;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = (i + offset) % arr.length;
    const b = (j + offset) % arr.length;
    [arr[a], arr[b]] = [arr[b], arr[a]];
  }
  const sequential = arr.every((v, i) => v === i + 1);
  if (sequential && arr.length > 1) {
    [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];
  }
  return arr;
}

function faceLabel(kind: DiceKind, v: number): string {
  if (kind === 'coin') return v === 1 ? 'H' : 'T';
  return String(v);
}

/** 3×3 pip indexes. 6 is two columns of three. */
const D6_PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DiePips({value, color, hot}: {value: number; color: string; hot: boolean}) {
  const on = D6_PIPS[value] ?? [];
  return (
    <View style={pipStyles.grid}>
      {Array.from({length: 9}, (_, i) => (
        <View key={i} style={pipStyles.cell}>
          {on.includes(i) ? (
            <View
              style={[
                pipStyles.dot,
                {backgroundColor: color, transform: [{scale: hot ? 1.15 : 1}]},
              ]}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

const pipStyles = StyleSheet.create({
  grid: {width: 42, height: 42, flexDirection: 'row', flexWrap: 'wrap'},
  cell: {width: 14, height: 14, alignItems: 'center', justifyContent: 'center'},
  dot: {width: 8, height: 8, borderRadius: 4},
});

function FaceButton({
  label,
  value,
  showPips,
  size,
  radius,
  textColor,
  borderColor,
  fill,
  accent,
  onPress,
}: {
  label: string;
  value: number;
  showPips: boolean;
  size: number;
  radius: number;
  textColor: string;
  borderColor: string;
  fill: string;
  accent: string;
  onPress: () => void;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const pop = React.useRef(new Animated.Value(0)).current;
  const [hot, setHot] = React.useState(false);
  const hotTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (hotTimer.current) clearTimeout(hotTimer.current);
    };
  }, []);

  const fire = () => {
    onPress();
    setHot(true);
    if (hotTimer.current) clearTimeout(hotTimer.current);
    hotTimer.current = setTimeout(() => setHot(false), 280);
    scale.setValue(1);
    Animated.sequence([
      Animated.spring(scale, {
        toValue: 0.84,
        speed: 60,
        bounciness: 0,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1.14,
        speed: 22,
        bounciness: 14,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        speed: 16,
        bounciness: 8,
        useNativeDriver: true,
      }),
    ]).start();
    pop.setValue(0);
    Animated.timing(pop, {
      toValue: 1,
      duration: 460,
      useNativeDriver: true,
    }).start();
  };

  const popStyle = {
    opacity: pop.interpolate({
      inputRange: [0, 0.12, 1],
      outputRange: [0, 1, 0],
    }),
    transform: [
      {
        translateY: pop.interpolate({
          inputRange: [0, 1],
          outputRange: [8, -26],
        }),
      },
      {
        scale: pop.interpolate({
          inputRange: [0, 0.2, 1],
          outputRange: [0.7, 1.2, 0.95],
        }),
      },
    ],
  };

  return (
    <AppPressable
      variant="none"
      onPress={fire}
      accessibilityLabel={`Face ${label}`}
      style={{width: size, height: size, overflow: 'visible'}}>
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          borderWidth: hot ? 2 : 1.5,
          borderColor: hot ? accent : borderColor,
          backgroundColor: hot ? accent + '33' : fill,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{scale}],
          overflow: 'visible',
        }}>
        {showPips ? (
          <DiePips value={value} color={hot ? accent : textColor} hot={hot} />
        ) : (
          <Text
            style={{
              color: hot ? accent : textColor,
              fontSize: size > 70 ? 28 : 16,
              fontWeight: '800',
            }}>
            {label}
          </Text>
        )}
        <Animated.Text
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: -4,
              color: accent,
              fontSize: 18,
              fontWeight: '800',
            },
            popStyle,
          ]}>
          {label}
        </Animated.Text>
      </Animated.View>
    </AppPressable>
  );
}

function RollChip({
  label,
  fresh,
  textColor,
  fill,
  borderColor,
  accent,
}: {
  label: string;
  fresh: boolean;
  textColor: string;
  fill: string;
  borderColor: string;
  accent: string;
}) {
  const scale = React.useRef(new Animated.Value(fresh ? 0.3 : 1)).current;
  React.useEffect(() => {
    if (!fresh) return;
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 180,
      useNativeDriver: true,
    }).start();
  }, [fresh, scale]);
  return (
    <Animated.View
      style={{
        minWidth: 28,
        height: 28,
        paddingHorizontal: 6,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: fresh ? accent : borderColor,
        backgroundColor: fresh ? accent + '33' : fill,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{scale}],
      }}>
      <Text style={{color: fresh ? accent : textColor, fontSize: 12, fontWeight: '800'}}>
        {label}
      </Text>
    </Animated.View>
  );
}

function kindTitle(kind: DiceKind): string {
  if (kind === 'd6') return 'D6';
  if (kind === 'd20') return 'D20';
  return 'Coin';
}

function requiredForKind(k: DiceKind): number {
  return k === 'd6' ? REQUIRED_ROLLS.d6 : k === 'd20' ? REQUIRED_ROLLS.d20 : REQUIRED_ROLLS.coin;
}

function parseBulkRolls(
  text: string,
  parseKind: DiceKind,
  parseSides: number,
): {ok: true; rolls: number[]} | {ok: false; reason: string} {
  const parts = text.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
  const nums: number[] = [];
  for (const p of parts) {
    const n =
      parseKind === 'coin'
        ? p.toLowerCase() === 'h' || p === '1'
          ? 1
          : p.toLowerCase() === 't' || p === '0' || p === '2'
            ? 2
            : NaN
        : parseInt(p, 10);
    if (!Number.isInteger(n) || n < 1 || n > parseSides) {
      return {
        ok: false,
        reason: `“${p}” is not a valid ${parseKind === 'coin' ? 'H or T' : `face 1–${parseSides}`}.`,
      };
    }
    nums.push(n);
  }
  if (!nums.length) {
    return {
      ok: false,
      reason:
        parseKind === 'coin'
          ? 'Paste flips first (H T H …).'
          : 'Paste rolls first (3 5 1 6 …).',
    };
  }
  return {ok: true, rolls: nums};
}

export default function DiceEntropySheet({
  visible,
  modeLabel,
  initialSets,
  onClose,
  onUseDice,
  onSkip,
}: Props) {
  const {theme} = useTheme();
  const tokens = theme.colors;
  const {fontFamilies} = theme;
  const successColor = (tokens as any).success ?? '#2ecc71';
  const {height: windowHeight} = useWindowDimensions();
  // Header, stepper, and footer stay outside the scroller. The body uses
  // whatever is left, and shrinks when the step is shorter than that.
  const bodyMax = Math.max(220, Math.round(windowHeight * 0.9) - 210);
  const [bodyHeight, setBodyHeight] = useState(0);
  const [step, setStep] = useState<Step>(1);
  const [kind, setKind] = useState<DiceKind>('d6');
  const [rolls, setRolls] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [shuffleFaces, setShuffleFaces] = useState(false);
  const [shuffleSalt, setShuffleSalt] = useState(0);
  const boardFlash = React.useRef(new Animated.Value(0)).current;
  const gridWobble = React.useRef(new Animated.Value(0)).current;
  const [scanVisible, setScanVisible] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [spoken, setSpoken] = useState('');

  const sides = sidesForKind(kind);
  const required = requiredForKind(kind);
  const sets: DiceSet[] = useMemo(
    () => (rolls.length ? [{kind, sides, rolls}] : []),
    [kind, sides, rolls],
  );
  const bits = bitsForSets(sets);
  const progress = Math.min(1, bits / MIN_DICE_BITS);
  const ready = bits >= MIN_DICE_BITS && rolls.length >= required;

  useEffect(() => {
    if (!visible) return;
    const first = initialSets?.[0];
    setError('');
    setShowAll(false);
    setWhyOpen(false);
    setShuffleFaces(false);
    if (first && first.rolls.length) {
      setKind(first.kind);
      setRolls([...first.rolls]);
      const enough =
        first.rolls.length >= requiredForKind(first.kind);
      setStep(enough ? 3 : 2);
    } else {
      setKind('d6');
      setRolls([]);
      setStep(1);
    }
  }, [visible, initialSets]);

  useEffect(() => {
    if (step !== 3 || !rolls.length) {
      setSpoken('');
      return;
    }
    let cancel = false;
    diceCommitmentHex(sides, rolls).then(hex => {
      if (!cancel) setSpoken(hex.slice(0, 8));
    }).catch(() => {
      if (!cancel) setSpoken('');
    });
    return () => {
      cancel = true;
    };
  }, [step, sides, rolls]);

  const faces = useMemo(() => {
    const natural = Array.from({length: sides}, (_, i) => i + 1);
    if (!shuffleFaces) return natural;
    return shuffledFaces(sides, shuffleSalt);
  }, [sides, shuffleFaces, shuffleSalt]);

  const qrValue = useMemo(() => {
    if (!rolls.length) return '';
    return `${QR_PREFIX}|${kind}|${sides}|${rolls.join(',')}`;
  }, [kind, sides, rolls]);

  const selectKind = (next: DiceKind) => {
    if (next === kind) return;
    const apply = () => {
      setKind(next);
      setRolls([]);
      setError('');
      setShuffleFaces(false);
    };
    if (rolls.length) {
      Alert.alert('Change dice?', 'This clears the rolls you entered.', [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Change', style: 'destructive', onPress: apply},
      ]);
      return;
    }
    apply();
  };

  const addRoll = (v: number) => {
    setError('');
    setRolls(prev => [...prev, v]);
    boardFlash.setValue(0);
    Animated.sequence([
      Animated.timing(boardFlash, {toValue: 1, duration: 70, useNativeDriver: true}),
      Animated.timing(boardFlash, {toValue: 0, duration: 320, useNativeDriver: true}),
    ]).start();
  };

  const shuffleBoard = () => {
    setShuffleFaces(on => !on);
    setShuffleSalt(s => s + 1);
    gridWobble.setValue(0);
    Animated.sequence([
      Animated.timing(gridWobble, {toValue: 1, duration: 140, useNativeDriver: true}),
      Animated.spring(gridWobble, {toValue: 0, speed: 14, bounciness: 10, useNativeDriver: true}),
    ]).start();
  };

  const undoLast = () => {
    setError('');
    setRolls(prev => prev.slice(0, -1));
  };

  /** Validate a complete set and jump to Confirm, or report the error on the current step. */
  const landOnConfirm = (
    nextKind: DiceKind,
    nextRolls: number[],
  ): boolean => {
    const nextSides = sidesForKind(nextKind);
    const nextRequired = requiredForKind(nextKind);
    const v = validateDiceSet(nextSides, nextRolls);
    if (!v.ok) {
      setError(v.reason || 'Invalid rolls.');
      return false;
    }
    const nextBits = bitsForSets([{kind: nextKind, sides: nextSides, rolls: nextRolls}]);
    if (nextBits < MIN_DICE_BITS || nextRolls.length < nextRequired) {
      setError(`Need ${nextRequired} rolls (${nextRolls.length}/${nextRequired}).`);
      return false;
    }
    setKind(nextKind);
    setRolls(nextRolls);
    setError('');
    setStep(3);
    return true;
  };

  const applyQrPayload = (
    data: string,
    opts: {jumpConfirm: boolean; stayOnStep1OnFail?: boolean},
  ): boolean => {
    const text = String(data || '').trim();
    if (!text.startsWith(QR_PREFIX)) {
      setError('That QR is not a Bold dice-rolls code.');
      if (opts.stayOnStep1OnFail) setStep(1);
      return false;
    }
    const parts = text.split('|');
    if (parts.length !== 4) {
      setError('Unrecognized dice QR.');
      if (opts.stayOnStep1OnFail) setStep(1);
      return false;
    }
    const [, scannedKind, scannedSides, scannedRolls] = parts;
    if (scannedKind !== 'd6' && scannedKind !== 'd20' && scannedKind !== 'coin') {
      setError('Dice QR has an unknown dice type.');
      if (opts.stayOnStep1OnFail) setStep(1);
      return false;
    }
    const sSides = parseInt(scannedSides, 10);
    const nums = scannedRolls
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => parseInt(s, 10));
    if (!nums.length || nums.some(n => !Number.isInteger(n) || n < 1 || n > sSides)) {
      setError('Dice QR contains a roll this die cannot show.');
      if (opts.stayOnStep1OnFail) setStep(1);
      return false;
    }
    if (opts.jumpConfirm) {
      if (!landOnConfirm(scannedKind as DiceKind, nums)) {
        if (opts.stayOnStep1OnFail) setStep(1);
        return false;
      }
      return true;
    }
    setKind(scannedKind as DiceKind);
    setRolls(nums);
    setError('');
    return true;
  };

  const applyClipboardPaste = async () => {
    setError('');
    try {
      const text = String((await Clipboard.getString()) || '').trim();
      if (!text) {
        setError('Clipboard is empty.');
        return;
      }
      if (text.startsWith(QR_PREFIX)) {
        const applied = applyQrPayload(text, {jumpConfirm: true, stayOnStep1OnFail: true});
        if (!applied) setStep(1);
        return;
      }
      const parsed = parseBulkRolls(text, kind, sides);
      if (!parsed.ok) {
        setError(parsed.reason);
        setStep(1);
        return;
      }
      if (!landOnConfirm(kind, parsed.rolls)) {
        setStep(1);
      }
    } catch {
      setError('Could not read clipboard.');
      setStep(1);
    }
  };

  const handleScanned = (data: string) => {
    setScanVisible(false);
    const ok = applyQrPayload(data, {jumpConfirm: true, stayOnStep1OnFail: true});
    if (!ok) setStep(1);
  };

  const goEnter = () => {
    setError('');
    setStep(2);
  };

  const goConfirm = () => {
    if (!landOnConfirm(kind, rolls)) return;
  };

  const confirm = () => {
    const v = validateDiceSet(sides, rolls);
    if (!v.ok || !ready) {
      setError(v.reason || `Need ${required} rolls.`);
      setStep(2);
      return;
    }
    onUseDice({sets});
  };

  const copyQrPayload = () => {
    if (!qrValue) return;
    Clipboard.setString(qrValue);
    Toast.show({
      type: 'success',
      text1: 'Copied',
      text2: 'Dice rolls copied — paste on the other phone.',
    });
  };

  const styles = StyleSheet.create({
    wrap: {
      width: '90%',
      maxHeight: '90%',
      alignSelf: 'center',
      justifyContent: 'center',
    },
    sheet: {
      backgroundColor: tokens.cardBackground,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: tokens.border,
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 16,
      width: '100%',
      maxHeight: '100%',
      alignSelf: 'stretch',
    },
    handle: {
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: tokens.border,
      alignSelf: 'center',
      marginBottom: 12,
    },
    title: {color: tokens.text, fontSize: 17, fontWeight: '700'},
    modeLine: {color: tokens.bitcoinOrange, fontSize: 12, fontWeight: '700', marginTop: 2},
    stepper: {flexDirection: 'row', gap: 6, marginTop: 12, marginBottom: 12},
    stepPill: {
      flex: 1,
      borderWidth: 1,
      borderColor: tokens.border,
      borderRadius: 8,
      paddingVertical: 6,
      alignItems: 'center',
    },
    stepPillOn: {borderColor: tokens.bitcoinOrange, backgroundColor: tokens.bitcoinOrange + '22'},
    stepPillDone: {borderColor: successColor},
    stepText: {color: tokens.textSecondary, fontSize: 11, fontWeight: '600'},
    stepTextOn: {color: tokens.text},
    card: {
      borderWidth: 1,
      borderColor: tokens.border,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 8,
    },
    cardOn: {borderColor: tokens.bitcoinOrange},
    cardTitle: {color: tokens.text, fontSize: 15, fontWeight: '700'},
    cardDetail: {color: tokens.textSecondary, fontSize: 12, marginTop: 2},
    transferRow: {flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4},
    transferBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: tokens.border,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 8,
    },
    transferIcon: {width: 16, height: 16, tintColor: tokens.text},
    transferLabel: {color: tokens.text, fontSize: 12, fontWeight: '700', flexShrink: 1},
    hint: {color: tokens.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 6},
    disclosure: {color: tokens.bitcoinOrange, fontSize: 13, fontWeight: '600', marginTop: 10},
    body: {flexGrow: 0},
    bodyContent: {flexGrow: 0},
    barTrack: {height: 8, borderRadius: 4, backgroundColor: tokens.border, overflow: 'hidden', marginTop: 4},
    barFill: {
      height: 8,
      borderRadius: 4,
      backgroundColor: ready ? successColor : tokens.bitcoinOrange,
      width: `${Math.round(progress * 100)}%` as any,
    },
    barLabel: {color: tokens.textSecondary, fontSize: 12, marginTop: 4, fontFamily: fontFamilies.monospace},
    chips: {color: tokens.text, fontSize: 13, fontFamily: fontFamilies.monospace, lineHeight: 18, marginTop: 8},
    link: {color: tokens.textSecondary, fontSize: 12, marginTop: 6},
    shuffleWrap: {alignItems: 'center', marginBottom: 10, marginTop: 4},
    shuffleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1.5,
      borderColor: tokens.bitcoinOrange,
      backgroundColor: tokens.bitcoinOrange + '18',
      borderRadius: 20,
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    shuffleIcon: {width: 14, height: 14, tintColor: tokens.bitcoinOrange},
    shuffleText: {color: tokens.text, fontSize: 13, fontWeight: '700'},
    faceBoard: {
      alignSelf: 'stretch',
      alignItems: 'center',
      borderRadius: 18,
      borderWidth: 1,
      borderColor: tokens.border,
      backgroundColor: tokens.background,
      paddingTop: 36,
      paddingBottom: 16,
      paddingHorizontal: 10,
      overflow: 'visible',
    },
    faceFlash: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 18,
      backgroundColor: tokens.bitcoinOrange,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: kind === 'coin' ? 16 : 8,
      justifyContent: 'center',
      maxWidth: kind === 'coin' ? 220 : kind === 'd20' ? 280 : 240,
      overflow: 'visible',
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      justifyContent: 'center',
      marginTop: 10,
    },
    qrCard: {
      alignItems: 'center',
      marginTop: 10,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tokens.border,
      backgroundColor: tokens.cardBackground,
    },
    qrCaption: {
      color: tokens.textSecondary,
      fontSize: 12,
      marginTop: 8,
      textAlign: 'center',
    },
    copyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 10,
      borderWidth: 1,
      borderColor: tokens.border,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignSelf: 'stretch',
    },
    copyIcon: {width: 16, height: 16, tintColor: tokens.text},
    copyLabel: {color: tokens.text, fontSize: 14, fontWeight: '700'},
    spoken: {
      color: tokens.text,
      fontSize: 22,
      fontFamily: fontFamilies.monospace,
      fontWeight: '700',
      letterSpacing: 1,
      marginTop: 4,
    },
    errorText: {color: tokens.danger, fontSize: 12, marginTop: 8},
    footer: {flexDirection: 'row', gap: 10, marginTop: 14},
    footerBtn: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: tokens.border,
    },
    footerPrimary: {borderColor: tokens.bitcoinOrange, backgroundColor: tokens.bitcoinOrange},
    footerPrimaryOff: {opacity: 0.45},
  });

  const stepDone = (n: Step) => (n === 1 ? true : n === 2 ? rolls.length > 0 : ready);
  const canOpenStep = (n: Step) => n === 1 || (n === 2 && true) || (n === 3 && ready);

  return (
    <>
      <Modal
        visible={visible && !scanVisible}
        transparent
        animationType="slide"
        onRequestClose={onClose}>
        <GlassModalOverlay onPress={onClose}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.wrap}>
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <Text style={styles.title}>Dice rolls</Text>
              {!!modeLabel && <Text style={styles.modeLine}>{modeLabel}</Text>}
              <View style={styles.stepper}>
                {([1, 2, 3] as Step[]).map(n => {
                  const label = n === 1 ? '1 Dice' : n === 2 ? '2 Enter' : '3 Confirm';
                  const on = step === n;
                  const done = stepDone(n) && step !== n;
                  return (
                    <AppPressable
                      key={n}
                      disabled={!canOpenStep(n)}
                      onPress={() => {
                        if (n === 3 && !ready) return;
                        setError('');
                        setStep(n);
                      }}
                      style={[styles.stepPill, on && styles.stepPillOn, done && styles.stepPillDone]}>
                      <Text style={[styles.stepText, (on || done) && styles.stepTextOn]}>{label}</Text>
                    </AppPressable>
                  );
                })}
              </View>

              <ScrollView
                style={[
                  styles.body,
                  {maxHeight: bodyMax},
                  bodyHeight > 0 ? {height: Math.min(bodyHeight, bodyMax)} : null,
                ]}
                contentContainerStyle={styles.bodyContent}
                onContentSizeChange={(_, h) => {
                  setBodyHeight(prev => (Math.abs(prev - h) > 1 ? h : prev));
                }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}>
                {step === 1 && (
                  <View>
                    {KIND_CARDS.map(card => (
                      <AppPressable
                        key={card.kind}
                        onPress={() => selectKind(card.kind)}
                        style={[styles.card, kind === card.kind && styles.cardOn]}>
                        <Text style={styles.cardTitle}>{card.title}</Text>
                        <Text style={styles.cardDetail}>{card.detail}</Text>
                      </AppPressable>
                    ))}
                    <View style={styles.transferRow}>
                      <AppPressable style={styles.transferBtn} onPress={applyClipboardPaste}>
                        <Image
                          source={require('../assets/paste-icon.png')}
                          style={styles.transferIcon}
                          resizeMode="contain"
                        />
                        <Text style={styles.transferLabel}>Paste From Clipboard</Text>
                      </AppPressable>
                      <AppPressable
                        style={styles.transferBtn}
                        onPress={() => {
                          setError('');
                          setScanVisible(true);
                        }}>
                        <Image
                          source={require('../assets/scan-icon.png')}
                          style={styles.transferIcon}
                          resizeMode="contain"
                        />
                        <Text style={styles.transferLabel}>Scan via QR</Text>
                      </AppPressable>
                    </View>
                    <Text style={styles.hint}>
                      Same sequence on every phone. Rolls stay on this phone.
                    </Text>
                    <AppPressable onPress={() => setWhyOpen(v => !v)}>
                      <Text style={styles.disclosure}>{whyOpen ? 'Hide why dice' : 'Why dice?'}</Text>
                    </AppPressable>
                    {whyOpen && (
                      <Text style={styles.hint}>
                        Dice brings external, verifiable randomness so the wallet does not rely on device entropy alone.
                      </Text>
                    )}
                  </View>
                )}

                {step === 2 && (
                  <View>
                    <View style={styles.shuffleWrap}>
                      <AppPressable style={styles.shuffleBtn} onPress={shuffleBoard}>
                        <Image
                          source={require('../assets/dice-icon.png')}
                          style={styles.shuffleIcon}
                          resizeMode="contain"
                        />
                        <Text style={styles.shuffleText}>
                          {shuffleFaces ? 'Restore order' : 'Shuffle'}
                        </Text>
                      </AppPressable>
                    </View>
                    <View style={styles.faceBoard}>
                      <Animated.View
                        pointerEvents="none"
                        style={[styles.faceFlash, {opacity: boardFlash.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 0.22],
                        })}]}
                      />
                      <Animated.View
                        style={[
                          styles.grid,
                          {
                            transform: [
                              {
                                rotate: gridWobble.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: ['0deg', '6deg'],
                                }),
                              },
                              {
                                scale: gridWobble.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [1, 0.94],
                                }),
                              },
                            ],
                          },
                        ]}>
                        {faces.map(v => (
                          <FaceButton
                            key={`${shuffleSalt}-${v}`}
                            label={faceLabel(kind, v)}
                            value={v}
                            showPips={kind === 'd6'}
                            size={kind === 'coin' ? 92 : kind === 'd6' ? 68 : 44}
                            radius={kind === 'coin' ? 46 : kind === 'd6' ? 16 : 12}
                            textColor={tokens.text}
                            borderColor={tokens.border}
                            fill={tokens.cardBackground}
                            accent={tokens.bitcoinOrange}
                            onPress={() => addRoll(v)}
                          />
                        ))}
                      </Animated.View>
                    </View>
                    <Text style={styles.barLabel}>
                      {rolls.length}/{required} · {Math.floor(bits)} / {MIN_DICE_BITS} bits
                    </Text>
                    <View style={styles.barTrack}>
                      <View style={styles.barFill} />
                    </View>
                    {rolls.length ? (
                      <View style={styles.chipRow}>
                        {(showAll ? rolls : rolls.slice(-12)).map((v, i, arr) => {
                          const absolute = showAll ? i : rolls.length - arr.length + i;
                          return (
                            <RollChip
                              key={`${absolute}-${v}`}
                              label={faceLabel(kind, v)}
                              fresh={absolute === rolls.length - 1}
                              textColor={tokens.text}
                              fill={tokens.cardBackground}
                              borderColor={tokens.border}
                              accent={tokens.bitcoinOrange}
                            />
                          );
                        })}
                      </View>
                    ) : (
                      <Text style={styles.chips}>No rolls yet.</Text>
                    )}
                    <View style={{flexDirection: 'row', gap: 16, justifyContent: 'center'}}>
                      <AppPressable onPress={undoLast} disabled={!rolls.length}>
                        <Text style={styles.link}>Undo</Text>
                      </AppPressable>
                      {rolls.length > 24 && (
                        <AppPressable onPress={() => setShowAll(v => !v)}>
                          <Text style={styles.link}>{showAll ? 'Show recent' : 'Show all'}</Text>
                        </AppPressable>
                      )}
                      {!!rolls.length && (
                        <AppPressable onPress={() => { setRolls([]); setError(''); }}>
                          <Text style={styles.link}>Clear</Text>
                        </AppPressable>
                      )}
                    </View>
                  </View>
                )}

                {step === 3 && (
                  <View>
                    <Text style={styles.cardTitle}>{kindTitle(kind)} · {rolls.length} rolls</Text>
                    <Text style={[styles.hint, {marginTop: 10}]}>Read aloud:</Text>
                    <Text style={styles.spoken}>{spoken || '…'}</Text>
                    {!!qrValue && (
                      <View style={styles.qrCard}>
                        <StaticQRCode
                          value={qrValue}
                          size={180}
                          showLogo
                          ecl="M"
                          copyDisabled
                          contentStyle={{padding: 6}}
                        />
                        <Text style={styles.qrCaption}>Optical only · BOLD-DICE-QR-v1</Text>
                        <AppPressable style={styles.copyBtn} onPress={copyQrPayload}>
                          <Image
                            source={require('../assets/copy-icon.png')}
                            style={styles.copyIcon}
                            resizeMode="contain"
                          />
                          <Text style={styles.copyLabel}>Copy to clipboard</Text>
                        </AppPressable>
                      </View>
                    )}
                    <AppPressable onPress={() => setWhyOpen(v => !v)}>
                      <Text style={styles.disclosure}>{whyOpen ? 'Hide why dice' : 'Why dice?'}</Text>
                    </AppPressable>
                    {whyOpen && (
                      <Text style={styles.hint}>
                        Dice brings external, verifiable randomness so the wallet does not rely on device entropy alone.
                      </Text>
                    )}
                  </View>
                )}
                {!!error && <Text style={styles.errorText}>{error}</Text>}
              </ScrollView>

              <View style={styles.footer}>
                {step === 1 ? (
                  <>
                    <AppPressable style={styles.footerBtn} onPress={onSkip}>
                      <Text style={{color: tokens.textSecondary, fontWeight: '600'}}>Skip</Text>
                    </AppPressable>
                    <AppPressable style={[styles.footerBtn, styles.footerPrimary]} onPress={goEnter}>
                      <Text style={{color: '#FFFFFF', fontWeight: '700'}}>Continue</Text>
                    </AppPressable>
                  </>
                ) : (
                  <>
                    <AppPressable
                      style={styles.footerBtn}
                      onPress={() => { setError(''); setStep((step === 3 ? 2 : 1) as Step); }}>
                      <Text style={{color: tokens.textSecondary, fontWeight: '600'}}>Back</Text>
                    </AppPressable>
                    {step === 2 ? (
                      <AppPressable
                        style={[styles.footerBtn, styles.footerPrimary, !ready && styles.footerPrimaryOff]}
                        disabled={!ready}
                        onPress={goConfirm}>
                        <Text style={{color: '#FFFFFF', fontWeight: '700'}}>Continue</Text>
                      </AppPressable>
                    ) : (
                      <AppPressable style={[styles.footerBtn, styles.footerPrimary]} onPress={confirm}>
                        <Text style={{color: '#FFFFFF', fontWeight: '700'}}>Use these rolls</Text>
                      </AppPressable>
                    )}
                  </>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        </GlassModalOverlay>
      </Modal>
      <QRScanner
        visible={scanVisible}
        onClose={() => setScanVisible(false)}
        onScan={(data: string) => handleScanned(data)}
        title="Scan dice rolls"
        subtitle="Point at the other phone's dice QR. Rolls stay on this phone."
      />
    </>
  );
}
