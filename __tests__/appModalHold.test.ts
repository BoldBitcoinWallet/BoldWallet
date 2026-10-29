import {shouldHoldIosModal} from '../components/appModalHold';

describe('shouldHoldIosModal', () => {
  const holding = {
    os: 'ios',
    visible: false,
    hasContent: true,
    opened: true,
    presented: false,
  };

  it('holds an iOS modal that closed before present finished', () => {
    expect(shouldHoldIosModal(holding)).toBe(true);
  });

  it('drops the hold when the modal has nothing to show', () => {
    expect(shouldHoldIosModal({...holding, hasContent: false})).toBe(false);
  });

  it('drops the hold after present has finished', () => {
    expect(shouldHoldIosModal({...holding, presented: true})).toBe(false);
  });

  it('does not hold while the modal is open or on Android', () => {
    expect(shouldHoldIosModal({...holding, visible: true})).toBe(false);
    expect(shouldHoldIosModal({...holding, opened: false})).toBe(false);
    expect(shouldHoldIosModal({...holding, os: 'android'})).toBe(false);
  });
});
