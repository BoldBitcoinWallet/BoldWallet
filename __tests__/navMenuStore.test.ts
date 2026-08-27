/**
 * @format
 */

const mockStore: Record<string, string> = {};

jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {
    get: jest.fn((key: string) =>
      Object.prototype.hasOwnProperty.call(mockStore, key)
        ? mockStore[key]
        : null,
    ),
    set: jest.fn((key: string, value: string) => {
      mockStore[key] = value;
    }),
  },
  CONFIG_KEYS: {NAV_MENU_STYLE: 'nav_menu_style'},
}));

import {
  getNavMenuStyle,
  normalizeNavMenuStyle,
  resetNavMenuStyleForTests,
  setNavMenuStyle,
  subscribeNavMenuStyle,
} from '../services/navMenuStore';

describe('navMenuStore', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => {
      delete mockStore[k];
    });
    resetNavMenuStyleForTests();
  });

  it('defaults to floating when the key is absent', () => {
    expect(getNavMenuStyle()).toBe('floating');
  });

  it('treats invalid stored values as floating', () => {
    mockStore.nav_menu_style = 'side';
    expect(getNavMenuStyle()).toBe('floating');
    expect(normalizeNavMenuStyle('side')).toBe('floating');
    expect(normalizeNavMenuStyle(undefined)).toBe('floating');
    expect(normalizeNavMenuStyle('docked')).toBe('docked');
    expect(normalizeNavMenuStyle('floating')).toBe('floating');
  });

  it('persists docked and notifies subscribers', () => {
    const seen: string[] = [];
    const unsub = subscribeNavMenuStyle(v => seen.push(v));
    expect(seen).toEqual(['floating']);
    setNavMenuStyle('docked');
    expect(getNavMenuStyle()).toBe('docked');
    expect(mockStore.nav_menu_style).toBe('docked');
    expect(seen).toEqual(['floating', 'docked']);
    setNavMenuStyle('floating');
    expect(seen).toEqual(['floating', 'docked', 'floating']);
    unsub();
  });

  it('does not notify when the style is unchanged', () => {
    const seen: string[] = [];
    const unsub = subscribeNavMenuStyle(v => seen.push(v));
    setNavMenuStyle('floating');
    expect(seen).toEqual(['floating']);
    unsub();
  });
});
