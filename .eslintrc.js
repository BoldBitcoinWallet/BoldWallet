module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: ['jest.setup.js', 'jest/**/*.js'],
      env: {jest: true},
    },
  ],
};
