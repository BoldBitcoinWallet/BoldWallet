import React, {useEffect, useState} from 'react';
import {View, Text, StyleSheet, Modal, Image} from 'react-native';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';
import type {TssBackend} from '../services/tssBackend';
import {getTssBackendDisplayLabel} from '../services/tssBackend';
import {getKeygenTssBackendPreference} from '../services/tssConfig';

interface TssBackendSelectorProps {
  visible: boolean;
  onClose: () => void;
  onContinue: (backend: TssBackend) => void;
}

const TssBackendSelector: React.FC<TssBackendSelectorProps> = ({
  visible,
  onClose,
  onContinue,
}) => {
  const {theme} = useTheme();
  const [selected, setSelected] = useState<TssBackend | null>(null);

  useEffect(() => {
    if (visible) {
      setSelected(getKeygenTssBackendPreference());
    }
  }, [visible]);

  const accent =
    theme.colors.background === '#ffffff'
      ? theme.colors.primary
      : theme.colors.bitcoinOrange;

  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.colors.modalBackdrop,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      width: '85%',
      maxWidth: 420,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
      overflow: 'hidden',
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    modalHeaderIcon: {
      width: 24,
      height: 24,
      tintColor: accent,
    },
    modalTitle: {
      flex: 1,
      marginLeft: 12,
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    closeButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.colors.border + '20',
    },
    closeButtonText: {
      fontSize: 20,
      color: theme.colors.text,
    },
    modalBody: {
      paddingHorizontal: 24,
      paddingVertical: 20,
    },
    modalDescription: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      marginBottom: 14,
      lineHeight: 20,
    },
    optionsRow: {
      flexDirection: 'row',
      gap: 12,
    },
    optionCard: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 10,
      borderWidth: 1.5,
      borderColor: theme.colors.border + '40',
      alignItems: 'center',
    },
    optionCardSelected: {
      borderColor: accent,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.subPrimary + '10'
          : theme.colors.bitcoinOrange + '20',
    },
    optionTitle: {
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      marginTop: 8,
      textAlign: 'center',
    },
    optionTitleSelected: {
      color: accent,
    },
    optionSubtitle: {
      fontSize: theme.fontSizes?.sm || 11,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginTop: 4,
      lineHeight: 15,
    },
    recommendedBadge: {
      marginTop: 6,
      fontSize: 10,
      fontFamily: theme.fontFamilies?.bold,
      color: accent,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    hintBox: {
      marginTop: 14,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.cardBackground,
    },
    hintRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    hintIcon: {
      width: 20,
      height: 20,
      tintColor: accent,
      marginTop: 2,
    },
    hintText: {
      flex: 1,
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
      lineHeight: 18,
    },
    hintTextBold: {
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    continueButton: {
      marginTop: 16,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor: accent,
    },
    continueButtonDisabled: {
      opacity: 0.5,
    },
    continueButtonText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white,
    },
  });

  const hintFor = (backend: TssBackend | null) => {
    if (backend === 'gg18') {
      return (
        <>
          <Text style={styles.hintText}>
            <Text style={styles.hintTextBold}>GG18 (legacy): </Text>
            Compatible with older Bold wallets. Prepare can take several
            minutes. All devices in this setup must choose GG18.
          </Text>
        </>
      );
    }
    if (backend === 'dkls23') {
      return (
        <>
          <Text style={styles.hintText}>
            <Text style={styles.hintTextBold}>DKLs23 (recommended): </Text>
            Faster prepare and keygen. All devices in this setup must choose
            DKLs23 and use a build with DKLs native support.
          </Text>
        </>
      );
    }
    return (
      <Text style={styles.hintText}>
        Select the MPC stack every device will use for this new wallet.
      </Text>
    );
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Image
              source={require('../assets/security-icon.png')}
              style={styles.modalHeaderIcon}
              resizeMode="contain"
            />
            <Text style={styles.modalTitle}>MPC Signing Stack</Text>
            <AppPressable
              style={styles.closeButton}
              onPress={onClose}
              accessibilityLabel="Close"
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Text style={styles.closeButtonText}>✕</Text>
            </AppPressable>
          </View>
          <View style={styles.modalBody}>
            <Text style={styles.modalDescription}>
              Choose how this wallet will be created. Existing restored wallets
              keep their original stack automatically.
            </Text>
            <View style={styles.optionsRow}>
              <AppPressable
                style={[
                  styles.optionCard,
                  selected === 'dkls23' && styles.optionCardSelected,
                ]}
                onPress={() => setSelected('dkls23')}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Image
                  source={require('../assets/bitcoin-logo.png')}
                  style={{width: 28, height: 28}}
                  resizeMode="contain"
                />
                <Text
                  style={[
                    styles.optionTitle,
                    selected === 'dkls23' && styles.optionTitleSelected,
                  ]}>
                  DKLs23
                </Text>
                <Text style={styles.optionSubtitle}>Faster · default</Text>
                <Text style={styles.recommendedBadge}>Recommended</Text>
              </AppPressable>
              <AppPressable
                style={[
                  styles.optionCard,
                  selected === 'gg18' && styles.optionCardSelected,
                ]}
                onPress={() => setSelected('gg18')}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                <Image
                  source={require('../assets/security-icon.png')}
                  style={[styles.modalHeaderIcon, {width: 28, height: 28}]}
                  resizeMode="contain"
                />
                <Text
                  style={[
                    styles.optionTitle,
                    selected === 'gg18' && styles.optionTitleSelected,
                  ]}>
                  GG18
                </Text>
                <Text style={styles.optionSubtitle}>Legacy compatibility</Text>
              </AppPressable>
            </View>
            <View style={styles.hintBox}>
              <View style={styles.hintRow}>
                <Image
                  source={require('../assets/bulb-icon.png')}
                  style={styles.hintIcon}
                  resizeMode="contain"
                />
                {hintFor(selected)}
              </View>
            </View>
            <AppPressable
              style={[
                styles.continueButton,
                !selected && styles.continueButtonDisabled,
              ]}
              disabled={!selected}
              onPress={() => {
                if (selected) {
                  onContinue(selected);
                }
              }}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Text style={styles.continueButtonText}>Continue</Text>
            </AppPressable>
            {selected ? (
              <Text
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: theme.colors.textSecondary,
                  textAlign: 'center',
                }}>
                {getTssBackendDisplayLabel(selected)}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default TssBackendSelector;
