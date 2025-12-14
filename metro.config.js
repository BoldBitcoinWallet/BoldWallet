const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const config = {
  resolver: {
    sourceExts: ['jsx', 'js', 'ts', 'tsx', 'cjs', 'json', 'mjs'],
    extraNodeModules: {
      stream: require.resolve('readable-stream'),
    },
  },
  transformer: {
    
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);