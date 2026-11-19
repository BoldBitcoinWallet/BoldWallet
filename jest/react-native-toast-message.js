const React = require('react');

function Toast(props) {
  return React.createElement('Toast', props, props.children);
}

Toast.show = jest.fn();
Toast.hide = jest.fn();

function Passthrough(props) {
  return React.createElement('ToastBody', props, props.children);
}

module.exports = Toast;
module.exports.default = Toast;
module.exports.BaseToast = Passthrough;
module.exports.ErrorToast = Passthrough;
module.exports.InfoToast = Passthrough;
module.exports.SuccessToast = Passthrough;
