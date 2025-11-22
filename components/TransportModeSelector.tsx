import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image,
} from 'react-native';
import {useTheme} from '../theme';
import {HapticFeedback} from '../utils';

interface TransportModeSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (transport: 'local' | 'nostr') => void;
  title?: string;
  description?: string;
}

const TransportModeSelector: React.FC<TransportModeSelectorProps> = ({
  visible,
  onClose,
  onSelect,
  title = 'Select Transport Method',
  description = 'Choose how to connect with other devices',
}) => {
  const {theme} = useTheme();
  const [selectedTransport, setSelectedTransport] = useState<'local' | 'nostr' | null>(null);

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
      borderBottomColor: 'rgba(0,0,0,0.05)',
    },
    modalHeaderIconImage: {
      width: 24,
      height: 24,
      tintColor: theme.colors.primary,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
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
      fontSize: 20,
      color: theme.colors.text,
      fontWeight: '600',
    },
    modalBody: {
      paddingHorizontal: 24,
      paddingVertical: 20,
    },
    modalDescription: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginBottom: 16,
      textAlign: 'left',
      fontWeight: '500',
    },
    transportOptionsContainer: {
      flexDirection: 'row',
      gap: 12,
      width: '100%',
    },
    transportOptionCard: {
      borderRadius: 12,
      paddingTop: 16,
      paddingBottom: 12,
      paddingHorizontal: 12,
      borderWidth: 1.5,
      borderColor: theme.colors.border + '40',
      backgroundColor: theme.colors.white,
      position: 'relative',
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    transportOptionCardSelected: {
      backgroundColor: theme.colors.subPrimary + '10',
      borderWidth: 1.5,
      borderColor: theme.colors.subPrimary,
    },
    transportOptionContent: {
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      backgroundColor: 'transparent',
    },
    transportOptionIconWrapper: {
      marginBottom: 8,
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
      width: 64,
      height: 64,
      backgroundColor: 'transparent',
      opacity: 1,
    },
    transportOptionIconSelected: {
      tintColor: theme.colors.primary,
    },
    transportOptionIconNostrSelected: {
      width: 64,
      height: 64,
      opacity: 1,
      backgroundColor: 'transparent',
    },
    transportOptionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 2,
    },
    transportOptionTitleSelected: {
      color: theme.colors.primary,
    },
    transportOptionDescription: {
      fontSize: 11,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      lineHeight: 14,
    },
    transportOptionDescriptionSelected: {
      color: theme.colors.textSecondary,
    },
    transportSelectedHint: {
      marginTop: 14,
      backgroundColor: theme.colors.white,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
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
      tintColor: theme.colors.primary,
      marginTop: 2,
    },
    transportSelectedHintText: {
      color: theme.colors.primary,
      fontSize: 14,
      textAlign: 'left',
      flex: 1,
      flexWrap: 'wrap',
      lineHeight: 20,
    },
    transportSelectedHintTextBold: {
      fontWeight: '700',
    },
    continueButton: {
      marginTop: 16,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor: theme.colors.primary,
    },
    continueButtonDisabled: {
      opacity: 0.5,
    },
    continueButtonText: {
      color: theme.colors.background,
      fontSize: 16,
      fontWeight: '600',
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
          <View style={styles.modalBody}>
            {description && (
              <Text style={styles.modalDescription}>{description}</Text>
            )}

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
            {selectedTransport && (
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
              <Text style={styles.continueButtonText}>
                Continue →
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default TransportModeSelector;

