import React from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';

const LoadingScreen = ({onRetry}: {onRetry: () => void}) => {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#0000ff" />
      <Text>Loading...</Text>

      {/* Touchable Opacity for the button with image */}
      <TouchableOpacity style={styles.button} onPress={onRetry}>
        <Image
          source={require('../assets/fingerprint.png')} // Add your fingerprint image here
          style={styles.icon}
        />
        <Text style={styles.buttonText}>Authorize</Text>
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
    borderRadius: 25,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 100,
  },
  buttonText: {
    color: '#000',
    fontSize: 16,
    marginLeft: 10,
  },
  icon: {
    width: 20,
    height: 20, // Adjust size as needed
  },
});

export default LoadingScreen;
