jest.mock('@sbaiahmed1/react-native-blur', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    BlurView: ({children, ...props}) =>
      React.createElement(View, props, children),
  };
});
