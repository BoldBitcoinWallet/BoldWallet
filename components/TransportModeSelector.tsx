import React, {useEffect, useMemo, useState, Component, type ErrorInfo, type ReactNode} from 'react';
import {View, Text, StyleSheet, Modal, Image, ScrollView} from 'react-native';
import AppPressable from './AppPressable';
import StaticQRCode from './StaticQRCode';
import QRCode from 'react-native-qrcode-svg';
import {useTheme} from '../theme';
import {encodeSendBitcoinQR} from '../utils';
import {dbg} from '../utils';
import {urFragmentCount, urPartAt, utf8ToUr} from '../utils/urBytesQr';

/** Static QR stays under this; larger send payloads use animated UR frames. */
const MAX_STATIC_QR_CHARS = 1800;

class QrRenderBoundary extends Component<
  {children: ReactNode; fallback: ReactNode},
  {hasError: boolean}
> {
  state = {hasError: false};
  static getDerivedStateFromError() {
    return {hasError: true};
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    dbg('TransportModeSelector: QR render failed', error.message, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

type SendQrDisplay =
  | {mode: 'static'; qrData: string}
  | {mode: 'animated'; pipePayload: string}
  | null;

function buildSendQrPayload(
  data: NonNullable<TransportModeSelectorProps['sendBitcoinData']>,
): SendQrDisplay {
  try {
    const full = encodeSendBitcoinQR(
      data.toAddress,
      data.amountSats,
      data.feeSats,
      data.spendingHash || '',
      data.addressType || '',
      data.derivationPath || '',
      data.network || '',
      data.utxosJson || '',
      data.changeAddress || '',
    );
    if (full.length <= MAX_STATIC_QR_CHARS) {
      return {mode: 'static', qrData: full};
    }
    if (utf8ToUr(full)) {
      return {mode: 'animated', pipePayload: full};
    }
    dbg('TransportModeSelector: UR encode failed for large send QR');
    return null;
  } catch (err) {
    dbg('TransportModeSelector: encodeSendBitcoinQR failed', err);
    return null;
  }
}

function AnimatedSendQr({
  pipePayload,
  size,
  frameLabelStyle,
  hintStyle,
  containerStyle,
}: {
  pipePayload: string;
  size: number;
  frameLabelStyle: object;
  hintStyle: object;
  containerStyle: object | object[];
}) {
  const ur = useMemo(() => utf8ToUr(pipePayload), [pipePayload]);
  const totalParts = useMemo(() => (ur ? urFragmentCount(ur) : 1), [ur]);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!ur || totalParts <= 1) {
      setFrameIndex(0);
      return;
    }
    setFrameIndex(0);
    const interval = setInterval(() => {
      setFrameIndex(prev => (prev + 1) % totalParts);
    }, 500);
    return () => clearInterval(interval);
  }, [ur, totalParts]);

  const qrData = ur ? urPartAt(ur, frameIndex) : null;
  if (!qrData) {
    return (
      <Text style={hintStyle}>
        Could not render animated QR. Continue with Local or Nostr.
      </Text>
    );
  }
  return (
    <>
      <View style={containerStyle}>
        <QRCode
          value={qrData}
          size={size}
          color="black"
          backgroundColor="white"
          ecl="L"
          onError={error => {
            dbg('TransportModeSelector: animated QR encode failed', error);
          }}
        />
      </View>
      <Text style={frameLabelStyle}>
        Frame {frameIndex + 1} of {totalParts}
      </Text>
      <Text style={hintStyle}>
        Large UTXO set — keep scanning until the other device finishes.
      </Text>
    </>
  );
}
interface TransportModeSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (transport: 'local' | 'nostr') => void;
  nostrEnabled?: boolean;
  defaultTransport?: 'local' | 'nostr' | null;
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
    utxosJson?: string | null; // Optional JSON of utxosWithPaths (when multi-path UTXOs were used)
    utxoCount?: number; // Optional count of UTXOs in utxosJson
    changeAddress?: string | null; // Pre-computed change address (ensures both devices use the same output)
  } | null;
  showQRCode?: boolean; // Whether to show QR code (false when data came from scan)
}
const TransportModeSelector: React.FC<TransportModeSelectorProps> = ({
  visible,
  onClose,
  onSelect,
  nostrEnabled = true,
  defaultTransport = null,
  title = 'Transport Method',
  description = 'Choose how to connect with other devices',
  sendBitcoinData = null,
  showQRCode = true,
}) => {
  const {theme} = useTheme();
  const initialTransport = useMemo<'local' | 'nostr' | null>(() => {
    if (!nostrEnabled) {
      return 'local';
    }
    return defaultTransport;
  }, [defaultTransport, nostrEnabled]);
  const [selectedTransport, setSelectedTransport] = useState<
    'local' | 'nostr' | null
  >(initialTransport);

  useEffect(() => {
    if (visible) {
      setSelectedTransport(initialTransport);
    }
  }, [initialTransport, visible]);

  const handleSelect = (transport: 'local' | 'nostr') => {
    if (transport === 'nostr' && !nostrEnabled) {
      return;
    }
    setSelectedTransport(transport);
  };
  const handleContinue = () => {
    if (selectedTransport) {
      onSelect(selectedTransport);
      onClose();
      setSelectedTransport(initialTransport);
    }
  };
  const qrPayload = useMemo(() => {
    if (!visible || !sendBitcoinData || !showQRCode) {
      return null;
    }
    return buildSendQrPayload(sendBitcoinData);
  }, [visible, sendBitcoinData, showQRCode]);
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
    transportOptionCardDisabled: {
      opacity: 0.45,
      borderColor: theme.colors.border + '70',
    },
    transportDisabledText: {
      marginTop: 8,
      marginBottom: 8,
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
      textAlign: 'left',
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
    transportSelectedHintRowWithMargin: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      width: '100%',
      marginTop: 8,
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
      paddingTop: 6,
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
      textAlign: 'center',
    },
    qrCodeContainer: {
      backgroundColor: 'white',
      padding: 8,
      borderRadius: 8,
    },
    noPadding: {
      padding: 0,
    },
    qrFrameLabel: {
      marginTop: 8,
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
      textAlign: 'center',
    },
    qrAnimatedHint: {
      marginTop: 4,
      marginBottom: 8,
      paddingHorizontal: 12,
      fontSize: theme.fontSizes?.sm || 12,
      color: theme.colors.textSecondary,
      textAlign: 'center',
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
              source={require('../assets/cosign-icon.png')}
              style={styles.modalHeaderIconImage}
            />
            <Text style={styles.modalTitle}>{title}</Text>
            <AppPressable
              style={styles.closeButton}
              onPress={() => {
                setSelectedTransport(initialTransport);
                onClose();
              }}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
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
            {!nostrEnabled && (
              <Text style={styles.transportDisabledText}>
                Nostr is not available for this wallet keyshare.
              </Text>
            )}
            {/* QR Code Section - Only encode while the modal is visible. */}
            {visible && sendBitcoinData && showQRCode ? (
              !qrPayload ? (
                <Text style={styles.transportDisabledText}>
                  QR is too large to display. Continue with Local or Nostr
                  on this device.
                </Text>
              ) : (
                <View style={styles.qrCodeSection}>
                  <Text style={styles.qrCodeLabel}>
                    Scan on another device to auto fill
                  </Text>
                  <QrRenderBoundary
                    key={
                      qrPayload.mode === 'static'
                        ? qrPayload.qrData
                        : `animated:${qrPayload.pipePayload.length}`
                    }
                    fallback={
                      <Text style={styles.transportDisabledText}>
                        Could not render QR. Continue with Local or Nostr.
                      </Text>
                    }>
                    {qrPayload.mode === 'animated' ? (
                      <AnimatedSendQr
                        pipePayload={qrPayload.pipePayload}
                        size={260}
                        frameLabelStyle={styles.qrFrameLabel}
                        hintStyle={styles.qrAnimatedHint}
                        containerStyle={[
                          styles.qrCodeContainer,
                          styles.noPadding,
                        ]}
                      />
                    ) : (
                      <StaticQRCode
                        value={qrPayload.qrData}
                        size={260}
                        copyContent={qrPayload.qrData}
                        toastMessage="Send data copied to clipboard"
                        copyDisabled={true}
                        showLogo={qrPayload.qrData.length < 1200}
                        style={[styles.qrCodeContainer, styles.noPadding]}
                      />
                    )}
                  </QrRenderBoundary>
                </View>
              )
            ) : null}
            <View style={styles.transportOptionsContainer}>
              {/* Local WiFi/Hotspot Option */}
              <AppPressable
                style={[
                  styles.transportOptionCard,
                  selectedTransport === 'local' &&
                    styles.transportOptionCardSelected,
                ]}
                onPress={() => handleSelect('local')}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
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
                  !nostrEnabled && styles.transportOptionCardDisabled,
                  selectedTransport === 'nostr' &&
                    styles.transportOptionCardSelected,
                ]}
                onPress={() => handleSelect('nostr')}
                disabled={!nostrEnabled}
                android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
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
            {selectedTransport && description?.length > 0 && (
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
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Text style={styles.continueButtonText}>Continue →</Text>
            </AppPressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
export default TransportModeSelector;
