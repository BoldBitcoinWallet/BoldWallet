import {Platform} from 'react-native';

let ip = '';

export const pinRemoteIP = addr => (ip = addr);

export const getPinnedRemoteIP = () => ip;

export const dbg = (message, ...optionalParams) => {
  let args = optionalParams.length === 0 ? '' : optionalParams;
  if (Platform.OS === 'android') {
    console.log(`[android] ${message}`, args);
  } else if (Platform.OS === 'ios') {
    console.log(`[ios] ${message}`, args);
  } else {
    console.log(message, args);
  }
};
