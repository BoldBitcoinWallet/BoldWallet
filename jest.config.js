module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: [
    '**/__tests__/**/*.test.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/libtss/'],
  modulePathIgnorePatterns: ['<rootDir>/libtss/vendor/'],
  moduleNameMapper: {
    '^react-native-toast-message$':
      '<rootDir>/jest/react-native-toast-message.js',
    '^react-native-haptic-feedback$':
      '<rootDir>/jest/react-native-haptic-feedback.js',
    '^react-native-encrypted-storage$':
      '<rootDir>/jest/react-native-encrypted-storage.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@op-engineering/op-sqlite)/)',
  ],
};
