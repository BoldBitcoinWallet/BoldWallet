import React from 'react';
import {Modal, View, Text, Pressable, Image} from 'react-native';
import {shorten, HapticFeedback} from '../utils';
import {useTheme} from '../theme';
import {createStyles} from './Styles';

export interface AddressTypeModalProps {
  visible: boolean;
  onClose: () => void;
  addressType: string;
  legacyAddress: string;
  segwitAddress: string;
  segwitCompatibleAddress: string;
  onSelectAddressType: (type: string) => void;
}

const AddressTypeModal: React.FC<AddressTypeModalProps> = ({
  visible,
  onClose,
  addressType,
  legacyAddress,
  segwitAddress,
  segwitCompatibleAddress,
  onSelectAddressType,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        style={styles.modalOverlay}
        onPress={() => {
          HapticFeedback.light();
          onClose();
        }}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeaderRow}>
            <Image
              source={require('../assets/bitcoin-icon.png')}
              style={styles.modalHeaderIcon}
            />
            <Text style={styles.modalHeaderTitle}>Select Address Type</Text>
          </View>
          <Pressable
            style={[
              styles.addressTypeButton,
              addressType === 'legacy' && styles.addressTypeButtonSelected,
            ]}
            onPress={() => {
              HapticFeedback.selection();
              onSelectAddressType('legacy');
            }}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Image
              source={require('../assets/bricks-icon.png')}
              style={styles.modalAddressTypeIcon}
              resizeMode="contain"
            />
            <View style={styles.addressTypeContent}>
              <Text style={styles.addressTypeLabel} numberOfLines={1}>
                Legacy (P2PKH)
              </Text>
              <Text style={styles.addressTypeValue}>
                {shorten(legacyAddress, 6)}
              </Text>
            </View>
            {addressType === 'legacy' && (
              <Image
                source={require('../assets/check-icon.png')}
                style={styles.modalOptionCheckIcon}
                resizeMode="contain"
              />
            )}
          </Pressable>
          <Pressable
            style={[
              styles.addressTypeButton,
              addressType === 'segwit-native' &&
                styles.addressTypeButtonSelected,
            ]}
            onPress={() => {
              HapticFeedback.selection();
              onSelectAddressType('segwit-native');
            }}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Image
              source={require('../assets/dna-icon.png')}
              style={styles.modalAddressTypeIcon}
              resizeMode="contain"
            />
            <View style={styles.addressTypeContent}>
              <Text style={styles.addressTypeLabel} numberOfLines={1}>
                Native SegWit (Bech32)
              </Text>
              <View style={styles.addressTypeLabelRow}>
                <Text style={styles.addressTypeValue} numberOfLines={1}>
                  {shorten(segwitAddress, 6)}
                </Text>
                <View style={styles.recommendBadge}>
                  <Text style={styles.recommendBadgeText}>Recommended</Text>
                </View>
              </View>
            </View>
            {addressType === 'segwit-native' && (
              <Image
                source={require('../assets/check-icon.png')}
                style={styles.modalOptionCheckIcon}
                resizeMode="contain"
              />
            )}
          </Pressable>
          <Pressable
            style={[
              styles.addressTypeButton,
              addressType === 'segwit-compatible' &&
                styles.addressTypeButtonSelected,
            ]}
            onPress={() => {
              HapticFeedback.selection();
              onSelectAddressType('segwit-compatible');
            }}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Image
              source={require('../assets/recycle-icon.png')}
              style={styles.modalAddressTypeIcon}
              resizeMode="contain"
            />
            <View style={styles.addressTypeContent}>
              <Text style={styles.addressTypeLabel} numberOfLines={1}>
                Nested SegWit (P2SH)
              </Text>
              <Text style={styles.addressTypeValue}>
                {shorten(segwitCompatibleAddress, 6)}
              </Text>
            </View>
            {addressType === 'segwit-compatible' && (
              <Image
                source={require('../assets/check-icon.png')}
                style={styles.modalOptionCheckIcon}
                resizeMode="contain"
              />
            )}
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
};

export default AddressTypeModal;
