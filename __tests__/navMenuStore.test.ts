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
  CONFIG_KEYS: {
    NAV_MENU_STYLE: 'nav_menu_style',
    NAV_MENU_ORDER: 'nav_menu_order',
  },
}));

import {
  applyEnabledNavOrder,
  getNavMenuOrder,
  getNavMenuStyle,
  NAV_TAB_ORDER_DEFAULT,
  normalizeNavMenuOrder,
  normalizeNavMenuStyle,
  orderFromNames,
  resetNavMenuStyleForTests,
  setEnabledNavMenuOrder,
  setNavMenuStyle,
  subscribeNavMenuOrder,
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

describe('nav menu order', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => {
      delete mockStore[k];
    });
    resetNavMenuStyleForTests();
  });

  it('defaults to the built-in tab order', () => {
    expect(getNavMenuOrder()).toEqual([...NAV_TAB_ORDER_DEFAULT]);
    expect(normalizeNavMenuOrder(null)).toEqual([...NAV_TAB_ORDER_DEFAULT]);
    expect(normalizeNavMenuOrder('not-json')).toEqual([
      ...NAV_TAB_ORDER_DEFAULT,
    ]);
  });

  it('keeps a stored permutation and drops unknown names', () => {
    const stored = [
      'Settings',
      'Wallet',
      'nope',
      'Device',
      'PSBT',
      'Playground',
      'Utxos',
      'Addresses',
    ];
    expect(orderFromNames(stored)).toEqual([
      'Settings',
      'Wallet',
      'Device',
      'PSBT',
      'Playground',
      'Utxos',
      'Addresses',
    ]);
  });

  it('appends tabs missing from a stored list', () => {
    expect(orderFromNames(['Settings', 'Device'])).toEqual([
      'Settings',
      'Device',
      'PSBT',
      'Wallet',
      'Playground',
      'Utxos',
      'Addresses',
    ]);
  });

  it('reorders enabled tabs and leaves disabled ones in place', () => {
    const full = [...NAV_TAB_ORDER_DEFAULT];
    expect(
      applyEnabledNavOrder(full, ['Wallet', 'Device', 'Settings']),
    ).toEqual([
      'Wallet',
      'PSBT',
      'Device',
      'Playground',
      'Utxos',
      'Addresses',
      'Settings',
    ]);
  });

  it('persists an enabled reorder and restores a tab that was off', () => {
    const seen: string[][] = [];
    const unsub = subscribeNavMenuOrder(order => seen.push([...order]));
    setEnabledNavMenuOrder(['Wallet', 'Device', 'Settings']);
    expect(getNavMenuOrder()).toEqual([
      'Wallet',
      'PSBT',
      'Device',
      'Playground',
      'Utxos',
      'Addresses',
      'Settings',
    ]);
    expect(JSON.parse(mockStore.nav_menu_order)).toEqual(getNavMenuOrder());
    expect(seen).toHaveLength(2);
    unsub();
  });

  it('does not notify when the enabled order is unchanged', () => {
    const seen: string[][] = [];
    const unsub = subscribeNavMenuOrder(order => seen.push([...order]));
    setEnabledNavMenuOrder([...NAV_TAB_ORDER_DEFAULT]);
    expect(seen).toHaveLength(1);
    unsub();
  });
});
