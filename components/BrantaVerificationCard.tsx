/**
 * BrantaVerificationCard — Display merchant info from Branta verification.
 *
 * Shows platform name, description, logo (theme-aware), and "Verified by Branta" link.
 * Renders nothing if no payment data.
 */
import React from 'react';
import {View, Image, StyleSheet, Linking, ActivityIndicator} from 'react-native';
import AppText from './AppText';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';

export interface BrantaVerificationCardProps {
  platform?: string;
  description?: string;
  logoUrl?: string;
  logoLightUrl?: string;
  verifyUrl?: string;
  isLoading?: boolean;
}

const BrantaVerificationCard: React.FC<BrantaVerificationCardProps> = ({
  platform,
  description,
  logoUrl,
  logoLightUrl,
  verifyUrl,
  isLoading = false,
}) => {
  const {theme} = useTheme();

  // Show nothing if no data or still loading
  if (!platform && !isLoading) {
    return null;
  }

  // Detect light mode for theme-aware logo selection
  const isLightMode = theme.colors.background === '#ffffff';

  const styles = StyleSheet.create({
    container: {
      backgroundColor: theme.colors.cardBackground,
      borderRadius: 10,
      padding: 12,
      marginVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.bitcoinOrange,
    },
    content: {
      flex: 1,
      marginRight: 12,
    },
    platform: {
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.medium || 'Inter-Medium',
      color: theme.colors.text,
      marginBottom: 4,
    },
    description: {
      fontSize: theme.fontSizes?.xs || 10,
      fontFamily: theme.fontFamilies?.regular || 'Inter-Regular',
      color: theme.colors.textSecondary,
      marginBottom: 4,
    },
    verifiedLink: {
      fontSize: theme.fontSizes?.xs || 10,
      fontFamily: theme.fontFamilies?.regular || 'Inter-Regular',
      color: theme.colors.bitcoinOrange,
      textDecorationLine: 'underline',
    },
    logoContainer: {
      width: 48,
      height: 48,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 6,
      backgroundColor: theme.colors.background,
    },
    logo: {
      width: 48,
      height: 48,
      borderRadius: 6,
    },
    loadingContainer: {
      width: 48,
      height: 48,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });

  // Select logo based on theme (use light version in light mode if available)
  const logoToUse = isLightMode && logoLightUrl ? logoLightUrl : logoUrl;

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {platform && <AppText style={styles.platform}>{platform}</AppText>}
        {description && (
          <AppText style={styles.description}>{description}</AppText>
        )}
        {verifyUrl ? (
          <AppPressable
            onPress={() => {
              Linking.openURL(verifyUrl).catch(err => {
                console.debug('Failed to open verify URL:', err);
              });
            }}>
            <AppText style={styles.verifiedLink}>Verified by Branta</AppText>
          </AppPressable>
        ) : (
          <AppText style={styles.verifiedLink}>Verified by Branta</AppText>
        )}
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={theme.colors.bitcoinOrange} />
        </View>
      ) : logoToUse ? (
        <View style={styles.logoContainer}>
          <Image
            source={{uri: logoToUse}}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
      ) : null}
    </View>
  );
};

export default BrantaVerificationCard;
