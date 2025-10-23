import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import {useTheme} from '../theme';
import DeviceInfo from 'react-native-device-info';

const LoadingScreen = ({onRetry}: any) => {
  const {theme} = useTheme();
  const [appVersion, setAppVersion] = useState('');

  const [loading, setLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0.7)).current;
  const {width, height} = useWindowDimensions(); // Dynamic screen size detection

  // Determine if the screen is small or in landscape
  const isSmallScreen = height < 600; // Arbitrary threshold for small screens
  const isLandscape = width > height;

  const handlePress = async () => {
    setLoading(true);
    await onRetry();
    setLoading(false);
  };

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.cubic,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0.7,
          duration: 1000,
          easing: Easing.cubic,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [fadeAnim]);

  useEffect(() => {
    const getVersion = async () => {
      const version = await DeviceInfo.getVersion();
      const buildNumber = await DeviceInfo.getBuildNumber();
      setAppVersion(`v${version} (${buildNumber})`);
    };
    getVersion();
  }, []);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 24,
    },
    contentContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      width: '100%',
    },
    heroSection: {
      alignItems: 'center',
      marginBottom: 32,
      paddingHorizontal: 20,
    },
    heroTitle: {
      fontSize: 32,
      fontWeight: '800',
      color: theme.colors.text,
      textAlign: 'center',
      lineHeight: 40,
      letterSpacing: -0.5,
    },
    heroSubtitle: {
      fontSize: 18,
      color: theme.colors.textSecondary,
      fontWeight: '500',
      textAlign: 'center',
      marginTop: 16,
      lineHeight: 24,
      paddingHorizontal: 20,
    },
    logoContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 32,
      padding: 20,
      backgroundColor: 'transparent',
    },
    storeIcon: {
      width: 120,
      height: 120,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary,
      borderRadius: 16,
      paddingVertical: 16,
      paddingHorizontal: 32,
      shadowColor: theme.colors.primary,
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 6,
      marginBottom: 24,
      minWidth: 160,
    },
    buttonText: {
      color: theme.colors.background,
      fontSize: 18,
      fontWeight: '700',
      marginLeft: 12,
      letterSpacing: 0.5,
    },
    icon: {
      width: 24,
      height: 24,
      tintColor: theme.colors.background,
    },
    versionText: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      opacity: 0.8,
      marginBottom: 8,
      fontWeight: '500',
    },
    bottomContainer: {
      alignItems: 'center',
      width: '100%',
    },
    loadingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadingText: {
      color: theme.colors.background,
      fontSize: 16,
      fontWeight: '600',
      marginLeft: 12,
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.contentContainer}>
        {/* Conditionally render hero text based on screen size/orientation */}
        {!isSmallScreen && !isLandscape && (
          <View style={styles.heroSection}>
            <Text style={styles.heroTitle}>
              Seedless.{'\n'}Hardware-Free.{'\n'}Limitless.
            </Text>
          </View>
        )}
        <Animated.View style={[styles.logoContainer, {opacity: fadeAnim}]}>
          <Image
            style={styles.storeIcon}
            source={require('../assets/playstore-icon.png')}
          />
        </Animated.View>
        {!isSmallScreen && !isLandscape && (
          <View style={styles.heroSection}>
            <Text style={styles.heroSubtitle}>
              Roam with Peace of Mind {'\n'}
              Self-Custody Bitcoin Wallet
            </Text>
          </View>
        )}
      </View>
      <View style={styles.bottomContainer}>
        <TouchableOpacity
          style={styles.button}
          onPress={handlePress}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={theme.colors.background} />
              <Text style={styles.loadingText}>Unlocking...</Text>
            </View>
          ) : (
            <>
              <Image
                source={require('../assets/fingerprint.png')}
                style={styles.icon}
              />
              <Text style={styles.buttonText}>Unlock</Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.versionText}>{appVersion}</Text>
      </View>
    </View>
  );
};

export default LoadingScreen;
