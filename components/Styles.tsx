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
    subPrimary: string;
    secondary: string;
    accent: string;
    danger: string;
    text: string;
    textSecondary: string;
    textOnPrimary: string;
    white: string;
    border: string;
    disabled: string;
    sent: string;
    received: string;
    buttonText: string;
    disabledText: string;
    modalBackdrop: string;
    lightGray: string;
    mediumGray: string;
    bitcoinOrange: string;
    warning: string;
    warningLight: string;
    warningAccent: string;
    success: string;
    successLight: string;
    skeletonGray: string;
    // Overlay colors for glassmorphism effects
    blackOverlay02: string;
    blackOverlay03: string;
    blackOverlay04: string;
    blackOverlay05: string;
    blackOverlay06: string;
    blackOverlay10: string;
    blackOverlay30: string;
    blackOverlay50: string;
    whiteOverlay08: string;
    whiteOverlay10: string;
    whiteOverlay12: string;
    whiteOverlay15: string;
    whiteOverlay18: string;
    whiteOverlay20: string;
    whiteOverlay25: string;
    whiteOverlay30: string;
    primaryOverlay95: string;
    primaryOverlay70: string;
    // Status color overlays
    receivedOverlay15: string;
    receivedOverlay40: string;
    dangerOverlay15: string;
    dangerOverlay40: string;
    shadowColor: string;
  };
  fontSizes?: {
    xs: number;
    sm: number;
    base: number;
    md: number;
    lg: number;
    xl: number;
    '2xl': number;
    '3xl': number;
    small?: number;
    medium?: number;
    large?: number;
    extraLarge?: number;
  };
  fontWeights?: {
    normal: string;
    medium: string;
    semibold: string;
    bold: string;
  };
  fontFamilies?: {
    regular: string;
    medium: string;
    bold: string;
    monospace: string;
    monospaceMedium: string;
    monospaceBold: string;
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
  balanceContentContainer: ViewStyle;
  balanceHeaderRow: ViewStyle;
  balanceRow: ViewStyle;
  balanceRowWithMargin: ViewStyle;
  balanceBTC: TextStyle;
  balanceFiat: TextStyle;
  balanceIcon: ImageStyle;
  balanceHeaderControls: ViewStyle;
  balanceEyeIcon: ViewStyle;
  balanceUnitToggleContainer: ViewStyle;
  balanceUnitToggle: ViewStyle;
  balanceUnitToggleText: TextStyle;
  blurredText: TextStyle;
  balancePrivacyPlaceholder: TextStyle;
  balancePrivacyContainer: ViewStyle;
  balanceHint: TextStyle;
  balanceTouchable: ViewStyle;
  balanceLoadingIndicator: ViewStyle;
  balanceErrorContainer: ViewStyle;
  balanceErrorText: TextStyle;
  providerValueCompact: TextStyle;
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
  sendButtonDisabled: ViewStyle;
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
  networkBadge: ViewStyle;
  networkBadgeText: TextStyle;
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
  keyshareModalCloseButton: ViewStyle;
  keyshareModalCloseText: TextStyle;
  keyshareModalContent: ViewStyle;
  keyshareInfoRow: ViewStyle;
  keyshareTable: ViewStyle;
  keyshareTableRow: ViewStyle;
  keyshareTableKey: TextStyle;
  keyshareTableValue: TextStyle;
  keyshareTableValueContainer: ViewStyle;
  keyshareTableValueKey: TextStyle;
  keyshareTableValueSuccess: TextStyle;
  keyshareTableValueDisabled: TextStyle;
  keyshareInfoLabel: TextStyle;
  keyshareInfoValue: TextStyle;
  keyshareInfoValueSuccess: TextStyle;
  keyshareInfoValueDisabled: TextStyle;
  keyshareKeySection: ViewStyle;
  keyshareKeyContainer: ViewStyle;
  keyshareKeyContainerBadge: ViewStyle;
  keyshareKeyText: TextStyle;
  keyshareKeyTextClickable: TextStyle;
  keyshareCopyButton: ViewStyle;
  keyshareCopyButtonText: TextStyle;
  keyshareCopyIcon: ImageStyle;
  keyshareBadgeCopyIcon: ImageStyle;
  keyshareButtonsRow: ViewStyle;
  qrModalContent: ViewStyle;
  qrModalTitle: TextStyle;
  qrModalSubtitle: TextStyle;
  qrCodeContainer: ViewStyle;
  qrModalHint: TextStyle;
  qrModalCloseButton: ViewStyle;
  qrModalCloseButtonText: TextStyle;
  keyshareLoadingContainer: ViewStyle;
  keyshareBackupButtonMargin: ViewStyle;
  keyshareButtonsContainer: ViewStyle;
  keyshareCloseButton: ViewStyle;
  keyshareBackupButton: ViewStyle;
  keyshareModalBody: ViewStyle;
  keyshareModalBodyContent: ViewStyle;
  keyshareInfoCard: ViewStyle;
  keyshareSectionTitle: TextStyle;
  keyshareDetailRow: ViewStyle;
  keyshareDetailRowLast: ViewStyle;
  keyshareDetailLabel: TextStyle;
  keyshareDetailValue: TextStyle;
  keyshareBadge: ViewStyle;
  keyshareBadgeText: TextStyle;
  keyshareBadgeTrio: ViewStyle;
  keyshareBadgeDuo: ViewStyle;
  keyshareBadgeGg18: ViewStyle;
  keyshareBadgeDkls: ViewStyle;
  keyshareStatusBadge: ViewStyle;
  keyshareStatusBadgeText: TextStyle;
  keyshareStatusBadgeSuccess: ViewStyle;
  keyshareStatusBadgeDisabled: ViewStyle;
  keyshareStatusBadgeTextSuccess: TextStyle;
  keyshareStatusBadgeTextDisabled: TextStyle;
  keyshareKeyItem: ViewStyle;
  keyshareKeyItemLast: ViewStyle;
  keyshareKeyLabel: TextStyle;
  watchWalletHeader: ViewStyle;
  keyshareInfoHeader: TextStyle;
  watchWalletTitle: TextStyle;
  watchWalletDescription: TextStyle;
  watchWalletWarning: TextStyle;
  watchWalletItem: ViewStyle;
  watchWalletItemLast: ViewStyle;
  watchWalletItemLabel: TextStyle;
  watchWalletItemValue: TextStyle;
  watchWalletItemValueContainer: ViewStyle;
  clickableTextContainer: ViewStyle;
  clickableText: TextStyle;
  qrModalButtonsContainer: ViewStyle;
  qrModalShareButton: ViewStyle;
  qrModalShareIcon: ImageStyle;
  qrModalCloseButtonWithMargin: ViewStyle;
  toastContainer: ViewStyle;
  qrModalHeader: ViewStyle;
  qrModalHeaderTitle: TextStyle;
  qrModalTopRightCloseButton: ViewStyle;
  qrModalTopRightCloseText: TextStyle;
  qrModalShareButtonSingle: ViewStyle;
  qrModalButtonsContainerCentered: ViewStyle;
  qrModalValueContainer: ViewStyle;
  qrModalValueText: TextStyle;
  qrModalValueScrollContent: ViewStyle;
  collapsibleHeader: ViewStyle;
  collapsibleHeaderContent: ViewStyle;
  collapsibleHeaderIcon: ImageStyle;
  collapsibleHeaderTitle: TextStyle;
  collapsibleChevron: TextStyle;
  collapsibleChevronSpinner: ViewStyle;
  collapsibleContent: ViewStyle;
  walletInfoContainer: ViewStyle;
  walletInfoTitle: TextStyle;
  walletInfoTitleRow: ViewStyle;
  walletInfoTitleIcon: ImageStyle;
  walletInfoContent: ViewStyle;
  walletInfoRow: ViewStyle;
  walletInfoKeyItem: ViewStyle;
  walletInfoHint: TextStyle;
  containerTransaction: ViewStyle;
  containerCompact: ViewStyle;
  trackLabelRow: ViewStyle;
  trackLabel: TextStyle;
  walletLabel: TextStyle;
  validatedLabel: TextStyle;
  visualTrack: ViewStyle;
  sigGroup: ViewStyle;
  sigCircle: ViewStyle;
  sigText: TextStyle;
  progressWrapper: ViewStyle;
  progressFill: ViewStyle;
  progressLaunched: ViewStyle;
  progressInCube: ViewStyle;
  cubeGraphic: ViewStyle;
  nodeRow: ViewStyle;
  chainNode: ViewStyle;
  chainNodeHot: ViewStyle;
  validatedBlock: ViewStyle;
  statusPanel: ViewStyle;
  statusPanelCompact: ViewStyle;
  centered: ViewStyle;
  statusText: TextStyle;
  statusTextConfirmed: TextStyle;
  errorText: TextStyle;
  retryBtn: ViewStyle;
  retryBtnText: TextStyle;
  txidPill: ViewStyle;
  txidText: TextStyle;
}
export const createStyles = (theme: Theme): Styles => ({
  actionButton: {
    paddingVertical: 12, // Consistent vertical padding for all action buttons
    paddingHorizontal: 0, // Gap handles spacing, no horizontal padding needed
    marginTop: 0,
    marginBottom: 0, // Gap handles spacing
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  settingsButton: {
    marginBottom: 0,
    marginHorizontal: 0,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: 36,
    height: 36,
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.blackOverlay06
        : theme.colors.cardBackground,
    borderWidth: 1,
    borderColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.blackOverlay10
        : theme.colors.border + '80',
    padding: 0,
    shadowColor: theme.colors.shadowColor,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: Platform.OS === 'android' ? 0 : 1,
  },
  settingsLogo: {
    marginTop: 0,
    height: 20,
    width: 20,
    tintColor: theme.colors.text,
    opacity: 0.8,
    resizeMode: 'contain',
  },
  headerTitleContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-start' as const,
    marginLeft: 0,
    paddingLeft: 8,
    minWidth: 0,
  },
  headerLogo: {
    width: 40,
    height: 40,
    resizeMode: 'contain' as const,
    marginRight: 8,
  },
  headerTitleText: {
    fontSize: theme.fontSizes?.xl || 18,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text, // Use theme text color for both light and dark mode
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  contentContainer: {
    paddingLeft: 16,
    paddingTop: 12,
    paddingRight: 16,
    paddingBottom: 0,
    position: 'relative' as const,
    zIndex: 2,
  },
  walletHeader: {
    padding: 8,
    paddingTop: 0,
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.primaryOverlay95 // Increased opacity for better contrast in light mode
        : theme.colors.whiteOverlay15, // Brighter glassy overlay for better contrast in dark mode
    borderRadius: 12,
    alignItems: 'stretch' as const, // Changed from 'center' to allow marginHorizontal to work
    marginBottom: 12, // Normalized spacing to CacheIndicator
    borderWidth: 1,
    borderColor: theme.colors.whiteOverlay30, // More visible border for better contrast
    // Explicit stacking context so action buttons stay on top on Android
    position: 'relative',
    zIndex: 3,
    elevation: 6,
    shadowColor: theme.colors.shadowColor,
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.15,
    shadowRadius: 6,
    overflow: 'visible' as const, // Changed from 'hidden' to allow proper touch handling
  },
  headerTop: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    width: '100%',
    marginBottom: 16, // Normalized spacing to party container
  },
  btcLogo: {
    width: 32,
    height: 32,
    resizeMode: 'contain' as const,
  },
  priceContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: theme.colors.whiteOverlay20, // Increased opacity for better contrast
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  btcPrice: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.white,
    marginRight: 6,
  },
  currencyBadge: {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.white,
    backgroundColor: theme.colors.whiteOverlay25, // Increased opacity for better contrast
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  balanceContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingTop: 16,
    paddingBottom: 12, // Reduced to create smaller gap with action buttons
    paddingHorizontal: 16,
    minHeight: 80,
    marginTop: 8, // Reduced gap from party container (partyContainer marginBottom: 8 + this: 8 = 16px total)
    marginBottom: 0, // Actions container has marginTop instead
    marginHorizontal: 0, // Match actionButton marginHorizontal to align with send/receive buttons
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.whiteOverlay12 // Increased opacity for better contrast in light mode
        : theme.colors.whiteOverlay18, // Increased opacity for better contrast in dark mode
    borderRadius: 10,
    borderWidth: 1,
    borderColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.whiteOverlay25 // More visible border for better contrast in light mode
        : theme.colors.whiteOverlay30, // More visible border for better contrast in dark mode
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  balanceContentContainer: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 12,
    minWidth: 0, // Allow flex shrinking
    maxWidth: '100%', // Constrain to container width
  },
  balanceHeaderControls: {
    position: 'absolute' as const,
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    zIndex: 10,
  },
  balanceEyeIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: theme.colors.whiteOverlay15,
    borderWidth: 1,
    borderColor: theme.colors.whiteOverlay25,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginRight: 12,
    flexShrink: 0,
  },
  balanceUnitToggleContainer: {
    marginLeft: 12,
    flexShrink: 0,
  },
  balanceUnitToggle: {
    width: 44, // Same square size as eye icon
    height: 44, // Same square size as eye icon
    borderRadius: 10,
    backgroundColor: theme.colors.whiteOverlay15,
    borderWidth: 1,
    borderColor: theme.colors.whiteOverlay25,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  balanceUnitToggleText: {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.white,
    opacity: 0.9,
  },
  balanceHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    width: '100%',
    marginBottom: 8, // Normalized internal spacing
    paddingBottom: 8, // Normalized internal spacing
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.whiteOverlay20, // More visible divider
  },
  providerValueCompact: {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.medium,
    color: theme.colors.white,
    flex: 1,
    textAlign: 'right' as const,
    marginLeft: 8,
  },
  balanceTouchable: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: '100%',
    maxWidth: '100%', // Ensure it respects container width
    minWidth: 0, // Allow flex shrinking
  },
  balanceLoadingIndicator: {
    marginRight: 8,
  },
  balanceErrorContainer: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center' as const,
  },
  balanceErrorText: {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.medium,
    color: theme.colors.danger,
    textAlign: 'center' as const,
  },
  balanceRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.whiteOverlay12 // Original glassy white overlay from commit abc07a5e
        : theme.colors.whiteOverlay08, // Glassy white overlay in dark mode
    width: '100%',
    justifyContent: 'center' as const,
  },
  balanceRowWithMargin: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    borderRadius: 8,
    backgroundColor: 'transparent',
    width: '100%',
    maxWidth: '100%', // Ensure it respects container width
    justifyContent: 'center' as const,
    marginTop: 0,
    marginBottom: 4, // Normalized spacing between BTC and fiat amounts
    paddingTop: 0,
    pointerEvents: 'box-none' as const,
    minHeight: 24,
    minWidth: 0, // Allow flex shrinking
  },
  balanceBTC: {
    fontSize: theme.fontSizes?.['2xl'],
    fontFamily: theme.fontFamilies?.monospaceBold,
    color: theme.colors.white,
    textShadowColor: theme.colors.shadowColor + '33', // 20% opacity
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 2,
    lineHeight: theme.fontSizes?.['2xl'] ? theme.fontSizes['2xl'] * 1.2 : 24,
    textAlign: 'center' as const,
    includeFontPadding: false,
    flexShrink: 1, // Allow text to shrink
  },
  balanceFiat: {
    fontSize: theme.fontSizes?.lg || 16,
    fontFamily: theme.fontFamilies?.monospace,
    color: theme.colors.white,
    textShadowColor: theme.colors.shadowColor + '26', // 15% opacity
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 1,
    lineHeight: theme.fontSizes?.lg ? theme.fontSizes.lg * 1.2 : 19,
    textAlign: 'center' as const,
    includeFontPadding: false,
    flexShrink: 1, // Allow text to shrink
  },
  balanceIcon: {
    width: 22,
    height: 22,
    tintColor: theme.colors.white,
    opacity: 0.9,
  },
  blurredText: {
    opacity: 0.7,
    letterSpacing: 2,
  },
  balancePrivacyContainer: {
    width: '100%',
    height: 58,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  balancePrivacyPlaceholder: {
    fontSize: theme.fontSizes?.['3xl'] || 24,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.white,
    textAlign: 'center' as const,
    letterSpacing: 4,
    opacity: 0.8,
    includeFontPadding: false,
    lineHeight: theme.fontSizes?.['3xl'] ? theme.fontSizes['3xl'] * 1.2 : 29,
  },
  balanceHint: {
    fontSize: theme.fontSizes?.xs || 10,
    color: theme.colors.textOnPrimary,
    opacity: 0.7,
    marginTop: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  qrContainer: {
    backgroundColor: 'white',
    padding: 8,
    borderRadius: 8,
    elevation: 4,
    shadowColor: theme.colors.shadowColor,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  address: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textOnPrimary,
    marginTop: 8,
    textAlign: 'center' as const,
  },
  partyContainer: {
    flexDirection: 'row' as const,
    width: '100%',
    marginTop: 0,
    borderRadius: 8,
    flexWrap: 'nowrap' as const,
    gap: 8,
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
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.medium,
    color: theme.colors.textOnPrimary,
  },
  partyText: {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.medium,
    color: theme.colors.textOnPrimary,
    opacity: 0.9,
  },
  partyLabel: {
    fontSize: theme.fontSizes?.xs || 9,
    color: theme.colors.textOnPrimary,
    opacity: 0.7,
    marginBottom: 1,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.2,
  },
  partyValue: {
    fontSize: theme.fontSizes?.xs || 11,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textOnPrimary,
    paddingHorizontal: 4,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row' as const,
    marginTop: 8, // Reduced gap from balance container (balanceContainer paddingBottom: 12 + this: 8 = 20px total)
    width: '100%',
    gap: 8, // Consistent gap between buttons
    alignItems: 'stretch' as const,
    // Ensure buttons are above everything else
    zIndex: 100,
    elevation: Platform.OS === 'android' ? 10 : 0,
    position: 'relative',
  },
  sendButton: {
    flex: 1,
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8, // Internal gap for icon and text
    minHeight: 48,
    // Ensure button is clickable on both platforms
    zIndex: 101,
    elevation: Platform.OS === 'android' ? 11 : 0,
  },
  addressTypeModalButton: {
    width: 56,
    minHeight: 48,
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.whiteOverlay15 // Glassy white overlay in light mode
        : theme.colors.whiteOverlay10, // Glassy white overlay in dark mode
    borderWidth: 1,
    borderColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.whiteOverlay25
        : theme.colors.whiteOverlay15, // Glassy border in dark mode
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 0, // No internal gap needed for icon-only button
    borderRadius: 10,
    // Ensure button is clickable on both platforms
    zIndex: 101,
    elevation: Platform.OS === 'android' ? 0 : 11,
  },
  addressTypeButtonText: {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textOnPrimary,
  },
  addressTypeButtonIcon: {
    width: 28,
    height: 28,
    tintColor: theme.colors.textOnPrimary,
    opacity: 0.9,
  },
  receiveButton: {
    flex: 1,
    backgroundColor: theme.colors.secondary,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8, // Internal gap for icon and text
    minHeight: 48,
    // Ensure button is clickable on both platforms
    zIndex: 101,
    elevation: Platform.OS === 'android' ? 11 : 0,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.modalBackdrop,
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
    borderWidth: 1,
    borderColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.blackOverlay10 // Light mode: subtle dark border
        : theme.colors.whiteOverlay20, // Dark mode: subtle light border
  },
  modalText: {
    fontSize: theme.fontSizes?.xl || 18,
    marginBottom: 10,
    textAlign: 'center' as const,
    color: theme.colors.text,
  },
  receiveButtonText: {
    fontSize: theme.fontSizes?.lg || 16,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.white,
  },
  sendButtonText: {
    fontSize: theme.fontSizes?.lg || 16,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.white,
  },
  actionButtonText: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.buttonText || theme.colors.white,
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
    borderColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange,
    borderWidth: 2,
  },
  addressTypeLabel: {
    fontSize: theme.fontSizes?.md || 15,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    marginBottom: 4,
    flexShrink: 1,
    marginRight: 6,
  },
  addressTypeValue: {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.monospace,
    color: theme.colors.textSecondary,
    textAlign: 'left' as const,
    marginTop: 4,
    flexShrink: 1,
    marginRight: 6,
  },
  recommendBadge: {
    backgroundColor: theme.colors.received + '1F', // 12% opacity
    borderColor: theme.colors.received + '59', // 35% opacity
    borderWidth: 1,
    borderRadius: 10,
    padding: 4,
    marginTop: 4,
    alignSelf: 'auto',
  },
  recommendBadgeText: {
    fontSize: theme.fontSizes?.xs || 9,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.received,
    letterSpacing: 0.2,
  },
  addressTypeIcon: {
    width: 16,
    height: 16,
    marginLeft: 8,
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
    tintColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange,
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
    fontSize: theme.fontSizes?.['2xl'] || 20,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    marginBottom: 16,
  },
  scrollView: {
    flex: 1,
  },
  cacheIndicator: {
    padding: 8,
    marginHorizontal: 16,
    marginTop: 0, // walletHeader already has marginBottom: 16
    marginBottom: 6, // No gap - transaction list starts immediately
    borderRadius: 8,
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.background // Transparent/background in light mode
        : theme.colors.whiteOverlay08, // Glassy white overlay in dark mode
    elevation: Platform.OS === 'android' ? 0 : 1,
    shadowColor: theme.colors.shadowColor,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 1,
    borderWidth: 1,
    borderColor:
      theme.colors.background !== '#ffffff'
        ? theme.colors.whiteOverlay15 // Glassy border in dark mode
        : theme.colors.blackOverlay05, // Original light mode border
  },
  refreshText: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    textAlign: 'left' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  refreshIcon: {
    width: 16,
    height: 16,
    tintColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange,
    opacity: 0.9,
  },
  cacheText: {
    fontSize: theme.fontSizes?.base || 13,
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
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.blackOverlay02
        : theme.colors.shadowColor + '05',
    borderRadius: 8,
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.blackOverlay04
        : theme.colors.shadowColor + '0A',
    transform: [{translateX: -100}],
  },
  disabled: {
    opacity: 0.7,
  },
  transactionListContainer: {
    flex: 1,
    marginBottom: 0,
    padding: 16,
    paddingTop: 0, // CacheIndicator already has marginBottom: 16
    paddingBottom: 8, // Tighter bottom so list isn’t too far from safe area
    backgroundColor: theme.colors.background,
    position: 'relative',
    zIndex: 1,
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
    fontSize: theme.fontSizes?.lg || 16,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    opacity: 0.9,
  },
  sectionSubtitle: {
    fontSize: theme.fontSizes?.base || 13,
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
    fontSize: theme.fontSizes?.lg || 16,
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
    tintColor: theme.colors.white,
  },
  addressTypeContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.whiteOverlay18 // glassy
        : theme.colors.whiteOverlay12, // Glassy white overlay in dark mode
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.whiteOverlay25
        : theme.colors.whiteOverlay20, // Glassy border in dark mode
    shadowColor: theme.colors.shadowColor,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.08,
    shadowRadius: 6,
    // Add elevation for Android
    elevation: 2,
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
  },
  addressTypeClickable: {
    // For extra visual feedback if needed
    opacity: 0.96,
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  networkIcon: {
    width: 16,
    height: 16,
    tintColor: theme.colors.white,
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
    fontSize: theme.fontSizes?.lg || 16,
    fontFamily: theme.fontFamilies?.bold,
    color:
      theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange,
  },
  modalBoldText: {
    fontSize: theme.fontSizes?.md || 15,
    fontFamily: theme.fontFamilies?.bold,
  },
  modalTextLeft: {
    fontSize: theme.fontSizes?.md || 15,
    textAlign: 'left' as const,
    color: theme.colors.text,
    marginBottom: 12,
  },
  modalInfoIcon: {
    width: 36,
    height: 36,
    marginBottom: 12,
    tintColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange,
    alignSelf: 'center' as const,
  },
  modalActionButtonText: {
    fontSize: theme.fontSizes?.lg || 16,
    fontFamily: theme.fontFamilies?.bold,
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
    tintColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.primary
        : theme.colors.white,
    marginRight: 10,
  },
  modalHeaderTitle: {
    fontSize: theme.fontSizes?.['2xl'] || 20,
    fontFamily: theme.fontFamilies?.bold,
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
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    color:
      theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange,
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
    fontSize: theme.fontSizes?.sm || 11,
    fontFamily: theme.fontFamilies?.medium,
    color: theme.colors.textSecondary,
    marginRight: 4,
  },
  apiDisplayValue: {
    fontSize: theme.fontSizes?.sm || 11,
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
    fontSize: theme.fontSizes?.sm || 11,
    color: theme.colors.textSecondary,
    letterSpacing: 0.2,
  },
  providerValue: {
    fontSize: theme.fontSizes?.sm || 11,
    color: theme.colors.textSecondary,
    letterSpacing: 0.1,
    flex: 1,
    textAlign: 'right' as const,
    opacity: 0.8,
  },
  networkBadge: {
    backgroundColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.primary + '40' // Increased opacity for better contrast in light mode
        : theme.colors.whiteOverlay15, // Glassy background in dark mode
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 0, // No margin needed in compact layout
  },
  networkBadgeText: {
    fontSize: theme.fontSizes?.xs || 9,
    fontFamily: theme.fontFamilies?.bold,
    color:
      theme.colors.background === '#ffffff'
        ? theme.colors.white // White text for better contrast on dark badge in light mode
        : theme.colors.text, // Use theme text color in dark mode
    letterSpacing: 0.5,
  },
  warningBox: {
    backgroundColor:
      (theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange) + '1A', // 10% opacity
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
    borderLeftWidth: 4,
    borderLeftColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange,
  },
  warningText: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.medium,
    color: theme.colors.danger,
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
    fontSize: theme.fontSizes?.lg || 16,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.white,
  },
  warningBoxWithMargin: {
    backgroundColor:
      (theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange) + '1A', // 10% opacity
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
    marginTop: 10,
    borderLeftWidth: 4,
    borderLeftColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange,
  },
  modalTipText: {
    fontSize: theme.fontSizes?.base || 13,
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
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 16,
    padding: 16,
    width: '90%',
    minWidth: '90%',
    maxHeight: '100%',
    alignSelf: 'center' as const,
    elevation: 8,
    shadowColor: theme.colors.shadowColor,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.15,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.blackOverlay10 // Light mode: subtle dark border
        : theme.colors.whiteOverlay20, // Dark mode: subtle light border
    flexDirection: 'column' as const,
    justifyContent: 'flex-start' as const,
    overflow: 'hidden' as const,
    minHeight: 500,
  },
  modalHeaderRowCompact: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border + '60',
    flexShrink: 0,
    height: 48,
  },
  modalHeaderIconCompact: {
    width: 24,
    height: 24,
    tintColor: theme.colors.text,
    marginRight: 10,
  },
  modalHeaderTitleCompact: {
    fontSize: theme.fontSizes?.['2xl'] || 20,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    flex: 1,
  },
  modalTextCompact: {
    fontSize: theme.fontSizes?.base || 14,
    lineHeight: 20,
    color: theme.colors.text,
    marginBottom: 12,
    textAlign: 'left' as const,
    includeFontPadding: false,
  },
  modalBoldTextCompact: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    includeFontPadding: false,
    lineHeight: 20,
  },
  warningBoxCompact: {
    backgroundColor:
      (theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange) + '14', // 8% opacity
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange,
  },
  warningTextCompact: {
    fontSize: theme.fontSizes?.base || 13,
    fontFamily: theme.fontFamilies?.medium,
    color: theme.colors.danger,
    lineHeight: 18,
  },
  modalTipTextCompact: {
    fontSize: theme.fontSizes?.sm || 12,
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
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.white,
  },
  keyshareModalCloseButton: {
    marginLeft: 'auto' as const,
    backgroundColor: theme.colors.cardBackground,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: 36,
    height: 36,
    marginTop: 4,
  },
  keyshareModalCloseText: {
    fontSize: theme.fontSizes?.['2xl'] || 22,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    lineHeight: 22,
  },
  keyshareModalContent: {
    paddingTop: 4,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  keyshareInfoRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: 16,
    marginBottom: 6,
    minHeight: 24,
  },
  keyshareInfoLabel: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    flexShrink: 0,
    minWidth: 150,
    textAlign: 'left' as const,
    includeFontPadding: false,
    textAlignVertical: 'center' as const,
  },
  keyshareInfoValue: {
    fontSize: theme.fontSizes?.base || 14,
    flex: 1,
    flexShrink: 1,
    textAlign: 'right' as const,
    includeFontPadding: false,
    textAlignVertical: 'center' as const,
  },
  keyshareInfoValueSuccess: {
    color: theme.colors.received,
  },
  keyshareInfoValueDisabled: {
    color: theme.colors.disabledText,
  },
  keyshareKeySection: {
    gap: 8,
  },
  keyshareKeyContainer: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    minWidth: 0,
  },
  keyshareKeyContainerBadge: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 32,
    borderRadius: 8,
    backgroundColor: theme.colors.primary + '05',
    borderWidth: 1,
    borderColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.primary + '40'
        : theme.colors.border + '60',
  },
  keyshareKeyText: {
    fontSize: theme.fontSizes?.sm || 11,
    fontFamily: theme.fontFamilies?.monospace,
    flex: 1,
    flexShrink: 1,
    color: theme.colors.text,
    minWidth: 0,
    textAlign: 'right' as const,
  },
  keyshareKeyTextClickable: {
    fontSize: theme.fontSizes?.sm || 11,
    fontFamily: theme.fontFamilies?.monospaceBold,
    flex: 1,
    flexShrink: 1,
    color:
      theme.colors.background === '#ffffff'
        ? theme.colors.primary
        : theme.colors.text,
    minWidth: 0,
    textAlign: 'center' as const,
    letterSpacing: 0.3,
  },
  keyshareCopyButton: {
    padding: 8,
    minHeight: 32,
    backgroundColor: theme.colors.primary,
    borderRadius: 6,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  keyshareCopyButtonText: {
    fontSize: theme.fontSizes?.sm || 11,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textOnPrimary,
  },
  keyshareCopyIcon: {
    width: 16,
    height: 16,
    tintColor: theme.colors.white,
  },
  keyshareBadgeCopyIcon: {
    width: 14,
    height: 14,
    tintColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.primary
        : theme.colors.text,
  },
  keyshareButtonsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  qrModalContent: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center' as const,
    minWidth: 280,
    maxWidth: 320,
    borderWidth: 1,
    borderColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.blackOverlay10 // Light mode: subtle dark border
        : theme.colors.whiteOverlay20, // Dark mode: subtle light border
  },
  qrModalTitle: {
    fontSize: theme.fontSizes?.xl || 18,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    marginBottom: 4,
  },
  qrModalSubtitle: {
    fontSize: theme.fontSizes?.base || 13,
    color: theme.colors.textSecondary,
    marginBottom: 20,
  },
  qrCodeContainer: {
    backgroundColor: 'white',
    padding: 8,
    borderRadius: 8,
    marginBottom: 16,
  },
  qrModalHint: {
    fontSize: theme.fontSizes?.sm || 12,
    color: theme.colors.textSecondary,
    marginBottom: 16,
    fontStyle: 'italic' as const,
  },
  qrModalCloseButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  qrModalCloseButtonText: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textOnPrimary,
  },
  keyshareLoadingContainer: {
    padding: 16,
  },
  keyshareBackupButtonMargin: {
    marginTop: 12,
    flexShrink: 0,
  },
  keyshareButtonsContainer: {
    flexDirection: 'row' as const,
    gap: 8,
    width: '100%',
  },
  keyshareCloseButton: {
    flex: 1,
  },
  keyshareBackupButton: {
    flex: 1,
  },
  keyshareModalBody: {
    width: '100%',
  },
  keyshareModalBodyContent: {
    paddingVertical: 8,
    paddingBottom: 16,
  },
  walletInfoContainer: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 8,
    padding: 16,
    marginBottom: 4,
    marginTop: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    width: '100%',
    shadowColor: theme.colors.shadowColor,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  walletInfoTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 16,
  },
  walletInfoTitleIcon: {
    width: 20,
    height: 20,
    marginRight: 8,
    tintColor: theme.colors.text,
  },
  walletInfoTitle: {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  walletInfoContent: {
    gap: 0,
  },
  walletInfoHint: {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.regular,
    color: theme.colors.textSecondary,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border + '30',
    fontStyle: 'italic' as const,
    textAlign: 'center' as const,
  },
  walletInfoRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 6,
    minHeight: 32,
  },
  walletInfoKeyItem: {
    flexDirection: 'row' as const,
    paddingVertical: 6,
    paddingHorizontal: 2,
    alignItems: 'center' as const,
    width: '100%',
    minHeight: 32,
  },
  keyshareInfoCard: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 8,
    padding: 0,
    marginBottom: 4,
    marginTop: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    width: '100%',
    overflow: 'hidden' as const,
    shadowColor: theme.colors.shadowColor,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  keyshareSectionTitle: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  keyshareDetailRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border + '30',
  },
  keyshareDetailRowLast: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderBottomWidth: 0,
  },
  keyshareDetailLabel: {
    fontSize: theme.fontSizes?.base || 13,
    fontFamily: theme.fontFamilies?.medium,
    color: theme.colors.textSecondary,
    width: 110,
    flexShrink: 0,
  },
  keyshareDetailValue: {
    fontSize: theme.fontSizes?.base || 13,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    flex: 1,
    textAlign: 'right' as const,
  },
  keyshareBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-end' as const,
  },
  keyshareBadgeText: {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.white,
    textAlign: 'center' as const,
    flex: 1,
  },
  keyshareBadgeTrio: {
    backgroundColor: theme.colors.primary,
  },
  keyshareBadgeDuo: {
    backgroundColor: theme.colors.secondary,
  },
  keyshareBadgeGg18: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  keyshareBadgeDkls: {
    backgroundColor: theme.colors.secondary,
    borderColor: theme.colors.secondary,
  },
  keyshareStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    alignSelf: 'flex-end' as const,
  },
  keyshareStatusBadgeText: {
    fontSize: theme.fontSizes?.sm || 12,
    fontFamily: theme.fontFamilies?.bold,
  },
  keyshareStatusBadgeSuccess: {
    backgroundColor: theme.colors.received + '33', // 20% opacity
  },
  keyshareStatusBadgeDisabled: {
    backgroundColor: theme.colors.disabledText + '33', // 20% opacity
  },
  keyshareStatusBadgeTextSuccess: {
    color: theme.colors.received,
  },
  keyshareStatusBadgeTextDisabled: {
    color: theme.colors.disabledText,
  },
  keyshareKeyItem: {
    flexDirection: 'row' as const,
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border + '40',
    alignItems: 'center' as const,
    width: '100%',
  },
  keyshareKeyItemLast: {
    flexDirection: 'row' as const,
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderBottomWidth: 0,
    alignItems: 'center' as const,
    width: '100%',
  },
  keyshareKeyLabel: {
    fontSize: theme.fontSizes?.base || 13,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textSecondary,
    width: 130,
    flexShrink: 0,
    marginRight: 12,
    letterSpacing: 0.1,
  },
  keyshareTable: {
    width: '100%',
  },
  keyshareTableRow: {
    flexDirection: 'row' as const,
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border + '40',
    alignItems: 'center' as const,
    width: '100%',
  },
  keyshareTableKey: {
    fontSize: theme.fontSizes?.base || 13,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textSecondary,
    width: 130,
    flexShrink: 0,
    marginRight: 12,
  },
  keyshareTableValue: {
    fontSize: theme.fontSizes?.base || 13,
    fontFamily: theme.fontFamilies?.medium,
    color: theme.colors.text,
    flex: 1,
    flexShrink: 1,
    textAlign: 'left' as const,
    minWidth: 0,
  },
  keyshareTableValueContainer: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    minWidth: 0,
  },
  keyshareTableValueKey: {
    fontSize: theme.fontSizes?.sm || 11,
    fontFamily: theme.fontFamilies?.monospace,
    flex: 1,
    flexShrink: 1,
    color: theme.colors.text,
    textAlign: 'left' as const,
    minWidth: 0,
  },
  keyshareTableValueSuccess: {
    fontSize: theme.fontSizes?.base || 13,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.received,
  },
  keyshareTableValueDisabled: {
    color: theme.colors.disabledText,
  },
  keyshareInfoHeader: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
  },
  watchWalletHeader: {
    marginTop: 4,
    marginBottom: 4,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 8,
    padding: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    width: '100%',
    overflow: 'hidden' as const,
    shadowColor: theme.colors.shadowColor,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  watchWalletTitle: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
  },
  watchWalletDescription: {
    fontSize: theme.fontSizes?.sm || 12,
    lineHeight: 18,
    color: theme.colors.text,
    marginTop: 4,
    marginBottom: 12,
  },
  watchWalletWarning: {
    fontSize: theme.fontSizes?.sm || 11,
    lineHeight: 16,
    color: theme.colors.textSecondary,
    fontStyle: 'italic' as const,
  },
  watchWalletItem: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border + '40',
  },
  watchWalletItemLast: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 0,
  },
  watchWalletItemLabel: {
    fontSize: theme.fontSizes?.base || 13,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.textSecondary,
    marginBottom: 8,
  },
  watchWalletItemValue: {
    fontSize: theme.fontSizes?.sm || 11,
    fontFamily: theme.fontFamilies?.monospace,
    flex: 1,
    flexShrink: 1,
    textAlign: 'left' as const,
    minWidth: 0,
    color: theme.colors.text, // Fix dark mode readability
  },
  watchWalletItemValueContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    minWidth: 0,
    flex: 1,
  },
  clickableTextContainer: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  clickableText: {
    fontSize: theme.fontSizes?.base || 14,
    color: theme.colors.primary,
    textDecorationLine: 'underline' as const,
  },
  qrModalButtonsContainer: {
    flexDirection: 'row' as const,
    width: '100%',
    paddingHorizontal: 20,
    marginTop: 12,
  },
  qrModalShareButton: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    marginRight: 6,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  qrModalShareIcon: {
    width: 18,
    height: 18,
    tintColor: theme.colors.white,
    marginRight: 6,
  },
  qrModalCloseButtonWithMargin: {
    flex: 1,
    backgroundColor: theme.colors.border,
    marginLeft: 6,
  },
  toastContainer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10000,
    elevation: 10000,
    pointerEvents: 'box-none' as const,
  },
  qrModalHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    width: '100%',
    marginBottom: 16,
  },
  qrModalHeaderTitle: {
    fontSize: theme.fontSizes?.xl || 18,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    flex: 1,
  },
  qrModalTopRightCloseButton: {
    marginLeft: 'auto' as const,
    backgroundColor: theme.colors.cardBackground,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  qrModalTopRightCloseText: {
    fontSize: theme.fontSizes?.['2xl'] || 22,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
    lineHeight: 22,
  },
  qrModalShareButtonSingle: {
    flex: 0,
    marginRight: 0,
    paddingHorizontal: 24,
  },
  qrModalButtonsContainerCentered: {
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  qrModalValueContainer: {
    backgroundColor: theme.colors.cardBackground || theme.colors.background,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    marginHorizontal: 0,
    borderWidth: 1,
    borderColor: theme.colors.border + '40',
    maxHeight: 100,
    width: '100%',
    alignSelf: 'stretch' as const,
    minWidth: 0,
  },
  qrModalValueText: {
    fontSize: theme.fontSizes?.xs || 10,
    fontFamily: theme.fontFamilies?.monospace,
    color: theme.colors.text,
    flexShrink: 1,
    minWidth: 0,
    letterSpacing: 0.3,
    ...(Platform.OS === 'ios' && {
      // iOS-specific: Use tighter letter spacing and ensure proper wrapping
      includeFontPadding: false,
    }),
  },
  qrModalValueScrollContent: {
    flexGrow: 1,
    minWidth: 0,
  },
  collapsibleHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 12,
    minWidth: '100%',
    backgroundColor: theme.colors.cardBackground,
  },
  collapsibleHeaderContent: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flex: 1,
  },
  collapsibleHeaderIcon: {
    width: 20,
    height: 20,
    marginRight: 8,
    tintColor: theme.colors.text,
  },
  collapsibleHeaderTitle: {
    fontSize: theme.fontSizes?.lg || 16,
    fontFamily: theme.fontFamilies?.bold,
    color: theme.colors.text,
  },
  collapsibleChevron: {
    fontSize: theme.fontSizes?.base || 14,
    fontFamily: theme.fontFamilies?.bold,
  },
  collapsibleChevronSpinner: {
    minWidth: 20,
    marginRight: 2,
  },
  collapsibleContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor:
      theme.colors.background === '#ffffff'
        ? theme.colors.accent
        : theme.colors.bitcoinOrange,
  },
  containerTransaction: {
    width: '100%',
    minHeight: 240,
    backgroundColor: '#090a0f',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 20,
    justifyContent: 'space-between',
  },
  containerCompact: {
    minHeight: 214,
    padding: 14,
  },
  trackLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  trackLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#7b7b7b',
    fontWeight: '600',
  },
  walletLabel: {
    color: '#ffd700',
  },
  validatedLabel: {
    color: '#22ff88',
  },
  visualTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  sigGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  sigCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    // RN Shadows
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  sigText: {
    fontSize: 9,
    fontWeight: '700',
  },
  progressWrapper: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(0, 255, 170, 0.15)',
    borderRadius: 2,
    marginHorizontal: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#00ffaa', 
    borderRadius: 2,
  },
  progressLaunched: {
    shadowColor: '#00ffaa',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 3,
  },
  progressInCube: {
    shadowColor: '#00ffcc',
    shadowOpacity: 0.8,
  },
  cubeGraphic: {
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  chainNode: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#2f3a3a',
    backgroundColor: '#161616',
  },
  chainNodeHot: {
    borderColor: '#00ffcc',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
  validatedBlock: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPanel: {
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  statusPanelCompact: {
    height: 70,
  },
  centered: {
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    color: '#888888',
  },
  statusTextConfirmed: {
    color: '#22ff88',
    textShadowColor: 'rgba(34, 255, 136, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  errorText: {
    fontSize: 11,
    color: '#ff4444',
    marginBottom: 6,
  },
  retryBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.35)',
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  retryBtnText: {
    color: '#ffd700',
    fontSize: 10,
  },
  txidPill: {
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.35)',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  txidText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#00ffcc',
  },
});
