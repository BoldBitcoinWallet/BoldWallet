import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
  Linking,
  Image,
} from 'react-native';
import {useTheme} from '../theme';
import {dbg} from '../utils';
interface LegalModalProps {
  visible: boolean;
  onClose: () => void;
  type: 'terms' | 'privacy';
}
const LegalModal: React.FC<LegalModalProps> = ({visible, onClose, type}) => {
  const {theme} = useTheme();
  const {height} = useWindowDimensions();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const urls = useMemo(
    () => ({
      terms:
        'https://raw.githubusercontent.com/BoldBitcoinWallet/Terms/refs/heads/main/Terms%20Of%20Service.md',
      privacy:
        'https://raw.githubusercontent.com/BoldBitcoinWallet/Terms/refs/heads/main/Privacy%20Policy.md',
    }),
    [],
  );
  const titles = useMemo(
    () => ({
      terms: 'Terms of Service',
      privacy: 'Privacy Policy',
    }),
    [],
  );
  const formatMarkdown = useCallback((markdown: string): string => {
    return (
      markdown
        // Remove markdown headers
        .replace(/^#+\s+/gm, '')
        // Remove markdown bold
        .replace(/\*\*(.*?)\*\*/g, '$1')
        // Remove markdown italic
        .replace(/\*(.*?)\*/g, '$1')
        // Remove markdown links but keep text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Remove email links
        .replace(/\[([^\]]+)\]\(mailto:[^)]+\)/g, '$1')
        // Clean up extra whitespace
        .replace(/\n\s*\n/g, '\n\n')
        .trim()
    );
  }, []);
  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(urls[type]);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const markdownContent = await response.text();
      // Convert markdown to readable text
      const formattedContent = formatMarkdown(markdownContent);
      setContent(formattedContent);
    } catch (err) {
      dbg('Error fetching content:', err);
      setError(
        'Failed to load content. Please check your internet connection.',
      );
    } finally {
      setLoading(false);
    }
  }, [urls, type, formatMarkdown]);
  useEffect(() => {
    if (visible) {
      fetchContent();
    }
  }, [visible, type, fetchContent]);
  const handleRefresh = useCallback(() => {
    setContent('');
    fetchContent();
  }, [fetchContent]);
  const styles = StyleSheet.create({
    modalContainer: {
      flex: 1,
      backgroundColor: theme.colors.modalBackdrop,
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: 1,
      borderTopColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay20, // Dark mode: subtle light border
      paddingBottom: 20,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay20, // Dark mode: subtle light border
    },
    title: {
      fontSize: theme.fontSizes?.xl || 18,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
      flex: 1,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    refreshButton: {
      padding: 8,
      marginRight: 8,
    },
    refreshButtonText: {
      fontSize: theme.fontSizes?.xl || 18,
      color: theme.colors.text,
    },
    closeButton: {
      padding: 8,
    },
    closeButtonText: {
      fontSize: theme.fontSizes?.['2xl'] || 20,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text,
    },
    scrollContent: {
      padding: 16,
    },
    loadingContainer: {
      alignItems: 'center',
      padding: 40,
    },
    loadingText: {
      fontSize: theme.fontSizes?.lg || 16,
      marginTop: 16,
      color: theme.colors.textSecondary,
    },
    errorContainer: {
      alignItems: 'center',
      padding: 40,
    },
    errorText: {
      fontSize: theme.fontSizes?.lg || 16,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
    },
    retryButton: {
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 8,
    },
    retryButtonText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.textOnPrimary || theme.colors.white,
    },
    content: {
      fontSize: theme.fontSizes?.base || 14,
      lineHeight: 22,
      color: theme.colors.text, // Use text color instead of textSecondary for better readability
      marginBottom: 20,
    },
    linkContainer: {
      padding: 16,
      borderWidth: 1,
      borderColor:
        theme.colors.background === '#ffffff'
          ? theme.colors.blackOverlay10 // Light mode: subtle dark border
          : theme.colors.whiteOverlay20, // Dark mode: subtle light border
      borderRadius: 8,
      alignItems: 'center',
      marginBottom: 16,
      backgroundColor: theme.colors.cardBackground, // Add background for better visibility
    },
    linkContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    linkIcon: {
      width: 16,
      height: 16,
      marginRight: 8,
      tintColor: theme.colors.text,
    },
    linkText: {
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.bold,
      color: theme.colors.text, // Use text color for better readability
    },
  });
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={[styles.modalContent, {maxHeight: height * 0.7}]}>
          <View style={styles.header}>
            <Text style={styles.title}>{titles[type]}</Text>
            <View style={styles.headerActions}>
              <Pressable
                onPress={handleRefresh}
                style={styles.refreshButton}
                android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                <Text style={styles.refreshButtonText}>↻</Text>
              </Pressable>
              <Pressable
                onPress={onClose}
                style={styles.closeButton}
                android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                <Text style={styles.closeButtonText}>✕</Text>
              </Pressable>
            </View>
          </View>
          <ScrollView
            style={styles.scrollContent}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            overScrollMode="never"
            showsVerticalScrollIndicator={false}>
            {loading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.colors.text} />
                <Text style={styles.loadingText}>Loading...</Text>
              </View>
            )}
            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable
                  onPress={handleRefresh}
                  style={styles.retryButton}
                  android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </Pressable>
              </View>
            )}
            {content && !loading && !error && (
              <>
                <Text style={styles.content}>{content}</Text>
                <Pressable
                  onPress={() =>
                    Linking.openURL('https://boldbitcoinwallet.com#terms')
                  }
                  style={styles.linkContainer}
                  android_ripple={{ color: 'rgba(0,0,0,0.1)' }}>
                  <View style={styles.linkContent}>
                    <Image
                      source={require('../assets/mainnet-icon.png')}
                      style={styles.linkIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.linkText}>
                      Terms and Conditions & Privacy Policy
                    </Text>
                  </View>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
export default LegalModal;
