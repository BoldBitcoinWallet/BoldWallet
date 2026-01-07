import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image,
  ScrollView,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {useTheme} from '../theme';
import {HapticFeedback, encodeSendBitcoinQR} from '../utils';

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
    HapticFeedback.medium();
    setSelectedTransport(transport);
  };

  const handleContinue = () => {
    if (selectedTransport) {
      HapticFeedback.medium();
      onSelect(selectedTransport);
      onClose();
      setSelectedTransport(null);
    }
  };

  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.75)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalContent: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 16,
      width: '85%',
      maxWidth: 420,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 10},
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 10,
      overflow: 'hidden',
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
          ? 'rgba(0,0,0,0.05)'
          : theme.colors.border + '40',
    },
    modalHeaderIconImage: {
      width: 24,
      height: 24,
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    modalTitle: {
      fontSize: theme.fontSizes?.xl || 18,
      fontWeight: (theme.fontWeights?.bold || '700') as any,
      fontFamily: theme.fontFamilies?.regular,
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
      fontWeight: (theme.fontWeights?.semibold || '600') as any,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
    },
    modalBody: {
      paddingHorizontal: 24,
      paddingVertical: 20,
    },
    modalDescription: {
      fontSize: theme.fontSizes?.base || 13,
      fontWeight: (theme.fontWeights?.medium || '500') as any,
      fontFamily: theme.fontFamilies?.regular,
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
          : theme.colors.accent + '20',
      borderWidth: 1.5,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.subPrimary
          : theme.colors.accent,
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
          : theme.colors.accent,
    },
    transportOptionIconNostrSelected: {
      width: 64,
      height: 64,
      opacity: 1,
      backgroundColor: 'transparent',
      tintColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    transportOptionTitle: {
      fontSize: theme.fontSizes?.md || 15,
      fontWeight: (theme.fontWeights?.bold || '700') as any,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 2,
    },
    transportOptionTitleSelected: {
      color:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    transportOptionDescription: {
      fontSize: theme.fontSizes?.sm || 11,
      fontWeight: (theme.fontWeights?.normal || '400') as any,
      fontFamily: theme.fontFamilies?.regular,
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
      fontWeight: (theme.fontWeights?.normal || '400') as any,
      fontFamily: theme.fontFamilies?.regular,
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
      fontWeight: (theme.fontWeights?.bold || '700') as any,
    },
    continueButton: {
      marginTop: 12,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary
          : theme.colors.accent,
    },
    continueButtonDisabled: {
      opacity: 0.5,
    },
    continueButtonText: {
      fontSize: theme.fontSizes?.lg || 16,
      fontWeight: (theme.fontWeights?.semibold || '600') as any,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.white,
    },
    qrCodeSection: {
      marginTop: 12,
      marginBottom: 24,
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
      fontSize: theme.fontSizes?.base || 13,
      fontWeight: (theme.fontWeights?.semibold || '600') as any,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
      marginBottom: 12,
      textAlign: 'center',
      lineHeight: 18,
    },
    qrCodeSubLabel: {
      fontSize: theme.fontSizes?.sm || 11,
      fontWeight: (theme.fontWeights?.normal || '400') as any,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      marginBottom: 8,
      textAlign: 'center',
      lineHeight: 15,
    },
    qrCodeContainer: {
      backgroundColor: 'white',
      padding: 12,
      borderRadius: 8,
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
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => {
                HapticFeedback.medium();
                setSelectedTransport(null);
                onClose();
              }}
              activeOpacity={0.7}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Modal Body */}
          <ScrollView
            style={styles.modalBody}
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
                      Quick Shortcut for Other Devices
                    </Text>
                    <Text style={styles.qrCodeSubLabel}>
                      Scan this QR code on other devices to{'\n'}automatically
                      enter address and amount
                    </Text>
                    <View style={styles.qrCodeContainer}>
                      <QRCode
                        value={qrData}
                        size={180}
                        backgroundColor="white"
                        color="black"
                      />
                    </View>
                  </View>
                );
              })()}

            <View style={styles.transportOptionsContainer}>
              {/* Local WiFi/Hotspot Option */}
              <TouchableOpacity
                style={[
                  styles.transportOptionCard,
                  selectedTransport === 'local' &&
                    styles.transportOptionCardSelected,
                ]}
                onPress={() => handleSelect('local')}
                activeOpacity={0.8}>
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
              </TouchableOpacity>

              {/* Nostr Option */}
              <TouchableOpacity
                style={[
                  styles.transportOptionCard,
                  selectedTransport === 'nostr' &&
                    styles.transportOptionCardSelected,
                ]}
                onPress={() => handleSelect('nostr')}
                activeOpacity={0.8}>
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
              </TouchableOpacity>
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
            <TouchableOpacity
              style={[
                styles.continueButton,
                !selectedTransport && styles.continueButtonDisabled,
              ]}
              onPress={handleContinue}
              disabled={!selectedTransport}
              activeOpacity={0.8}>
              <Text style={styles.continueButtonText}>Continue →</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default TransportModeSelector;
