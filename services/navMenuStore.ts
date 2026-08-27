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

/** Test-only: clear in-memory cache and subscribers. */
export function resetNavMenuStyleForTests(): void {
  cachedStyle = null;
  subscribers.clear();
}
