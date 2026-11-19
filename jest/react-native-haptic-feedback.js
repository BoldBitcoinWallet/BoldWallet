const haptic = {
  trigger: jest.fn(),
};

module.exports = haptic;
module.exports.default = haptic;
module.exports.trigger = haptic.trigger;
