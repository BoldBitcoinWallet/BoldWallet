import {ImageStyle, StyleSheet, TextStyle, ViewStyle} from 'react-native';

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
  addressTypeModalButton: ViewStyle;
  addressTypeButtonText: TextStyle;
  addressTypeButtonIcon: ImageStyle;
  receiveButton: ViewStyle;
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
  networkRow: ViewStyle;
  networkIcon: ImageStyle;
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
    margin: 0,
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
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    width: '100%',
    marginTop: 2,
    marginBottom: 8,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    padding: 8,
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
    marginBottom: 2,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  partyValue: {
    fontSize: 12,
    color: theme.colors.textOnPrimary,
    fontWeight: '600',
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
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  addressTypeButton: {
    backgroundColor: theme.colors.cardBackground,
    padding: 16,
    borderRadius: 8,
    marginVertical: 8,
    width: '100%',
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  addressTypeButtonSelected: {
    borderColor: theme.colors.accent,
    borderWidth: 2,
  },
  addressTypeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 4,
  },
  addressTypeValue: {
    marginTop: 4,
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'left' as const,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  addressTypeIcon: {
    width: 16,
    height: 16,
    tintColor: theme.colors.white,
    opacity: 0.9,
  },
  modalAddressTypeIcon: {
    width: 24,
    height: 24,
    tintColor: theme.colors.text,
    opacity: 0.9,
  },
  addressTypeContent: {
    flex: 1,
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
  },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  networkIcon: {
    width: 16,
    height: 16,
    marginRight: 4,
    tintColor: '#FFFFFF',
  },
});
