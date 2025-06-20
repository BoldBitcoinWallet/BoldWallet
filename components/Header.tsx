import React from 'react';
import {Text, TouchableOpacity} from 'react-native';
import {Image} from 'react-native';
import {View} from 'react-native';
import {useTheme} from '../theme';
import {createStyles} from './Styles';
import {HapticFeedback} from '../utils';

export const HeaderRightButton: React.FC<{navigation: any}> = ({
  navigation,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);

  return (
    <TouchableOpacity
      style={[styles.settingsButton]}
      onPress={() => {
        HapticFeedback.light();
        navigation.navigate('Settings');
      }}>
      <Image
        source={require('../assets/settings-icon.png')}
        style={styles.settingsLogo}
      />
    </TouchableOpacity>
  );
};

export const HeaderTitle: React.FC = () => {
  const {theme} = useTheme();
  const styles = createStyles(theme);

  return (
    <View style={styles.headerTitleContainer}>
      <Image source={require('../assets/icon.png')} style={styles.headerLogo} />
      <Text style={styles.headerTitleText}>Bold Home</Text>
    </View>
  );
};
