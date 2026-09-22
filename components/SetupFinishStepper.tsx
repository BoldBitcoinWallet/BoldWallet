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
  // Backup (in pairing screens) stays a separate fill from Next/Continue.
  // Next/Continue use Bitcoin orange with white labels in both themes.
  const nextFill = tokens.bitcoinOrange;
  const onAccent = '#FFFFFF';
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
      minHeight: 48,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: nextFill,
    },
    nextLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    nextText: {
      color: onAccent,
      fontSize: 16,
      lineHeight: 20,
      fontWeight: '700',
    },
    nextIcon: {
      color: onAccent,
      fontSize: 18,
      lineHeight: 20,
      fontWeight: '700',
      marginLeft: 4,
      includeFontPadding: false,
      textAlignVertical: 'center',
    },
    actionRow: {flexDirection: 'row', gap: 10, marginTop: 14},
    abortBtn: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: tokens.danger,
      backgroundColor: tokens.dangerOverlay15,
    },
    abortText: {color: tokens.danger, fontSize: 16, fontWeight: '700'},
    continueBtn: {
      flex: 1.4,
      minHeight: 48,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: nextFill,
    },
    continueOff: {backgroundColor: tokens.disabled},
    continueOffText: {color: tokens.disabledText},
  });

  const nextLabel = (title: string, disabled?: boolean) => (
    <View style={styles.nextLabelRow}>
      <Text style={[styles.nextText, disabled && styles.continueOffText]}>
        {title}
      </Text>
      <Text style={[styles.nextIcon, disabled && styles.continueOffText]}>›</Text>
    </View>
  );

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
          <AppPressable style={styles.next} onPress={() => setStep(2)} accessibilityRole="button">
            {nextLabel('Next')}
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
              {nextLabel('Continue', !!continueDisabled)}
            </AppPressable>
          </View>
        </>
      )}
    </View>
  );
}
