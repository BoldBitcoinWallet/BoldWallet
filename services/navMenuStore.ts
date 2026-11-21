/**
 * Persisted main-tab layout: floating pill (default) or docked full-width bar.
 */
import {useEffect, useState} from 'react';
import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';

export type NavMenuStyle = 'docked' | 'floating';

type Subscriber = (style: NavMenuStyle) => void;

const subscribers = new Set<Subscriber>();
let cachedStyle: NavMenuStyle | null = null;

export function normalizeNavMenuStyle(
  raw: string | null | undefined,
): NavMenuStyle {
  return raw === 'docked' ? 'docked' : 'floating';
}

function readPersistedStyle(): NavMenuStyle {
  return normalizeNavMenuStyle(
    appConfigRepository.get(CONFIG_KEYS.NAV_MENU_STYLE),
  );
}

function notify(style: NavMenuStyle): void {
  subscribers.forEach(fn => {
    try {
      fn(style);
    } catch {
      // ignore subscriber errors
    }
  });
}

export function getNavMenuStyle(): NavMenuStyle {
  if (cachedStyle === null) {
    cachedStyle = readPersistedStyle();
  }
  return cachedStyle;
}

export function setNavMenuStyle(next: NavMenuStyle): void {
  const style = normalizeNavMenuStyle(next);
  const prev = getNavMenuStyle();
  cachedStyle = style;
  appConfigRepository.set(CONFIG_KEYS.NAV_MENU_STYLE, style);
  if (prev !== style) {
    notify(style);
  }
}

export function subscribeNavMenuStyle(fn: Subscriber): () => void {
  subscribers.add(fn);
  fn(getNavMenuStyle());
  return () => {
    subscribers.delete(fn);
  };
}

export function useNavMenuStyle(): NavMenuStyle {
  const [style, setStyle] = useState(getNavMenuStyle);
  useEffect(() => subscribeNavMenuStyle(setStyle), []);
  return style;
}

/** Route names the main tab bar can show, in the default order. */
export const NAV_TAB_ORDER_DEFAULT = [
  'Device',
  'PSBT',
  'Wallet',
  'Playground',
  'Utxos',
  'Addresses',
  'Settings',
] as const;

export type NavTabName = (typeof NAV_TAB_ORDER_DEFAULT)[number];

const NAV_TAB_NAMES = new Set<string>(NAV_TAB_ORDER_DEFAULT);

export function isNavTabName(name: string): name is NavTabName {
  return NAV_TAB_NAMES.has(name);
}

type OrderSubscriber = (order: NavTabName[]) => void;

const orderSubscribers = new Set<OrderSubscriber>();
let cachedOrder: NavTabName[] | null = null;

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** Keep a stored sequence, then append any tabs it does not mention. */
export function orderFromNames(names: readonly unknown[]): NavTabName[] {
  const seen = new Set<string>();
  const result: NavTabName[] = [];
  for (const name of names) {
    if (typeof name !== 'string' || !isNavTabName(name) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push(name);
  }
  for (const name of NAV_TAB_ORDER_DEFAULT) {
    if (!seen.has(name)) {
      result.push(name);
    }
  }
  return result;
}

export function normalizeNavMenuOrder(
  raw: string | null | undefined,
): NavTabName[] {
  if (raw == null || raw.trim() === '') {
    return orderFromNames([]);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return orderFromNames(Array.isArray(parsed) ? parsed : []);
  } catch {
    return orderFromNames([]);
  }
}

/**
 * Reorder the tabs that are on, and leave switched-off tabs in their slots.
 * `enabledInNewOrder` is the enabled names in the order the user just set.
 */
export function applyEnabledNavOrder(
  full: readonly NavTabName[],
  enabledInNewOrder: readonly string[],
): NavTabName[] {
  const fullSet = new Set<string>(full);
  const seen = new Set<string>();
  const cleaned: NavTabName[] = [];
  for (const name of enabledInNewOrder) {
    if (!fullSet.has(name) || !isNavTabName(name) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    cleaned.push(name);
  }
  const slots: number[] = [];
  full.forEach((name, index) => {
    if (seen.has(name)) {
      slots.push(index);
    }
  });
  if (slots.length !== cleaned.length) {
    return orderFromNames(full);
  }
  const next = [...full];
  slots.forEach((slot, index) => {
    next[slot] = cleaned[index];
  });
  return next;
}

function readPersistedOrder(): NavTabName[] {
  return normalizeNavMenuOrder(
    appConfigRepository.get(CONFIG_KEYS.NAV_MENU_ORDER),
  );
}

function notifyOrder(order: NavTabName[]): void {
  orderSubscribers.forEach(fn => {
    try {
      fn(order);
    } catch {
      // ignore subscriber errors
    }
  });
}

export function getNavMenuOrder(): NavTabName[] {
  if (cachedOrder === null) {
    cachedOrder = readPersistedOrder();
  }
  return cachedOrder;
}

export function setNavMenuOrder(next: readonly string[]): void {
  const order = orderFromNames(next);
  const prev = getNavMenuOrder();
  if (sameOrder(prev, order)) {
    return;
  }
  cachedOrder = order;
  appConfigRepository.set(CONFIG_KEYS.NAV_MENU_ORDER, JSON.stringify(order));
  notifyOrder(order);
}

/** Persist a drag result for the tabs that are currently on. */
export function setEnabledNavMenuOrder(enabledInNewOrder: readonly string[]): void {
  setNavMenuOrder(applyEnabledNavOrder(getNavMenuOrder(), enabledInNewOrder));
}

export function subscribeNavMenuOrder(fn: OrderSubscriber): () => void {
  orderSubscribers.add(fn);
  fn(getNavMenuOrder());
  return () => {
    orderSubscribers.delete(fn);
  };
}

export function useNavMenuOrder(): NavTabName[] {
  const [order, setOrder] = useState(getNavMenuOrder);
  useEffect(() => subscribeNavMenuOrder(setOrder), []);
  return order;
}

/** Test-only: clear in-memory cache and subscribers. */
export function resetNavMenuStyleForTests(): void {
  cachedStyle = null;
  cachedOrder = null;
  subscribers.clear();
  orderSubscribers.clear();
}
