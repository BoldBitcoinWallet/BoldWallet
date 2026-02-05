import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Image,
  ScrollView,
} from 'react-native';
import AppPressable from './AppPressable';
import StaticQRCode from './StaticQRCode';
import {useTheme} from '../theme';
import {encodeSendBitcoinQR} from '../utils';
interface TransportModeSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (transport: 'local' | 'nostr') => void;
  title?: string;
  description?: string;
  // Optional: Show QR code for send bitcoin data (only on device 1, not when scanned)
  sendBitcoinData?: {
    toAddress: string;
    amountSats: string;
    feeSats: string;
    spendingHash?: string;
    addressType?: string;
    derivationPath?: string;
    network?: string;
    fromAddress?: string; // From address for display
    fiatAmount?: string; // Fiat amount for display
    fiatFees?: string; // Fiat fees for display
    selectedCurrency?: string; // Currency symbol for display
  } | null;
  showQRCode?: boolean; // Whether to show QR code (false when data came from scan)
}
const TransportModeSelector: React.FC<TransportModeSelectorProps> = ({
  visible,
  onClose,
  onSelect,
  title = 'Transport Method',
  description = 'Choose how to connect with other devices',
  sendBitcoinData = null,
  showQRCode = true,
}) => {
  const {theme} = useTheme();
  const [selectedTransport, setSelectedTransport] = useState<
    'local' | 'nostr' | null
  >(null);
  const handleSelect = (transport: 'local' | 'nostr') => {
    setSelectedTransport(transport);
  };
  const handleContinue = () => {
    if (selectedTransport) {
      onSelect(selectedTransport);
      onClose();
      setSelectedTransport(null);
    }
  };
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
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 10},
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 10,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay20, // Dark mode: subtle light border
    },
    modalHeaderIconImage: {
      width: 24,
      height: 24,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    modalTitle: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      marginLeft: 12,
      color: theme.colors.text,
      flex: 1,
    },
    closeButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 12,
      backgroundColor: theme.colors.subPrimary + '10',
      borderRadius: 32,
      borderWidth: 1,
      paddingTop: 2,
      borderColor: theme.colors.border + '10',
    },
    closeButtonText: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
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
      marginBottom: 12,
      textAlign: 'left',
    },
    transportOptionsContainer: {
      flexDirection: 'row',
      gap: 12,
      width: '100%',
    },
    transportOptionCard: {
      borderRadius: 12,
      paddingTop: 12,
      paddingBottom: 10,
      paddingHorizontal: 10,
      borderWidth: 1.5,
      borderColor: theme.colors.border + '40',
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.cardBackground,
      position: 'relative',
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    transportOptionCardSelected: {
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.subPrimary + '10'
          : theme.colors.bitcoinOrange + '20',
      borderWidth: 1.5,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.subPrimary
          : theme.colors.bitcoinOrange,
    },
    transportOptionContent: {
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      backgroundColor: 'transparent',
    },
    transportOptionIconWrapper: {
      marginBottom: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    nostrIconContainer: {
      backgroundColor: 'transparent',
      overflow: 'visible',
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    transportOptionIcon: {
      width: 32,
      height: 32,
      tintColor: theme.colors.primary,
    },
    transportOptionIconNostr: {
      width: 40,
      height: 40,
      backgroundColor: 'transparent',
      opacity: 1,
      tintColor: theme.colors.primary,
    },
    transportOptionIconSelected: {
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    transportOptionIconNostrSelected: {
      width: 64,
      height: 64,
      opacity: 1,
      backgroundColor: 'transparent',
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    transportOptionTitle: {
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 2,
    },
    transportOptionTitleSelected: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    transportOptionDescription: {
      fontSize: theme.fontSizes?.sm || 11,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      lineHeight: 14,
    },
    transportOptionDescriptionSelected: {
      color: theme.colors.textSecondary,
    },
    transportSelectedHint: {
      marginTop: 12,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.cardBackground,
      padding: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      opacity: 0.5,
    },
    transportSelectedHintRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      width: '100%',
    },
    transportSelectedHintIcon: {
      width: 20,
      height: 20,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.text,
      marginTop: 2,
    },
    transportSelectedHintText: {
      fontSize: theme.fontSizes?.base || 14,
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.text,
      textAlign: 'left',
      flex: 1,
      flexWrap: 'wrap',
      lineHeight: 20,
    },
    transportSelectedHintTextBold: {
      fontFamily: theme.fontFamilies?.bold,
    },
    continueButton: {
      marginTop: 12,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.bitcoinOrange,
    },
    continueButtonDisabled: {
      opacity: 0.5,
    },
    continueButtonText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white,
    },
    qrCodeSection: {
      marginBottom: 12,
      padding: 16,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.white
          : theme.colors.cardBackground,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
      borderStyle: 'dashed',
      alignItems: 'center',
    },
    qrCodeLabel: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.textSecondary,
      marginBottom: 10,
      textAlign: 'center',
      paddingHorizontal: 8,
    },
    qrCodeContainer: {
      backgroundColor: 'white',
      padding: 8,
      borderRadius: 8,
    },
    noPadding: {
      padding: 0,
    },
  });
  return (
    <Modal
      transparent={true}
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <Image
              source={require('../assets/network-icon.png')}
              style={styles.modalHeaderIconImage}
            />
            <Text style={styles.modalTitle}>{title}</Text>
            <AppPressable
              style={styles.closeButton}
              onPress={() => {
                setSelectedTransport(null);
                onClose();
              }}
              android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
              <Text style={styles.closeButtonText}>✕</Text>
            </AppPressable>
          </View>
          {/* Modal Body */}
          <ScrollView
            style={styles.modalBody}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            overScrollMode="never"
            showsVerticalScrollIndicator={false}>
            {description && description.length > 0 && (
              <Text style={styles.modalDescription}>{description}</Text>
            )}
            {/* QR Code Section - Only show if sendBitcoinData exists and showQRCode is true */}
            {sendBitcoinData &&
              showQRCode &&
              (() => {
                const qrData = encodeSendBitcoinQR(
                  sendBitcoinData.toAddress,
                  sendBitcoinData.amountSats,
                  sendBitcoinData.feeSats,
                  sendBitcoinData.spendingHash || '',
                  sendBitcoinData.addressType || '',
                  sendBitcoinData.derivationPath || '',
                  sendBitcoinData.network || '',
                );
                return (
                  <View style={styles.qrCodeSection}>
                    <Text style={styles.qrCodeLabel}>
                      Scan on another device to auto fill
                    </Text>
                    <StaticQRCode
                      value={qrData}
                      size={180}
                      copyContent={qrData}
                      toastMessage="Send data copied to clipboard"
                      style={[styles.qrCodeContainer, styles.noPadding]}
                    />
                  </View>
                );
              })()}
            <View style={styles.transportOptionsContainer}>
              {/* Local WiFi/Hotspot Option */}
              <AppPressable
                style={[
                  styles.transportOptionCard,
                  selectedTransport === 'local' &&
                    styles.transportOptionCardSelected,
                ]}
                onPress={() => handleSelect('local')}
                android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                <View style={styles.transportOptionContent}>
                  <View style={styles.transportOptionIconWrapper}>
                    <Image
                      source={require('../assets/wifi-icon.png')}
                      style={[
                        styles.transportOptionIcon,
                        selectedTransport === 'local' &&
                          styles.transportOptionIconSelected,
                      ]}
                      resizeMode="contain"
                    />
                  </View>
                  <Text
                    style={[
                      styles.transportOptionTitle,
                      selectedTransport === 'local' &&
                        styles.transportOptionTitleSelected,
                    ]}>
                    Local WiFi/Hotspot
                  </Text>
                  <Text
                    style={[
                      styles.transportOptionDescription,
                      selectedTransport === 'local' &&
                        styles.transportOptionDescriptionSelected,
                    ]}>
                    Connect devices on the same network
                  </Text>
                </View>
              </AppPressable>
              {/* Nostr Option */}
              <AppPressable
                style={[
                  styles.transportOptionCard,
                  selectedTransport === 'nostr' &&
                    styles.transportOptionCardSelected,
                ]}
                onPress={() => handleSelect('nostr')}
                android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                <View style={styles.transportOptionContent}>
                  <View style={styles.transportOptionIconWrapper}>
                    <View style={styles.nostrIconContainer}>
                      <Image
                        source={require('../assets/nostr-icon.png')}
                        style={[
                          styles.transportOptionIconNostr,
                          selectedTransport === 'nostr' &&
                            styles.transportOptionIconNostrSelected,
                        ]}
                        resizeMode="contain"
                        defaultSource={undefined}
                      />
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.transportOptionTitle,
                      selectedTransport === 'nostr' &&
                        styles.transportOptionTitleSelected,
                    ]}>
                    Nostr
                  </Text>
                  <Text
                    style={[
                      styles.transportOptionDescription,
                      selectedTransport === 'nostr' &&
                        styles.transportOptionDescriptionSelected,
                    ]}>
                    Connect via decentralized relays
                  </Text>
                </View>
              </AppPressable>
            </View>
            {/* Selected Transport Hint */}
            {selectedTransport && description && description.length > 0 && (
              <View style={styles.transportSelectedHint}>
                <View style={styles.transportSelectedHintRow}>
                  <Image
                    source={require('../assets/bulb-icon.png')}
                    style={styles.transportSelectedHintIcon}
                    resizeMode="contain"
                  />
                  {selectedTransport === 'local' ? (
                    <Text style={styles.transportSelectedHintText}>
                      <Text style={styles.transportSelectedHintTextBold}>
                        Local WiFi/Hotspot
                      </Text>
                      : devices must be on the same local network or one device
                      can create a hotspot for others to connect. Fast and
                      reliable for nearby devices.
                    </Text>
                  ) : (
                    <Text style={styles.transportSelectedHintText}>
                      <Text style={styles.transportSelectedHintTextBold}>
                        Nostr
                      </Text>
                      : connect devices through decentralized Nostr relays.
                      Works from anywhere, no local network required. Ideal for
                      remote or distributed setups.
                    </Text>
                  )}
                </View>
              </View>
            )}
            {/* Continue Button */}
            <AppPressable
              style={[
                styles.continueButton,
                !selectedTransport && styles.continueButtonDisabled,
              ]}
              onPress={handleContinue}
              disabled={!selectedTransport}
              android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
              <Text style={styles.continueButtonText}>Continue →</Text>
            </AppPressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
export default TransportModeSelector;
