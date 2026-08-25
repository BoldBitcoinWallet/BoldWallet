import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import moment from 'moment';
import Toast from 'react-native-toast-message';
import AppPressable from './AppPressable';
import AppText from './AppText';
import GlassModalOverlay from './GlassModalOverlay';
import {useTheme} from '../theme';
import {useUser} from '../context/UserContext';
import {formatBitcoinDisplay, presentFiat, getCurrencySymbol} from '../utils';
import {COMMON_FONT_CONFIGS} from '../theme/fonts';
import type {UtxoWithPath} from '../services/WalletService';
import utxoTagRepository from '../services/repositories/UtxoTagRepository';
import {
  canPersistUtxoTag,
  filterTagSuggestions,
  formatUtxoCoinId,
  isValidUtxoTag,
  sanitizeUtxoTag,
  sanitizeUtxoTagDraft,
  UTXO_TAG_MAX_LEN,
  UTXO_TAG_MIN_LEN,
} from '../services/utxoCoinControl';

export type UtxoDetailsModalProps = {
  visible: boolean;
  onClose: () => void;
  utxo: UtxoWithPath | null;
  initialTag: string;
  onTagSaved: (txid: string, vout: number, tag: string | null) => void;
  explorerUrl: string | null;
  selectedCurrency: string;
  btcRate: number;
};

const chainLabel = (chain: 'receive' | 'change', index: number) =>
  chain === 'receive' ? `Receive #${index}` : `Change #${index}`;

const UtxoDetailsModal: React.FC<UtxoDetailsModalProps> = ({
  visible,
  onClose,
  utxo,
  initialTag,
  onTagSaved,
  explorerUrl,
  selectedCurrency,
  btcRate,
}) => {
  const {theme} = useTheme();
  const {showSats, balanceFormattingEnabled} = useUser();
  const [tagDraft, setTagDraft] = useState(initialTag);
  const [persistedTag, setPersistedTag] = useState(sanitizeUtxoTag(initialTag));
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const tagInputFocusedRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      setSuggestionsOpen(false);
      tagInputFocusedRef.current = false;
      return;
    }
    const next = sanitizeUtxoTag(initialTag);
    setTagDraft(next);
    setPersistedTag(next);
    setExistingTags(utxoTagRepository.getDistinctTags());
  }, [visible, initialTag, utxo?.txid, utxo?.vout]);

  const isDirty =
    sanitizeUtxoTagDraft(tagDraft) !== sanitizeUtxoTagDraft(persistedTag);

  const canSave = isDirty && canPersistUtxoTag(tagDraft);

  const tagValidationHint =
    tagDraft.length > 0 && !isValidUtxoTag(tagDraft)
      ? `Use ${UTXO_TAG_MIN_LEN}–${UTXO_TAG_MAX_LEN} ASCII letters, numbers, _ or -`
      : null;

  const suggestions = useMemo(
    () => filterTagSuggestions(tagDraft, existingTags),
    [tagDraft, existingTags],
  );

  const handleSave = () => {
    if (!utxo?.txid || !canSave) {
      return;
    }
    const cleaned = sanitizeUtxoTagDraft(tagDraft);
    const stored = utxoTagRepository.upsert(utxo.txid, utxo.vout ?? 0, cleaned);
    setSuggestionsOpen(false);
    onTagSaved(utxo.txid, utxo.vout ?? 0, stored);
    Toast.show({
      type: 'success',
      text1: stored ? `Tagged “${stored}”` : 'Tag removed',
      position: 'top',
      visibilityTime: 2200,
    });
    onClose();
  };

  const handleClose = () => {
    setSuggestionsOpen(false);
    onClose();
  };

  const openExplorer = () => {
    if (!explorerUrl) {
      return;
    }
    Linking.openURL(explorerUrl).catch(() => {
      Alert.alert('Error', 'Could not open explorer');
    });
  };

  const applySuggestion = (tag: string) => {
    setTagDraft(sanitizeUtxoTagDraft(tag));
    setSuggestionsOpen(false);
  };

  const styles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      width: '100%',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderRadius: 16,
      width: '92%',
      maxWidth: 440,
      maxHeight: '85%',
      elevation: 5,
      shadowColor: theme.colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.2,
      shadowRadius: 6,
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
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
    },
    modalTitle: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    closeButton: {
      padding: 8,
    },
    closeButtonText: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.text,
      opacity: 0.7,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 24,
    },
    heroSection: {
      alignItems: 'center',
      paddingTop: 8,
      paddingBottom: 16,
    },
    heroAmount: {
      fontSize: 28,
      lineHeight: 36,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      textAlign: 'center',
    },
    heroFiat: {
      fontSize: theme.fontSizes?.md || 15,
      fontFamily: theme.fontFamilies?.regular,
      color: theme.colors.textSecondary,
      marginTop: 6,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 8,
      marginTop: 12,
    },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
    },
    chipText: {
      fontSize: theme.fontSizes?.xs || 11,
      fontFamily: theme.fontFamilies?.bold,
    },
    section: {
      marginBottom: 8,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10
          : theme.colors.whiteOverlay20,
      gap: 12,
    },
    detailLabel: {
      minWidth: 88,
    },
    detailValueWrap: {
      flex: 1,
      alignItems: 'flex-end',
    },
    detailValue: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: COMMON_FONT_CONFIGS.bitcoinAmountMono.fontFamily,
      color: theme.colors.text,
      textAlign: 'right',
    },
    tagLabel: {
      marginBottom: 8,
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textSecondary,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    tagInput: {
      borderWidth: 1.5,
      borderColor: theme.colors.border,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.text,
      backgroundColor: theme.colors.cardBackground,
    },
    tagHint: {
      marginTop: 6,
      marginBottom: 12,
      fontSize: theme.fontSizes?.xs || 11,
      color: theme.colors.textSecondary,
      textAlign: 'right',
    },
    tagHintError: {
      marginTop: 6,
      fontSize: theme.fontSizes?.xs || 11,
      color: theme.colors.danger || '#DC3545',
      textAlign: 'right',
    },
    suggestionsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 8,
      marginBottom: 12,
    },
    suggestionChip: {
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '35'
          : theme.colors.whiteOverlay20,
      backgroundColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.primary + '12'
          : theme.colors.whiteOverlay10 || 'rgba(255,255,255,0.08)',
    },
    suggestionChipText: {
      fontSize: theme.fontSizes?.xs || 12,
      fontFamily: theme.fontFamilies?.medium,
      color: theme.colors.primary,
    },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      marginTop: 20,
    },
    explorerBtn: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    explorerBtnText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.primary,
    },
    saveBtn: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveBtnDisabled: {
      opacity: 0.4,
    },
    saveBtnText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.white || '#fff',
    },
  });

  const isReceive = utxo?.chain === 'receive';
  const valueBtc = utxo ? utxo.value / 1e8 : 0;
  const fiat =
    utxo && btcRate > 0
      ? getCurrencySymbol(selectedCurrency || 'USD') +
        presentFiat(valueBtc * btcRate)
      : null;
  const timestamp = utxo?.status?.block_time
    ? moment(utxo.status.block_time * 1000).isAfter(
        moment().subtract(7, 'days'),
      )
      ? moment(utxo.status.block_time * 1000).fromNow()
      : moment(utxo.status.block_time * 1000).format('MMM D, YYYY · h:mm A')
    : 'Unconfirmed';
  const confirmed = !!utxo?.status?.confirmed;

  const renderRow = (label: string, value: string) => (
    <View style={styles.detailRow}>
      <AppText variant="caption" tone="muted" style={styles.detailLabel}>
        {label}
      </AppText>
      <View style={styles.detailValueWrap}>
        <AppText style={styles.detailValue} selectable>
          {value}
        </AppText>
      </View>
    </View>
  );

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={handleClose}>
      <GlassModalOverlay>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <AppText style={styles.modalTitle}>UTXO</AppText>
            <AppPressable
              onPress={handleClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close">
              <AppText style={styles.closeButtonText}>✕</AppText>
            </AppPressable>
          </View>
          {utxo ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}>
              <View style={styles.heroSection}>
                <AppText style={styles.heroAmount}>
                  {formatBitcoinDisplay(valueBtc, {
                    inSats: showSats,
                    formatted: balanceFormattingEnabled,
                  })}
                </AppText>
                {fiat ? (
                  <AppText style={styles.heroFiat}>{fiat}</AppText>
                ) : null}
                <View style={styles.chipRow}>
                  <View
                    style={[
                      styles.chip,
                      {
                        backgroundColor: isReceive
                          ? theme.colors.receivedOverlay15
                          : theme.colors.primary + '20',
                        borderColor: isReceive
                          ? theme.colors.received
                          : theme.colors.primary,
                      },
                    ]}>
                    <AppText
                      style={[
                        styles.chipText,
                        {
                          color: isReceive
                            ? theme.colors.received
                            : theme.colors.primary,
                        },
                      ]}>
                      {chainLabel(utxo.chain, utxo.chainIndex)}
                    </AppText>
                  </View>
                  <View
                    style={[
                      styles.chip,
                      {
                        backgroundColor: confirmed
                          ? theme.colors.receivedOverlay15
                          : theme.colors.warning + '20',
                        borderColor: confirmed
                          ? theme.colors.received
                          : theme.colors.warning,
                      },
                    ]}>
                    <AppText
                      style={[
                        styles.chipText,
                        {
                          color: confirmed
                            ? theme.colors.received
                            : theme.colors.warning,
                        },
                      ]}>
                      {confirmed ? 'Confirmed' : 'Unconfirmed'}
                    </AppText>
                  </View>
                </View>
              </View>

              <View style={styles.section}>
                <AppText style={styles.tagLabel}>Tag</AppText>
                <TextInput
                  style={styles.tagInput}
                  value={tagDraft}
                  onChangeText={text => {
                    setTagDraft(sanitizeUtxoTagDraft(text));
                    setSuggestionsOpen(true);
                  }}
                  onFocus={() => {
                    tagInputFocusedRef.current = true;
                    setSuggestionsOpen(true);
                  }}
                  onBlur={() => {
                    tagInputFocusedRef.current = false;
                    // Delay so suggestion presses register before list hides.
                    setTimeout(() => setSuggestionsOpen(false), 150);
                  }}
                  placeholder="e.g. savings, cold-storage"
                  placeholderTextColor={theme.colors.textSecondary + '80'}
                  maxLength={UTXO_TAG_MAX_LEN}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (canSave) {
                      handleSave();
                    } else {
                      setSuggestionsOpen(false);
                    }
                  }}
                />
                {tagValidationHint ? (
                  <AppText style={styles.tagHintError}>{tagValidationHint}</AppText>
                ) : null}
                <AppText style={styles.tagHint}>
                  {tagDraft.length}/{UTXO_TAG_MAX_LEN}
                  {isDirty ? '  ·  unsaved' : ''}
                </AppText>

                {suggestionsOpen && suggestions.length > 0 ? (
                  <View style={styles.suggestionsWrap}>
                    {suggestions.map(tag => (
                      <AppPressable
                        key={tag}
                        style={styles.suggestionChip}
                        onPress={() => applySuggestion(tag)}
                        accessibilityRole="button"
                        accessibilityLabel={`Use tag ${tag}`}>
                        <AppText style={styles.suggestionChipText} numberOfLines={1}>
                          {tag}
                        </AppText>
                      </AppPressable>
                    ))}
                  </View>
                ) : null}

                {renderRow(
                  'Coin',
                  formatUtxoCoinId(utxo.txid, utxo.vout ?? 0),
                )}
                {renderRow('Address', utxo.address || '—')}
                {renderRow('Path', utxo.derivationPath || '—')}
                {renderRow('Time', timestamp)}
                {utxo.status?.block_height
                  ? renderRow('Block', String(utxo.status.block_height))
                  : null}
              </View>

              <View style={styles.actionsRow}>
                {explorerUrl ? (
                  <AppPressable
                    onPress={openExplorer}
                    style={styles.explorerBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Open in explorer">
                    <AppText style={styles.explorerBtnText}>
                      Open in explorer
                    </AppText>
                  </AppPressable>
                ) : null}
                <AppPressable
                  onPress={handleSave}
                  disabled={!canSave}
                  style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Save tag"
                  accessibilityState={{disabled: !canSave}}>
                  <AppText style={styles.saveBtnText}>Save</AppText>
                </AppPressable>
              </View>
            </ScrollView>
          ) : null}
        </View>
      </KeyboardAvoidingView>
      </GlassModalOverlay>
    </Modal>
  );
};

export default UtxoDetailsModal;
