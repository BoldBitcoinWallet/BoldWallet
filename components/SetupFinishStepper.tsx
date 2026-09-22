/**
 * After keygen: one card, two steps.
 * 1 Save the keyshare. 2 Confirm every phone backed up.
 */
import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../theme';
import AppPressable from './AppPressable';

type Step = 1 | 2;

export default function SetupFinishStepper({
  save,
  confirm,
  onAbort,
  onContinue,
  continueDisabled,
}: {
  save: React.ReactNode;
  confirm: React.ReactNode;
  onAbort: () => void;
  onContinue: () => void;
  continueDisabled?: boolean;
}) {
  const {theme} = useTheme();
  const tokens = theme.colors;
  const [step, setStep] = useState<Step>(1);
  const styles = StyleSheet.create({
    card: {
      backgroundColor: tokens.cardBackground,
      borderRadius: 12,
      padding: 14,
      marginVertical: 8,
      width: '100%',
      borderWidth: 1,
      borderColor: tokens.border,
    },
    stepper: {flexDirection: 'row', gap: 8, marginBottom: 12},
    pill: {
      flex: 1,
      borderWidth: 1,
      borderColor: tokens.border,
      borderRadius: 8,
      paddingVertical: 8,
      alignItems: 'center',
    },
    pillOn: {borderColor: tokens.bitcoinOrange},
    label: {color: tokens.textSecondary, fontSize: 12, fontWeight: '600'},
    labelOn: {color: tokens.text},
    next: {
      marginTop: 12,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      backgroundColor: tokens.bitcoinOrange,
    },
    nextText: {color: '#FFFFFF', fontWeight: '700'},
    actionRow: {flexDirection: 'row', gap: 10, marginTop: 14},
    abortBtn: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: tokens.danger ?? '#c0392b',
    },
    abortText: {color: tokens.danger ?? '#c0392b', fontWeight: '700'},
    continueBtn: {
      flex: 1.4,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      backgroundColor: tokens.bitcoinOrange,
    },
    continueOff: {opacity: 0.4},
  });

  return (
    <View style={styles.card}>
      <View style={styles.stepper}>
        <AppPressable
          onPress={() => setStep(1)}
          style={[styles.pill, step === 1 && styles.pillOn]}>
          <Text style={[styles.label, step === 1 && styles.labelOn]}>1 Save</Text>
        </AppPressable>
        <AppPressable
          onPress={() => setStep(2)}
          style={[styles.pill, step === 2 && styles.pillOn]}>
          <Text style={[styles.label, step === 2 && styles.labelOn]}>2 Confirm</Text>
        </AppPressable>
      </View>
      {step === 1 ? (
        <>
          {save}
          <AppPressable style={styles.next} onPress={() => setStep(2)}>
            <Text style={styles.nextText}>Next</Text>
          </AppPressable>
        </>
      ) : (
        <>
          {confirm}
          <View style={styles.actionRow}>
            <AppPressable style={styles.abortBtn} onPress={onAbort}>
              <Text style={styles.abortText}>Abort</Text>
            </AppPressable>
            <AppPressable
              style={[styles.continueBtn, continueDisabled && styles.continueOff]}
              disabled={!!continueDisabled}
              onPress={onContinue}>
              <Text style={styles.nextText}>Continue</Text>
            </AppPressable>
          </View>
        </>
      )}
    </View>
  );
}
