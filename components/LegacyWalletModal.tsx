import React, {useState} from 'react';
import {Modal, View, Text, TouchableOpacity, Image} from 'react-native';
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
      marginBottom: 16,
      lineHeight: 22,
      textAlign: 'left' as const,
      fontSize: 15,
      color: theme.colors.text,
    } as const,
    legacyModalWarningText: {
      marginBottom: 16,
      lineHeight: 20,
      textAlign: 'left' as const,
      fontSize: 14,
      color: theme.colors.danger || '#ff6b6b',
      fontWeight: '600' as const,
    } as const,
    legacyModalNoteText: {
      marginBottom: 24,
      lineHeight: 18,
      fontSize: 13,
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
      color: theme.colors.background,
      fontSize: 13,
      fontWeight: 'bold' as const,
    } as const,
    legacyModalCheckboxLabel: {
      flex: 1,
      fontSize: 14,
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
    await LocalCache.setItem('legacyWalletModalDoNotRemind', doNotRemind ? 'yes' : 'no');
    onCancel();
  };

  const handleUnderstand = async () => {
    HapticFeedback.medium();
    // Save checkbox state: "yes" = do not remind, "no" = show again
    await LocalCache.setItem('legacyWalletModalDoNotRemind', doNotRemind ? 'yes' : 'no');
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
      animationType="fade">
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
              compatibility and interoperability with modern wallets, we recommend
              creating a new wallet setup and migrating your funds.
            </Text>

            <Text style={styles.legacyModalWarningText}>
              ⚠️ Important: Make sure you have a backup of your legacy wallet
              before creating a new wallet. Your current wallet will continue to
              work until you're ready to migrate.
            </Text>

            <Text style={styles.legacyModalNoteText}>
              To migrate: Create a new wallet setup and send all your funds to the
              new wallet address.
            </Text>

            <TouchableOpacity
              style={styles.legacyModalCheckboxContainer}
              onPress={handleCheckboxToggle}
              activeOpacity={0.7}>
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
            </TouchableOpacity>
          </View>

          <View style={styles.legacyModalButtonsContainer}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.legacyModalButtonSecondary,
              ]}
              onPress={handleCancel}>
              <Text
                style={[
                  styles.actionButtonText,
                  styles.legacyModalButtonTextSecondary,
                ]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.legacyModalButtonPrimary,
              ]}
              onPress={handleUnderstand}>
              <Text style={styles.actionButtonText}>
                I Understand
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default LegacyWalletModal;

