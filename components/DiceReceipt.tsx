/**
 * Local dice note after setup. Count, bits, and the spoken code.
 * No rolls, no chaincode, no peer-match flag.
 */
import React, {useEffect, useState} from 'react';
import {Text, View, StyleSheet} from 'react-native';
import {useTheme} from '../theme';
import {bitsForSets, diceCommitmentHex, type DiceSet} from '../services/diceEntropy';

interface Props {
  diceLabel: string;
  rollsCount: number;
  bits: number;
  spokenCode: string;
}

export default function DiceReceipt({
  diceLabel,
  rollsCount,
  bits,
  spokenCode,
}: Props) {
  const {theme} = useTheme();
  const tokens = theme.colors;
  const {fontFamilies} = theme;
  const styles = StyleSheet.create({
    box: {
      backgroundColor: tokens.cardBackground,
      borderColor: tokens.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 14,
      marginTop: 12,
    },
    title: {color: tokens.text, fontSize: 15, fontWeight: '700', marginBottom: 8},
    row: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4},
    k: {color: tokens.textSecondary, fontSize: 12},
    v: {color: tokens.text, fontSize: 12, fontFamily: fontFamilies.monospace},
    hint: {color: tokens.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 8},
  });
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Dice rolls on this phone</Text>
      <View style={styles.row}>
        <Text style={styles.k}>Dice</Text>
        <Text style={styles.v}>{diceLabel}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.k}>Rolls</Text>
        <Text style={styles.v}>{rollsCount}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.k}>Strength</Text>
        <Text style={styles.v}>{Math.floor(bits)} bits</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.k}>Read-aloud code</Text>
        <Text style={styles.v}>{spokenCode || '…'}</Text>
      </View>
      <Text style={styles.hint}>
        This code should match the other phones. Setup already compared a short check of it.
      </Text>
    </View>
  );
}

export function DiceSetupNote({sets}: {sets: DiceSet[]}) {
  const [code, setCode] = useState('');
  const first = sets[0];
  useEffect(() => {
    if (!first?.rolls.length) {
      setCode('');
      return;
    }
    let cancel = false;
    diceCommitmentHex(first.sides, first.rolls).then(hex => {
      if (!cancel) setCode(hex.slice(0, 8));
    }).catch(() => {
      if (!cancel) setCode('');
    });
    return () => {
      cancel = true;
    };
  }, [first]);
  if (!first?.rolls.length) return null;
  const label = first.kind === 'd6' ? 'D6' : first.kind === 'd20' ? 'D20' : 'Coin';
  return (
    <DiceReceipt
      diceLabel={label}
      rollsCount={first.rolls.length}
      bits={bitsForSets(sets)}
      spokenCode={code}
    />
  );
}
