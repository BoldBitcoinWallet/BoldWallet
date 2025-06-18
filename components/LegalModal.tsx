import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
  Linking,
} from 'react-native';
import {themes} from '../theme';

interface LegalModalProps {
  visible: boolean;
  onClose: () => void;
  type: 'terms' | 'privacy';
}

const LegalModal: React.FC<LegalModalProps> = ({visible, onClose, type}) => {
  const {height} = useWindowDimensions();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const urls = useMemo(() => ({
    terms: 'https://raw.githubusercontent.com/BoldBitcoinWallet/Terms/refs/heads/main/Terms%20Of%20Service.md',
    privacy: 'https://raw.githubusercontent.com/BoldBitcoinWallet/Terms/refs/heads/main/Privacy%20Policy.md',
  }), []);

  const titles = useMemo(() => ({
    terms: 'Terms of Service',
    privacy: 'Privacy Policy',
  }), []);

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
      console.error('Error fetching content:', err);
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
              <TouchableOpacity
                onPress={handleRefresh}
                style={styles.refreshButton}>
                <Text style={styles.refreshButtonText}>↻</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            style={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {loading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator
                  size="large"
                  color={themes.lightPolished.colors.primary}
                />
                <Text style={styles.loadingText}>Loading...</Text>
              </View>
            )}

            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity
                  onPress={handleRefresh}
                  style={styles.retryButton}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {content && !loading && !error && (
              <>
                <Text style={styles.content}>{content}</Text>

                <TouchableOpacity
                  onPress={() => Linking.openURL('https://boldbitcoinwallet.com#terms')}
                  style={styles.linkContainer}>
                  <Text style={styles.linkText}>🌐 Terms and Conditions & Privacy Policy</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: themes.lightPolished.colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: themes.lightPolished.colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: themes.lightPolished.colors.text,
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
    fontSize: 18,
    color: themes.lightPolished.colors.text,
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 20,
    color: themes.lightPolished.colors.text,
  },
  scrollContent: {
    padding: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: themes.lightPolished.colors.textSecondary,
  },
  errorContainer: {
    alignItems: 'center',
    padding: 40,
  },
  errorText: {
    fontSize: 16,
    color: themes.lightPolished.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: themes.lightPolished.colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: themes.lightPolished.colors.background,
    fontWeight: '600',
  },
  content: {
    fontSize: 14,
    lineHeight: 22,
    color: themes.lightPolished.colors.textSecondary,
    marginBottom: 20,
  },
  linkContainer: {
    padding: 16,
    borderWidth: 1,
    borderColor: themes.lightPolished.colors.border,
    borderRadius: 8,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
    color: themes.lightPolished.colors.text,
  },
});

export default LegalModal;
