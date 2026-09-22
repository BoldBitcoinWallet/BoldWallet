/**
 * DiceEntropySheet — local dice entry for the master chaincode.
 * Three steps: choose dice, enter the sequence, confirm.
 * Rolls stay on this phone. Air-gap QR is optical only.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import GlassModalOverlay from './GlassModalOverlay';
import QRScanner from './QRScanner';
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
type EntryMethod = 'paste' | 'tap' | 'airgap';

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

function kindTitle(kind: DiceKind): string {
  if (kind === 'd6') return 'D6';
  if (kind === 'd20') return 'D20';
  return 'Coin';
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
  const [bulk, setBulk] = useState('');
  const [error, setError] = useState('');
  const [method, setMethod] = useState<EntryMethod>('paste');
  const [shuffleFaces, setShuffleFaces] = useState(false);
  const [shuffleSalt, setShuffleSalt] = useState(0);
  const [showQr, setShowQr] = useState(false);
  const [scanVisible, setScanVisible] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [spoken, setSpoken] = useState('');

  const sides = sidesForKind(kind);
  const required =
    kind === 'd6' ? REQUIRED_ROLLS.d6 : kind === 'd20' ? REQUIRED_ROLLS.d20 : REQUIRED_ROLLS.coin;
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
    setBulk('');
    setShowQr(false);
    setShowAll(false);
    setWhyOpen(false);
    setMethod('paste');
    setShuffleFaces(false);
    if (first && first.rolls.length) {
      setKind(first.kind);
      setRolls([...first.rolls]);
      const enough =
        first.rolls.length >=
        (first.kind === 'd6' ? REQUIRED_ROLLS.d6 : first.kind === 'd20' ? REQUIRED_ROLLS.d20 : REQUIRED_ROLLS.coin);
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
      setBulk('');
      setError('');
      setShuffleFaces(false);
      setShowQr(false);
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
  };

  const undoLast = () => {
    setError('');
    setRolls(prev => prev.slice(0, -1));
  };

  const applyBulk = () => {
    setError('');
    const parts = bulk.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    const nums: number[] = [];
    for (const p of parts) {
      const n =
        kind === 'coin'
          ? p.toLowerCase() === 'h' || p === '1'
            ? 1
            : p.toLowerCase() === 't' || p === '0' || p === '2'
              ? 2
              : NaN
          : parseInt(p, 10);
      if (!Number.isInteger(n) || n < 1 || n > sides) {
        setError(`“${p}” is not a valid ${kind === 'coin' ? 'H or T' : `face 1–${sides}`}.`);
        return;
      }
      nums.push(n);
    }
    if (!nums.length) {
      setError(kind === 'coin' ? 'Paste flips first (H T H …).' : 'Paste rolls first (3 5 1 6 …).');
      return;
    }
    setRolls(prev => [...prev, ...nums]);
    setBulk('');
  };

  const handleScanned = (data: string) => {
    const text = String(data || '').trim();
    if (!text.startsWith(QR_PREFIX)) {
      setError('That QR is not a Bold dice-rolls code.');
      setScanVisible(false);
      return;
    }
    const parts = text.split('|');
    if (parts.length !== 4) {
      setError('Unrecognized dice QR.');
      setScanVisible(false);
      return;
    }
    const [, scannedKind, scannedSides, scannedRolls] = parts;
    if (scannedKind !== 'd6' && scannedKind !== 'd20' && scannedKind !== 'coin') {
      setError('Dice QR has an unknown dice type.');
      setScanVisible(false);
      return;
    }
    const sSides = parseInt(scannedSides, 10);
    const nums = scannedRolls
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => parseInt(s, 10));
    if (!nums.length || nums.some(n => !Number.isInteger(n) || n < 1 || n > sSides)) {
      setError('Dice QR contains a roll this die cannot show.');
      setScanVisible(false);
      return;
    }
    setKind(scannedKind as DiceKind);
    setRolls(nums);
    setBulk('');
    setError('');
    setShowQr(false);
    setScanVisible(false);
    setStep(2);
  };

  const goEnter = () => {
    setError('');
    setStep(2);
  };

  const goConfirm = () => {
    const v = validateDiceSet(sides, rolls);
    if (!v.ok) {
      setError(v.reason || 'Invalid rolls.');
      return;
    }
    if (!ready) {
      setError(`Need ${required} rolls (${rolls.length}/${required}).`);
      return;
    }
    setError('');
    setStep(3);
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
    hint: {color: tokens.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 6},
    disclosure: {color: tokens.bitcoinOrange, fontSize: 13, fontWeight: '600', marginTop: 10},
    body: {flexGrow: 0},
    bodyContent: {flexGrow: 0},
    seg: {flexDirection: 'row', gap: 6, marginBottom: 10},
    segBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: tokens.border,
      borderRadius: 8,
      paddingVertical: 8,
      alignItems: 'center',
    },
    segOn: {borderColor: tokens.bitcoinOrange},
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
    input: {
      borderWidth: 1,
      borderColor: tokens.border,
      borderRadius: 10,
      color: tokens.text,
      backgroundColor: tokens.cardBackground,
      fontFamily: fontFamilies.monospace,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      marginBottom: 8,
    },
    grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
    face: {
      width: 44,
      height: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: tokens.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    faceText: {color: tokens.text, fontSize: 16, fontWeight: '700', fontFamily: fontFamilies.monospace},
    airBtn: {
      borderWidth: 1,
      borderColor: tokens.border,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 12,
      marginBottom: 8,
    },
    qrCard: {
      backgroundColor: '#FFFFFF',
      borderRadius: 16,
      paddingTop: 22,
      paddingBottom: 14,
      paddingHorizontal: 22,
      alignItems: 'center',
    },
    qrFrame: {
      backgroundColor: '#FFFFFF',
      padding: 18,
    },
    qrCaption: {color: '#111111', fontSize: 12, marginTop: 14, textAlign: 'center', lineHeight: 17},
    callout: {
      borderWidth: 1,
      borderColor: (tokens as any).warningBorder ?? tokens.border,
      backgroundColor: (tokens as any).warningBg ?? tokens.cardBackground,
      borderRadius: 10,
      padding: 10,
      marginTop: 12,
    },
    spoken: {color: tokens.text, fontSize: 22, fontFamily: fontFamilies.monospace, fontWeight: '700', letterSpacing: 1, marginTop: 4},
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

  const chipSource = showAll ? rolls : rolls.slice(-24);
  const chipText = chipSource
    .map(v => faceLabel(kind, v))
    .join(' ');

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
                    <Text style={styles.hint}>
                      Enter this same sequence on every phone. These rolls stay on this phone and are not sent over Wi-Fi or Nostr.
                    </Text>
                    <AppPressable onPress={() => setWhyOpen(v => !v)}>
                      <Text style={styles.disclosure}>{whyOpen ? 'Hide why dice' : 'Why dice?'}</Text>
                    </AppPressable>
                    {whyOpen && (
                      <Text style={styles.hint}>
                        The chaincode is hashed from these rolls instead of the phone’s random generator. Write the sequence down. The encrypted backup still holds the chaincode if you lose the paper.
                      </Text>
                    )}
                  </View>
                )}

                {step === 2 && (
                  <View>
                    <Text style={styles.barLabel}>
                      {rolls.length}/{required} · {Math.floor(bits)} / {MIN_DICE_BITS} bits
                    </Text>
                    <View style={styles.barTrack}>
                      <View style={styles.barFill} />
                    </View>
                    <Text style={styles.chips}>
                      {rolls.length ? chipText : 'No rolls yet.'}
                    </Text>
                    <View style={{flexDirection: 'row', gap: 16}}>
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
                    <View style={[styles.seg, {marginTop: 12}]}>
                      {(['paste', 'tap', 'airgap'] as EntryMethod[]).map(m => (
                        <AppPressable
                          key={m}
                          onPress={() => { setMethod(m); setShowQr(false); setError(''); }}
                          style={[styles.segBtn, method === m && styles.segOn]}>
                          <Text style={[styles.stepText, method === m && styles.stepTextOn]}>
                            {m === 'paste' ? 'Paste' : m === 'tap' ? 'Tap' : 'Air-gap'}
                          </Text>
                        </AppPressable>
                      ))}
                    </View>

                    {method === 'paste' && (
                      <View>
                        <TextInput
                          style={styles.input}
                          value={bulk}
                          onChangeText={setBulk}
                          placeholder={kind === 'coin' ? 'H T H T …' : '3 5 1 6 …'}
                          placeholderTextColor={tokens.textSecondary}
                          autoCorrect={false}
                          autoCapitalize="none"
                          keyboardType={kind === 'coin' ? 'default' : 'numbers-and-punctuation'}
                        />
                        <AppPressable style={styles.airBtn} onPress={applyBulk}>
                          <Text style={{color: tokens.text, textAlign: 'center', fontWeight: '700'}}>Add</Text>
                        </AppPressable>
                      </View>
                    )}

                    {method === 'tap' && (
                      <View>
                        <View style={styles.grid}>
                          {faces.map(v => (
                            <AppPressable key={`${shuffleSalt}-${v}`} style={styles.face} onPress={() => addRoll(v)}>
                              <Text style={styles.faceText}>{faceLabel(kind, v)}</Text>
                            </AppPressable>
                          ))}
                        </View>
                        <AppPressable
                          onPress={() => {
                            setShuffleFaces(on => !on);
                            setShuffleSalt(s => s + 1);
                          }}>
                          <Text style={styles.link}>{shuffleFaces ? 'Faces shuffled · tap to restore order' : 'Shuffle faces'}</Text>
                        </AppPressable>
                      </View>
                    )}

                    {method === 'airgap' && !showQr && (
                      <View>
                        <AppPressable
                          style={styles.airBtn}
                          disabled={!rolls.length}
                          onPress={() => setShowQr(true)}>
                          <Text style={{color: rolls.length ? tokens.text : tokens.textSecondary, textAlign: 'center', fontWeight: '700'}}>
                            Show QR for the other phone
                          </Text>
                        </AppPressable>
                        <AppPressable style={styles.airBtn} onPress={() => setScanVisible(true)}>
                          <Text style={{color: tokens.text, textAlign: 'center', fontWeight: '700'}}>
                            Scan the other phone
                          </Text>
                        </AppPressable>
                      </View>
                    )}

                    {method === 'airgap' && showQr && !!qrValue && (
                      <View style={styles.qrCard}>
                        <View style={styles.qrFrame}>
                          <QRCode
                            value={qrValue}
                            size={220}
                            quietZone={20}
                            ecl="M"
                            backgroundColor="#FFFFFF"
                            color="#000000"
                          />
                        </View>
                        <Text style={styles.qrCaption}>
                          Same room only. Scanning this copies the rolls. It is not sent over the network.
                        </Text>
                        <AppPressable onPress={() => setShowQr(false)}>
                          <Text style={[styles.link, {color: '#111'}]}>Hide QR</Text>
                        </AppPressable>
                      </View>
                    )}
                  </View>
                )}

                {step === 3 && (
                  <View>
                    <Text style={styles.cardTitle}>{kindTitle(kind)} · {rolls.length} rolls</Text>
                    <Text style={styles.hint}>About {Math.floor(bits)} bits.</Text>
                    <Text style={[styles.hint, {marginTop: 14}]}>Read this aloud. Setup compares a short check of it and stops if the phones differ. The rolls and the chaincode stay on this phone.</Text>
                    <Text style={styles.spoken}>{spoken || '…'}</Text>
                    <View style={styles.callout}>
                      <Text style={styles.hint}>
                        If another phone has a different sequence, or skips dice, wallet setup will fail during the secure computation.
                      </Text>
                    </View>
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
