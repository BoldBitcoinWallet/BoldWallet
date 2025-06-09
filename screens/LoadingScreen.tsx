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
      backgroundColor: theme.colors.white,
      justifyContent: 'space-between', // Ensures button stays at bottom
      alignItems: 'center',
      padding: 20, // Adds padding for small screens
    },
    contentContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    heroSection: {
      alignItems: 'center',
      marginBottom: 20, // Space between text and logo
    },
    heroTitle: {
      fontSize: 28,
      fontWeight: '700',
      color: theme.colors.primary,
      textAlign: 'center',
    },
    heroSubtitle: {
      fontSize: 16,
      color: theme.colors.secondary,
      fontWeight: 'bold',
      textAlign: 'center',
      marginTop: 10,
    },
    storeIcon: {
      width: 128,
      height: 128,
      marginVertical: 20, // Consistent spacing
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.primary,
      borderRadius: 30,
      paddingVertical: 12,
      paddingHorizontal: 20,
      elevation: 2,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.1,
      shadowRadius: 2,
      marginBottom: 20,
    },
    buttonText: {
      color: '#fff',
      fontSize: 20,
      fontWeight: 'bold',
      marginLeft: 16,
    },
    icon: {
      width: 28,
      height: 28,
      tintColor: 'white',
    },
    versionText: {
      color: theme.colors.secondary,
      fontSize: 12,
      opacity: 0.7,
      marginBottom: 10,
    },
    bottomContainer: {
      alignItems: 'center',
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
        <Animated.Image
          style={[styles.storeIcon, {opacity: fadeAnim}]}
          source={require('../assets/playstore-icon.png')}
        />
        {!isSmallScreen && !isLandscape && (
          <View style={styles.heroSection}>
            <Text style={styles.heroSubtitle}>
              Roam the world with Peace of Mind {'\n'}
              Self-Custody Superior ₿itcoin Wallet
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
            <ActivityIndicator size="small" color="#fff" />
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
