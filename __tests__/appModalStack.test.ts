import {
  hasOpenAppModal,
  isTopAppModal,
  popAppModal,
  pushAppModal,
  resetAppModalStackForTests,
} from '../components/appModalStack';

describe('appModalStack', () => {
  afterEach(() => {
    resetAppModalStackForTests();
  });

  it('treats the last opened modal as the one that can host a prompt', () => {
    const send = pushAppModal();
    const scanner = pushAppModal();
    expect(hasOpenAppModal()).toBe(true);
    expect(isTopAppModal(scanner)).toBe(true);
    expect(isTopAppModal(send)).toBe(false);
    popAppModal(scanner);
    expect(isTopAppModal(send)).toBe(true);
    popAppModal(send);
    expect(hasOpenAppModal()).toBe(false);
  });
});
