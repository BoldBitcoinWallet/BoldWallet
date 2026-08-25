import React from 'react';
import {Modal, View, Image, StyleSheet} from 'react-native';
import AppPressable from './AppPressable';
import AppText from './AppText';
import GlassModalOverlay from './GlassModalOverlay';
import {useTheme} from '../theme';
import {createStyles} from './Styles';

export interface ExtensionPairingModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const ExtensionPairingModal: React.FC<ExtensionPairingModalProps> = ({
  visible,
  onClose,
  onConfirm,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);
  const localStyles = React.useMemo(
    () =>
      StyleSheet.create({
        bodyText: {
          lineHeight: 22,
          textAlign: 'center' as const,
          marginBottom: 12,
        },
        stepRow: {
          flexDirection: 'row' as const,
          alignItems: 'flex-start' as const,
          marginBottom: 10,
          paddingHorizontal: 4,
        },
        stepNumber: {
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: theme.colors.primary + '30',
          justifyContent: 'center' as const,
          alignItems: 'center' as const,
          marginRight: 10,
        },
        noteBox: {
          backgroundColor: theme.colors.cardBackground,
          borderRadius: 10,
          padding: 14,
          marginTop: 8,
          marginBottom: 4,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        contentInner: {
          width: '100%',
          maxWidth: 340,
        },
        contentWrapper: {
          width: '100%' as const,
          alignItems: 'center' as const,
        },
        stepText: {
          flex: 1,
          lineHeight: 20,
        },
        noteText: {
          textAlign: 'center' as const,
          lineHeight: 18,
        },
        actionsRowWithMargin: {
          marginTop: 20,
        },
        cancelButton: {
          paddingVertical: 12,
          paddingHorizontal: 20,
          borderRadius: 10,
          backgroundColor: theme.colors.cardBackground,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        confirmButton: {
          paddingVertical: 12,
          paddingHorizontal: 20,
          borderRadius: 10,
          backgroundColor: theme.colors.primary,
        },
      }),
    [theme],
  );

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}>
      <GlassModalOverlay onPress={onClose}>
        <View style={[styles.modalContent, localStyles.contentInner]}>
          <View style={localStyles.contentWrapper}>
            <View style={styles.modalHeaderRow}>
              <Image
                source={require('../assets/extension-icon.png')}
                style={styles.modalHeaderIcon}
                resizeMode="contain"
              />
              <AppText variant="h2" style={styles.modalHeaderTitle}>
                Pair with Bold Extension?
              </AppText>
            </View>
            <AppText variant="body" style={localStyles.bodyText}>
              You scanned a pairing code from the Bold Bitcoin Wallet browser
              extension.{'\n'}To complete binding:
            </AppText>
            <View style={localStyles.stepRow}>
              <View style={localStyles.stepNumber}>
                <AppText variant="caption" tone="primary">
                  1
                </AppText>
              </View>
              <AppText variant="body" style={localStyles.stepText}>
                Tap Confirm below — this app will show a QR code.
              </AppText>
            </View>
            <View style={localStyles.stepRow}>
              <View style={localStyles.stepNumber}>
                <AppText variant="caption" tone="primary">
                  2
                </AppText>
              </View>
              <AppText variant="body" style={localStyles.stepText}>
                Scan that QR with the extension to finish pairing.
              </AppText>
            </View>
            <View style={localStyles.noteBox}>
              <AppText
                variant="caption"
                tone="muted"
                style={localStyles.noteText}>
                Only proceed if you started this pairing from your extension.
              </AppText>
            </View>
            <View style={[styles.modalActionsRow, localStyles.actionsRowWithMargin]}>
              <View style={styles.modalActionLeft}>
                <AppPressable
                  onPress={onClose}
                  style={localStyles.cancelButton}
                  android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
                  <AppText variant="button">Cancel</AppText>
                </AppPressable>
              </View>
              <View style={styles.modalActionRight}>
                <AppPressable
                  onPress={onConfirm}
                  style={localStyles.confirmButton}
                  android_ripple={{color: 'rgba(255,255,255,0.2)'}}>
                  <AppText variant="button" tone="onPrimary">
                    Confirm
                  </AppText>
                </AppPressable>
              </View>
            </View>
          </View>
        </View>
      </GlassModalOverlay>
    </Modal>
  );
};

export default ExtensionPairingModal;
