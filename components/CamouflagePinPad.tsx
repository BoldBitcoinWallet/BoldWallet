import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import AppPressable from './AppPressable';
import {HapticFeedback} from '../utils';
import {CAMOUFLAGE_PIN_LENGTH} from '../services/camouflagePin';
import {useTheme} from '../theme';

type CamouflagePinPadProps = {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (pin: string) => void;
  disabled?: boolean;
  error?: boolean;
  /** Neutral hint under the dots (no wallet wording). */
  hint?: string;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

const CamouflagePinPad: React.FC<CamouflagePinPadProps> = ({
  value,
  onChange,
  onComplete,
  disabled,
  error,
  hint,
}) => {
  const {theme} = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          alignItems: 'center',
          width: '100%',
          maxWidth: 280,
          alignSelf: 'center',
        },
        dots: {
          flexDirection: 'row',
          justifyContent: 'center',
          marginBottom: 8,
          gap: 12,
        },
        dot: {
          width: 12,
          height: 12,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: theme.colors.textSecondary,
        },
        dotFilled: {
          backgroundColor: theme.colors.text,
          borderColor: theme.colors.text,
        },
        dotError: {
          borderColor: theme.colors.error || '#C0392B',
          backgroundColor: theme.colors.error || '#C0392B',
        },
        hint: {
          minHeight: 20,
          marginBottom: 16,
          fontSize: theme.fontSizes?.sm || 13,
          fontFamily: theme.fontFamilies?.regular,
          color: error
            ? theme.colors.error || '#C0392B'
            : theme.colors.textSecondary,
          textAlign: 'center',
        },
        grid: {
          width: '100%',
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
        },
        key: {
          width: '30%',
          aspectRatio: 1.4,
          margin: '1.5%',
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.cardBackground,
        },
        keyEmpty: {
          backgroundColor: 'transparent',
        },
        keyText: {
          fontSize: theme.fontSizes?.xl || 22,
          fontFamily: theme.fontFamilies?.medium,
          color: theme.colors.text,
        },
      }),
    [theme, error],
  );

  const pressKey = (key: (typeof KEYS)[number]) => {
    if (disabled || !key) {
      return;
    }
    HapticFeedback.light();
    if (key === 'del') {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= CAMOUFLAGE_PIN_LENGTH) {
      return;
    }
    const next = `${value}${key}`;
    onChange(next);
    if (next.length === CAMOUFLAGE_PIN_LENGTH) {
      onComplete?.(next);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.dots} accessibilityLabel={`${value.length} of 4 digits`}>
        {Array.from({length: CAMOUFLAGE_PIN_LENGTH}, (_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < value.length && styles.dotFilled,
              error && styles.dotError,
            ]}
          />
        ))}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : <View style={styles.hint} />}
      <View style={styles.grid}>
        {KEYS.map((key, idx) => {
          if (!key) {
            return <View key={`empty-${idx}`} style={[styles.key, styles.keyEmpty]} />;
          }
          return (
            <AppPressable
              key={key === 'del' ? 'del' : key}
              style={styles.key}
              onPress={() => pressKey(key)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={key === 'del' ? 'Delete' : key}>
              <Text style={styles.keyText}>{key === 'del' ? '⌫' : key}</Text>
            </AppPressable>
          );
        })}
      </View>
    </View>
  );
};

export default CamouflagePinPad;
