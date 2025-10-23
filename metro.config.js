const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

const config = {
  resolver: {
    sourceExts: ['jsx', 'js', 'ts', 'tsx', 'cjs', 'json', 'mjs'],
  },
  transformer: {
    
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);