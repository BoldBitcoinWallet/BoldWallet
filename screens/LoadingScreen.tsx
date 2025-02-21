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

const LoadingScreen = ({onRetry}: {onRetry: () => void}) => {
  const [loading, setLoading] = useState(false);

  const handlePress = async () => {
    setLoading(true);
    await onRetry(); // Call the authentication function
    setLoading(false);
  };

  const fadeAnim = useRef(new Animated.Value(0.7)).current;

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

  return (
    <View style={styles.container}>
      <Animated.Image
        style={[styles.storeIcon, {opacity: fadeAnim}]}
        source={require('../assets/playstore-icon.png')}
      />
      <TouchableOpacity
        style={styles.button}
        onPress={handlePress}
        disabled={loading}>
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Image
              source={require('../assets/fingerprint.png')} // Add your fingerprint image
              style={styles.icon}
            />
            <Text style={styles.buttonText}>Authorize</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ccc',
    borderRadius: 30,
    paddingVertical: 12,
    paddingHorizontal: 20,
    position: 'absolute',
    bottom: '15%',
    elevation: 2,
    shadowColor: '#000', // iOS shadow
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  buttonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  icon: {
    width: 32,
    height: 32,
  },
  storeIcon: {
    width: 128,
    height: 128,
  },
});

export default LoadingScreen;
