import {
  ImageStyle,
  Platform,
  StyleSheet,
  TextStyle,
  ViewStyle,
} from 'react-native';

export interface Theme {
  colors: {
    background: string;
    cardBackground: string;
    primary: string;
    secondary: string;
    accent: string;
    text: string;
    textSecondary: string;
    textOnPrimary: string;
    white: string;
    border: string;
  };
}

export interface Styles {
  actionButton: ViewStyle;
  settingsButton: ViewStyle;
  headerTitleContainer: ViewStyle;
  headerLogo: ImageStyle;
  headerTitleText: TextStyle;
  container: ViewStyle;
  contentContainer: ViewStyle;
  walletHeader: ViewStyle;
  headerTop: ViewStyle;
  btcLogo: ImageStyle;
  settingsLogo: ImageStyle;
  priceContainer: ViewStyle;
  btcPrice: TextStyle;
  currencyBadge: TextStyle;
  balanceContainer: ViewStyle;
  balanceRow: ViewStyle;
  balanceRowWithMargin: ViewStyle;
  balanceBTC: TextStyle;
  balanceFiat: TextStyle;
  balanceIcon: ImageStyle;
  blurredText: TextStyle;
  balanceHint: TextStyle;
  qrContainer: ViewStyle;
  address: TextStyle;
  partyContainer: ViewStyle;
  partyLeft: ViewStyle;
  partyCenter: ViewStyle;
  partyRight: ViewStyle;
  party: TextStyle;
  partyText: TextStyle;
  partyLabel: TextStyle;
  partyValue: TextStyle;
  actions: ViewStyle;
  sendButton: ViewStyle;
  sendButtonText: TextStyle;
  addressTypeModalButton: ViewStyle;
  addressTypeButtonText: TextStyle;
  addressTypeButtonIcon: ImageStyle;
  receiveButton: ViewStyle;
  receiveButtonText: TextStyle;
  modalOverlay: ViewStyle;
  modalContent: ViewStyle;
  modalText: TextStyle;
  actionButtonText: TextStyle;
  addressTypeButton: ViewStyle;
  addressTypeButtonSelected: ViewStyle;
  addressTypeLabel: TextStyle;
  addressTypeValue: TextStyle;
  addressTypeIcon: ImageStyle;
  modalAddressTypeIcon: ImageStyle;
  addressTypeContent: ViewStyle;
  modalTitle: TextStyle;
  scrollView: ViewStyle;
  cacheIndicator: ViewStyle;
  refreshText: TextStyle;
  refreshIcon: ImageStyle;
  cacheText: TextStyle;
  shimmerContainer: ViewStyle;
  shimmer: ViewStyle;
  disabled: ViewStyle;
  transactionListContainer: ViewStyle;
  sectionHeader: ViewStyle;
  sectionTitle: TextStyle;
  sectionSubtitle: TextStyle;
  emptyStateContainer: ViewStyle;
  emptyStateText: TextStyle;
  emptyStateIcon: ImageStyle;
  actionButtonIcon: ImageStyle;
  addressTypeContainer: ViewStyle;
  addressTypeClickable: ViewStyle;
  networkRow: ViewStyle;
  networkIcon: ImageStyle;
  rowCenter: ViewStyle;
  rowFullWidth: ViewStyle;
  columnCenter: ViewStyle;
  rowCenterMarginTop2: ViewStyle;
  flexOneMinWidthZero: ViewStyle;
  partyGap: ViewStyle;
  modalGoSettingsButton: ViewStyle;
  modalCloseButton: ViewStyle;
  modalCloseButtonText: TextStyle;
  modalBoldText: TextStyle;
  modalTextLeft: TextStyle;
  modalInfoIcon: ImageStyle;
  modalActionButtonText: TextStyle;
  modalParagraph: ViewStyle;
  modalHeaderRow: ViewStyle;
  modalHeaderIcon: ImageStyle;
  modalHeaderTitle: TextStyle;
  modalActionsRow: ViewStyle;
  modalActionLeft: ViewStyle;
  modalActionRight: ViewStyle;
  linkText: TextStyle;
  apiDisplayContainer: ViewStyle;
  apiDisplayButton: ViewStyle;
  apiDisplayContent: ViewStyle;
  apiDisplayIcon: ImageStyle;
  apiDisplayLabel: TextStyle;
  apiDisplayValue: TextStyle;
  providerRow: ViewStyle;
  providerItem: ViewStyle;
  providerLeft: ViewStyle;
  providerIcon: ImageStyle;
  providerLabel: TextStyle;
  providerValue: TextStyle;
  warningBox: ViewStyle;
  warningText: TextStyle;
  backupButton: ViewStyle;
  backupButtonText: TextStyle;
  modalOptionCheckIcon: ImageStyle;
  addressTypeLabelRow: ViewStyle;
  recommendBadge: ViewStyle;
  recommendBadgeText: TextStyle;
  warningBoxWithMargin: ViewStyle;
  modalTipText: TextStyle;
  backupButtonWithMargin: ViewStyle;
  modalContentCompact: ViewStyle;
  modalHeaderRowCompact: ViewStyle;
  modalHeaderIconCompact: ImageStyle;
  modalHeaderTitleCompact: TextStyle;
  modalTextCompact: TextStyle;
  modalBoldTextCompact: TextStyle;
  warningBoxCompact: ViewStyle;
  warningTextCompact: TextStyle;
  modalTipTextCompact: TextStyle;
  backupButtonCompact: ViewStyle;
  backupButtonTextCompact: TextStyle;
}

export const createStyles = (theme: Theme): Styles => ({
  actionButton: {
    paddingVertical: 12,
    marginBottom: 4,
    marginHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  settingsButton: {
    marginBottom: 4,
    marginHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center' as const,
    width: 30,
    height: 30,
    backgroundColor: theme.colors.cardBackground,
    padding: 0,
  },
  settingsLogo: {
    marginTop: 3,
    height: 24,
    width: 24,
    resizeMode: 'contain',
  },
  headerTitleContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  headerLogo: {
    width: 40,
    height: 40,
    resizeMode: 'contain' as const,
    marginRight: 8,
  },
  headerTitleText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  contentContainer: {
    paddingTop: 12,
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 0,
  },
  walletHeader: {
    padding: 12,
    backgroundColor: theme.colors.primary,
    borderRadius: 12,
    alignItems: 'center' as const,
    marginBottom: 0,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  headerTop: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    width: '100%',
    marginBottom: 8,
  },
  btcLogo: {
    width: 32,
    height: 32,
    resizeMode: 'contain' as const,
  },
  priceContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  btcPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.white,
    marginRight: 6,
  },
  currencyBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.white,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  balanceContainer: {
    alignItems: 'center' as const,
    width: '100%',
    paddingVertical: 4,
    marginBottom: 4,
  },
  balanceRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    width: '100%',
    justifyContent: 'center' as const,
  },
  balanceRowWithMargin: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    width: '100%',
    justifyContent: 'center' as const,
    marginTop: 4,
  },
  balanceBTC: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.white,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  balanceFiat: {
    fontSize: 16,
    color: theme.colors.white,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  balanceIcon: {
    width: 18,
    height: 18,
    tintColor: theme.colors.white,
    opacity: 0.9,
  },
  blurredText: {
    opacity: 0.7,
    letterSpacing: 2,
  },
  balanceHint: {
    fontSize: 10,
    color: theme.colors.textOnPrimary,
    opacity: 0.7,
    marginTop: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  qrContainer: {
    padding: 8,
    backgroundColor: '#fff',
    borderRadius: 4,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  address: {
    fontSize: 14,
    color: theme.colors.textOnPrimary,
    marginTop: 8,
    textAlign: 'center' as const,
    fontWeight: '600',
  },
  partyContainer: {
    flexDirection: 'row' as const,
    width: '100%',
    marginTop: 4,
    marginBottom: 6,
    borderRadius: 8,
  },
  partyLeft: {
    flex: 1,
    alignItems: 'flex-start' as const,
  },
  partyCenter: {
    flex: 1,
    alignItems: 'center' as const,
  },
  partyRight: {
    flex: 1,
    alignItems: 'flex-end' as const,
  },
  party: {
    fontSize: 12,
    color: theme.colors.textOnPrimary,
    fontWeight: '500',
  },
  partyText: {
    fontSize: 12,
    color: theme.colors.textOnPrimary,
    fontWeight: '500',
    opacity: 0.9,
  },
  partyLabel: {
    fontSize: 10,
    color: theme.colors.textOnPrimary,
    opacity: 0.7,
    marginBottom: 1,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.2,
  },
  partyValue: {
    fontSize: 12,
    color: theme.colors.textOnPrimary,
    fontWeight: '600',
    paddingHorizontal: 6,
  },
  actions: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginTop: 8,
    width: '100%',
    gap: 6,
  },
  sendButton: {
    flex: 1,
    backgroundColor: theme.colors.accent,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
  },
  addressTypeModalButton: {
    width: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
  },
  addressTypeButtonText: {
    color: theme.colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  addressTypeButtonIcon: {
    width: 20,
    height: 20,
    tintColor: theme.colors.textOnPrimary,
    opacity: 0.9,
  },
  receiveButton: {
    flex: 1,
    backgroundColor: theme.colors.secondary,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    zIndex: 100,
  },
  modalContent: {
    backgroundColor: theme.colors.background,
    borderRadius: 12,
    padding: 20,
    width: '80%',
    alignItems: 'center' as const,
  },
  modalText: {
    fontSize: 18,
    marginBottom: 10,
    textAlign: 'center' as const,
    color: theme.colors.text,
  },
  receiveButtonText: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  sendButtonText: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  addressTypeButton: {
    backgroundColor: theme.colors.cardBackground,
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
    width: '100%',
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    position: 'relative',
    minHeight: 68,
  },
  addressTypeButtonSelected: {
    borderColor: theme.colors.accent,
    borderWidth: 2,
  },
  addressTypeLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 4,
    flexShrink: 1,
    marginRight: 6,
  },
  addressTypeValue: {
    marginTop: 4,
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'left' as const,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flexShrink: 1,
    marginRight: 6,
  },
  recommendBadge: {
    backgroundColor: 'rgba(76, 175, 80, 0.12)',
    borderColor: 'rgba(76, 175, 80, 0.35)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 4,
    marginTop: 4,
    alignSelf: 'auto',
  },
  recommendBadgeText: {
    color: '#4CAF50',
    fontSize: 9,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
  addressTypeIcon: {
    width: 16,
    height: 16,
    tintColor: theme.colors.white,
    opacity: 0.9,
  },
  modalAddressTypeIcon: {
    width: 22,
    height: 22,
    tintColor: theme.colors.text,
    opacity: 0.9,
  },
  modalOptionCheckIcon: {
    width: 18,
    height: 18,
    tintColor: theme.colors.accent,
    opacity: 0.9,
    marginLeft: 4,
  },
  addressTypeContent: {
    flex: 1,
    paddingRight: 8,
  },
  addressTypeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexWrap: 'nowrap',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: 16,
  },
  scrollView: {
    flex: 1,
  },
  cacheIndicator: {
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 8,
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 1,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.05)',
  },
  refreshText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'left' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  refreshIcon: {
    width: 16,
    height: 16,
    tintColor: theme.colors.accent,
    opacity: 0.9,
  },
  cacheText: {
    fontSize: 13,
    marginBottom: 0,
    marginTop: 0,
    textAlign: 'right' as const,
    opacity: 0.7,
  },
  shimmerContainer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
    transform: [{translateX: -100}],
  },
  disabled: {
    opacity: 0.7,
  },
  transactionListContainer: {
    flex: 1,
    marginBottom: 0,
    padding: 16,
    paddingTop: 0,
    backgroundColor: theme.colors.background,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 0,
    paddingVertical: 12,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    opacity: 0.9,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 20,
    marginTop: 20,
  },
  emptyStateText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center' as const,
    marginTop: 8,
  },
  emptyStateIcon: {
    width: 48,
    height: 48,
    opacity: 0.5,
    marginBottom: 8,
  },
  actionButtonIcon: {
    width: 18,
    height: 18,
    tintColor: '#fff',
  },
  addressTypeContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)', // glassy
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.08,
    shadowRadius: 6,
    // Add elevation for Android
    elevation: 2,
  },
  addressTypeClickable: {
    // For extra visual feedback if needed
    opacity: 0.96,
  },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  networkIcon: {
    width: 16,
    height: 16,
    tintColor: '#FFFFFF',
  },
  rowCenter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  rowFullWidth: {
    flexDirection: 'row' as const,
    width: '100%',
  },
  columnCenter: {
    flex: 1,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 4,
  },
  rowCenterMarginTop2: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginTop: 2,
  },
  flexOneMinWidthZero: {
    flex: 1,
    minWidth: 0,
  },
  partyGap: {
    marginHorizontal: 4,
  },
  modalGoSettingsButton: {
    marginTop: 16,
  },
  modalCloseButton: {
    marginTop: 8,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  modalCloseButtonText: {
    color: theme.colors.accent,
    fontWeight: 'bold' as const,
    fontSize: 16,
  },
  modalBoldText: {
    fontSize: 15,
    fontWeight: 'bold' as const,
  },
  modalTextLeft: {
    textAlign: 'left' as const,
    color: theme.colors.text,
    fontSize: 15,
    marginBottom: 12,
  },
  modalInfoIcon: {
    width: 36,
    height: 36,
    marginBottom: 12,
    tintColor: theme.colors.accent,
    alignSelf: 'center' as const,
  },
  modalActionButtonText: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: theme.colors.primary,
    letterSpacing: 0.2,
  },
  modalParagraph: {
    marginBottom: 10,
  },
  modalHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  modalHeaderIcon: {
    width: 24,
    height: 24,
    tintColor: theme.colors.accent,
    marginRight: 10,
  },
  modalHeaderTitle: {
    fontSize: 20,
    fontWeight: 'bold' as const,
    color: theme.colors.text,
    flex: 1,
    textAlign: 'left' as const,
  },
  modalActionsRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginTop: 16,
    width: '100%',
    gap: 8,
  },
  modalActionLeft: {
    flex: 1,
    alignItems: 'flex-start' as const,
  },
  modalActionRight: {
    flex: 1,
    alignItems: 'flex-end' as const,
  },
  linkText: {
    color: theme.colors.accent,
    fontWeight: 'bold' as const,
  },
  apiDisplayContainer: {
    paddingHorizontal: 16,
    alignItems: 'center' as const,
  },
  apiDisplayButton: {
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
    paddingVertical: 8,
    width: '100%',
    opacity: 0.8,
  },
  apiDisplayContent: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    height: 16,
    gap: 2,
  },
  apiDisplayIcon: {
    width: 14,
    height: 14,
    marginRight: 6,
    tintColor: theme.colors.textSecondary,
    opacity: 0.7,
  },
  apiDisplayLabel: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: theme.colors.textSecondary,
    marginRight: 4,
  },
  apiDisplayValue: {
    fontSize: 11,
    fontWeight: '400' as const,
    color: theme.colors.textSecondary,
    flex: 1,
    textAlign: 'right' as const,
  },
  providerRow: {
    marginHorizontal: 16,
    marginVertical: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  providerItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  providerLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flex: 1,
  },
  providerIcon: {
    width: 14,
    height: 14,
    marginRight: 6,
    tintColor: theme.colors.textSecondary,
    opacity: 0.8,
  },
  providerLabel: {
    fontSize: 11,
    fontWeight: '400' as const,
    color: theme.colors.textSecondary,
    letterSpacing: 0.2,
  },
  providerValue: {
    fontSize: 11,
    fontWeight: '400' as const,
    color: theme.colors.textSecondary,
    letterSpacing: 0.1,
    flex: 1,
    textAlign: 'right' as const,
    opacity: 0.8,
  },
  warningBox: {
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#FFC107',
  },
  warningText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: '#FF6B35',
    lineHeight: 20,
  },
  backupButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 12,
    alignItems: 'center' as const,
  },
  backupButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600' as const,
  },
  warningBoxWithMargin: {
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
    marginTop: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#FFC107',
  },
  modalTipText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 12,
    textAlign: 'left' as const,
  },
  backupButtonWithMargin: {
    backgroundColor: theme.colors.secondary,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 18,
    alignItems: 'center' as const,
  },
  modalContentCompact: {
    backgroundColor: theme.colors.background,
    borderRadius: 12,
    padding: 16,
    width: '85%',
    maxWidth: 400,
  },
  modalHeaderRowCompact: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  modalHeaderIconCompact: {
    width: 20,
    height: 20,
    tintColor: theme.colors.accent,
    marginRight: 8,
  },
  modalHeaderTitleCompact: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: theme.colors.text,
    flex: 1,
  },
  modalTextCompact: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.text,
    marginBottom: 12,
    textAlign: 'left' as const,
  },
  modalBoldTextCompact: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: theme.colors.text,
  },
  warningBoxCompact: {
    backgroundColor: 'rgba(255, 193, 7, 0.08)',
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#FFC107',
  },
  warningTextCompact: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#FF6B35',
    lineHeight: 18,
  },
  modalTipTextCompact: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 14,
    textAlign: 'left' as const,
    lineHeight: 16,
  },
  backupButtonCompact: {
    backgroundColor: theme.colors.secondary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center' as const,
  },
  backupButtonTextCompact: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600' as const,
  },
});
