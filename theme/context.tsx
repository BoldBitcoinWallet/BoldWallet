/**
 * Theme Context and Provider
 * React context for theme management
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import {Appearance, ColorSchemeName} from 'react-native';
import appConfigRepository, {CONFIG_KEYS} from '../services/repositories/AppConfigRepository';
import {dbg} from '../utils';
import type {Theme, ThemeMode, ThemeContextValue} from './types';
import {lightTheme, darkTheme} from './themes';
// Default context value - ensures theme always exists
const defaultContextValue: ThemeContextValue = {
  theme: lightTheme,
  themeMode: 'os',
  setThemeMode: async (_mode: ThemeMode) => {
    dbg('setThemeMode called outside ThemeProvider');
  },
  toggleTheme: async (_isCrypto?: boolean) => {
    dbg('toggleTheme called outside ThemeProvider');
  },
};
const ThemeContext = createContext<ThemeContextValue>(defaultContextValue);
interface ThemeProviderProps {
  children: ReactNode;
}
/**
 * ThemeProvider - Provides theme context to the app
 * Handles theme mode persistence and system theme detection
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({children}) => {
  // Get initial system color scheme synchronously
  const initialSystemScheme: ColorSchemeName =
    Appearance.getColorScheme() || 'light';
  const [systemColorScheme, setSystemColorScheme] =
    useState<ColorSchemeName>(initialSystemScheme);
  // Default to dark theme to prevent white flash for dark mode users
  // This will be corrected when storage loads
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');
  const [theme, setTheme] = useState<Theme>(() => darkTheme);
  // Listen to system color scheme changes
  useEffect(() => {
    const subscription = Appearance.addChangeListener(
      ({colorScheme}: {colorScheme: ColorSchemeName}) => {
        setSystemColorScheme(colorScheme || 'light');
      },
    );
    return () => subscription?.remove();
  }, []);
  // Determine effective theme based on mode
  const getEffectiveTheme = useCallback(
    (
      mode: ThemeMode,
      currentSystemScheme: ColorSchemeName = systemColorScheme,
    ): Theme => {
      if (mode === 'light') {
        return lightTheme;
      } else if (mode === 'dark') {
        return darkTheme;
      } else {
        // OS default mode - fallback to light if systemColorScheme is null/undefined
        const isDark = currentSystemScheme === 'dark';
        return isDark ? darkTheme : lightTheme;
      }
    },
    [systemColorScheme],
  );
  // Load theme mode from storage IMMEDIATELY and update theme right away
  useEffect(() => {
    const loadThemeMode = () => {
      try {
        const storedMode = appConfigRepository.get(CONFIG_KEYS.THEME_MODE);
        if (
          storedMode === 'os' ||
          storedMode === 'light' ||
          storedMode === 'dark'
        ) {
          const mode = storedMode as ThemeMode;
          setThemeModeState(mode);
          const effectiveTheme = getEffectiveTheme(mode, initialSystemScheme);
          setTheme(effectiveTheme);
          dbg('Theme mode loaded:', mode);
        } else {
          setThemeModeState('os');
          const osTheme =
            initialSystemScheme === 'dark' ? darkTheme : lightTheme;
          setTheme(osTheme);
          dbg('Using default OS theme mode');
        }
      } catch (error) {
        dbg('Error loading theme mode:', error);
        setThemeModeState('os');
        const osTheme =
          initialSystemScheme === 'dark' ? darkTheme : lightTheme;
        setTheme(osTheme);
      }
    };
    loadThemeMode();
  }, [getEffectiveTheme, initialSystemScheme]);
  // Update theme when mode or system color scheme changes
  useEffect(() => {
    const effectiveTheme = getEffectiveTheme(themeMode);
    setTheme(effectiveTheme);
    const effectiveScheme = systemColorScheme || 'light';
    dbg('Theme updated:', themeMode, 'effective:', effectiveScheme);
  }, [themeMode, systemColorScheme, getEffectiveTheme]);
  const setThemeMode = useCallback(
    async (mode: ThemeMode) => {
      setThemeModeState(mode);
      try {
        appConfigRepository.set(CONFIG_KEYS.THEME_MODE, mode);
        dbg('Theme mode saved:', mode);
      } catch (error) {
        dbg('Error saving theme mode:', error);
      }
    },
    [],
  );
  // Legacy support for toggleTheme
  const toggleTheme = useCallback(
    async (_isCrypto?: boolean) => {
      // For backward compatibility, this now just sets to light mode
      await setThemeMode('light');
    },
    [setThemeMode],
  );
  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme: theme ?? lightTheme,
      themeMode: themeMode ?? 'os',
      setThemeMode: setThemeMode,
      toggleTheme: toggleTheme,
    }),
    [theme, themeMode, setThemeMode, toggleTheme],
  );
  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};
/**
 * useTheme hook - Access theme context
 * @returns Theme context value
 */
export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  // If context is null/undefined (shouldn't happen with default value, but safety check)
  if (!context) {
    dbg('useTheme called outside ThemeProvider, using default theme');
    return defaultContextValue;
  }
  // Ensure theme always exists to prevent "Property 'theme' doesn't exist" errors
  if (!context.theme) {
    dbg('Theme context missing theme property, using lightTheme fallback');
    return {
      ...defaultContextValue,
      ...context,
      theme: lightTheme,
    };
  }
  // Ensure all required properties exist
  return {
    theme: context.theme ?? lightTheme,
    themeMode: context.themeMode ?? 'os',
    setThemeMode: context.setThemeMode ?? defaultContextValue.setThemeMode,
    toggleTheme: context.toggleTheme ?? defaultContextValue.toggleTheme,
  };
};
