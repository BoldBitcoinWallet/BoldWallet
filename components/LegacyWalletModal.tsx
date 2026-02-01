import React, {useState} from 'react';
import {Modal, View, Text, Pressable, Image} from 'react-native';
import {HapticFeedback} from '../utils';
import {useTheme} from '../theme';
import {createStyles} from './Styles';
import LocalCache from '../services/LocalCache';
interface LegacyWalletModalProps {
  visible: boolean;
  onCancel: () => void;
  onUnderstand: () => void;
}
const LegacyWalletModal: React.FC<LegacyWalletModalProps> = ({
  visible,
  onCancel,
  onUnderstand,
}) => {
  const [doNotRemind, setDoNotRemind] = useState(false);
  const {theme} = useTheme();
  const styles = {
    ...createStyles(theme),
    // Legacy wallet modal styles
    legacyModalContent: {
      paddingHorizontal: 24,
      paddingVertical: 16,
    } as const,
    legacyModalText: {
      fontSize: theme.fontSizes?.md || 15,
      marginBottom: 16,
      lineHeight: 22,
      textAlign: 'left' as const,
      color: theme.colors.text,
    } as const,
    legacyModalWarningText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      marginBottom: 16,
      lineHeight: 20,
      textAlign: 'left' as const,
      color: theme.colors.danger,
    } as const,
    legacyModalNoteText: {
      fontSize: theme.fontSizes?.base || 13,
      marginBottom: 24,
      lineHeight: 18,
      color: theme.colors.textSecondary,
      fontStyle: 'italic' as const,
    } as const,
    legacyModalCheckboxContainer: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      marginBottom: 24,
      paddingHorizontal: 4,
      paddingVertical: 8,
    } as const,
    legacyModalCheckbox: {
      width: 22,
      height: 22,
      borderWidth: 2,
      borderColor: theme.colors.border,
      borderRadius: 5,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      marginRight: 12,
      backgroundColor: 'transparent',
    } as const,
    legacyModalCheckboxChecked: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    } as const,
    legacyModalCheckmark: {
      fontSize: theme.fontSizes?.base || 13,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.background,
    } as const,
    legacyModalCheckboxLabel: {
      fontSize: theme.fontSizes?.base || 14,
      flex: 1,
      lineHeight: 20,
      color: theme.colors.text,
    } as const,
    legacyModalButtonsContainer: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      paddingHorizontal: 20,
      paddingBottom: 20,
      gap: 12,
    } as const,
    legacyModalButtonSecondary: {
      flex: 1,
      backgroundColor: theme.colors.cardBackground,
      borderWidth: 1,
      borderColor: theme.colors.border,
    } as const,
    legacyModalButtonPrimary: {
      flex: 1,
      backgroundColor: theme.colors.primary,
    } as const,
    legacyModalButtonTextSecondary: {
      color: theme.colors.text,
    } as const,
  };
  const handleCancel = async () => {
    HapticFeedback.light();
    // Save checkbox state: "yes" = do not remind, "no" = show again
    await LocalCache.setItem(
      'legacyWalletModalDoNotRemind',
      doNotRemind ? 'yes' : 'no',
    );
    onCancel();
  };
  const handleUnderstand = async () => {
    HapticFeedback.medium();
    // Save checkbox state: "yes" = do not remind, "no" = show again
    await LocalCache.setItem(
      'legacyWalletModalDoNotRemind',
      doNotRemind ? 'yes' : 'no',
    );
    onUnderstand();
  };
  const handleCheckboxToggle = () => {
    HapticFeedback.light();
    setDoNotRemind(prev => !prev);
  };
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeaderRow}>
            <Image
              source={require('../assets/warning-icon.png')}
              style={styles.modalHeaderIcon}
            />
            <Text style={styles.modalHeaderTitle}>Legacy Wallet Detected</Text>
          </View>
          <View style={styles.legacyModalContent}>
            <Text style={styles.legacyModalText}>
              You're currently using a legacy wallet setup. For better PSBT
              compatibility and interoperability with modern wallets, we
              recommend creating a new wallet setup and migrating your funds.
            </Text>
            <Text style={styles.legacyModalWarningText}>
              ⚠️ Important: Make sure you have a backup of your legacy wallet
              before creating a new wallet. Your current wallet will continue to
              work until you're ready to migrate.
            </Text>
            <Text style={styles.legacyModalNoteText}>
              To migrate: Create a new wallet setup and send all your funds to
              the new wallet address.
            </Text>
            <Pressable
              style={styles.legacyModalCheckboxContainer}
              onPress={handleCheckboxToggle}
              android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
              <View
                style={[
                  styles.legacyModalCheckbox,
                  doNotRemind && styles.legacyModalCheckboxChecked,
                ]}>
                {doNotRemind && (
                  <Text style={styles.legacyModalCheckmark}>✓</Text>
                )}
              </View>
              <Text style={styles.legacyModalCheckboxLabel}>
                Do not remind me again
              </Text>
            </Pressable>
          </View>
          <View style={styles.legacyModalButtonsContainer}>
            <Pressable
              style={[styles.actionButton, styles.legacyModalButtonSecondary]}
              onPress={handleCancel}
              android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
              <Text
                style={[
                  styles.actionButtonText,
                  styles.legacyModalButtonTextSecondary,
                ]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.legacyModalButtonPrimary]}
              onPress={handleUnderstand}
              android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
              <Text style={styles.actionButtonText}>I Understand</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};
export default LegacyWalletModal;
