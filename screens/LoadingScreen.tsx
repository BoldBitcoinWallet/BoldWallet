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
} from 'react-native';
import {useTheme} from '../theme';
import {HapticFeedback} from '../utils';
import DeviceInfo from 'react-native-device-info';

const LoadingScreen = ({onRetry}: any) => {
  const {theme} = useTheme();
  const [appVersion, setAppVersion] = useState('');

  const [loading, setLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0.6)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const iconPulse = useRef(new Animated.Value(1)).current;

  const handlePress = async () => {
    HapticFeedback.medium();
    setLoading(true);
    await onRetry();
    setLoading(false);
  };

  const handlePressIn = () => {
    Animated.spring(buttonScale, {
      toValue: 0.97,
      useNativeDriver: true,
      friction: 6,
      tension: 200,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(buttonScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 6,
      tension: 200,
    }).start();
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

  // Subtle fingerprint pulse when idle
  useEffect(() => {
    if (loading) {
      iconPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(iconPulse, {
          toValue: 1.08,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(iconPulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [iconPulse, loading]);

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
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderRadius: 16,
      paddingVertical: 16,
      paddingHorizontal: 32,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.25)',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 10},
      shadowOpacity: 0.25,
      shadowRadius: 20,
      elevation: 6,
      marginBottom: 24,
      minWidth: 160,
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    buttonText: {
      color: theme.colors.primary,
      fontSize: 18,
      fontWeight: '700',
      marginLeft: 12,
      letterSpacing: 0.5,
    },
    iconWrapper: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    icon: {
      width: 40,
      height: 40,
      tintColor: theme.colors.white || '#FFFFFF',
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
        <Animated.View style={[styles.logoContainer, {opacity: fadeAnim}]}>
          <Image
            style={styles.storeIcon}
            source={require('../assets/playstore-icon.png')}
          />
        </Animated.View>
      </View>
      <View style={styles.bottomContainer}>
        <Animated.View style={{transform: [{scale: buttonScale}]}}>
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Unlock with biometrics"
            accessibilityHint="Double tap to authenticate and unlock"
            testID="unlock-biometric-button"
          >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={theme.colors.background} />
              <Text style={styles.loadingText}>Unlocking...</Text>
            </View>
          ) : (
            <>
              <View style={styles.iconWrapper}>
                <Animated.Image
                  source={require('../assets/fingerprint.png')}
                  style={[styles.icon, {transform: [{scale: iconPulse}]}]}
                />
              </View>
            </>
          )}
          </TouchableOpacity>
        </Animated.View>
        <Text style={styles.versionText}>{appVersion}</Text>
      </View>
    </View>
  );
};

export default LoadingScreen;
