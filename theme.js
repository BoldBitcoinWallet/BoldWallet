// theme.js
import React, {createContext, useContext, useEffect, useState} from 'react';
import EncryptedStorage from 'react-native-encrypted-storage';

export const themes = {
  lightPolished: {
    colors: {
      primary: '#34495e',
      subPrimary: '#033e3e',
      secondary: '#149077',
      danger: '#e74c3c',
      accent: '#f1c40f',
      background: '#ffffff',
      text: '#2c3e50',
      textSecondary: '#6b7280',
      cardBackground: '#f8f9fa',
      disabled: '#cbd5e1',
      border: '#94a3b8',
      textOnPrimary: '#ffffff',
      sent: '#E53935',
      received: '#4CAF50',
      buttonText: '#ffffff',
      disabledText: '#777',
      modalBackdrop: 'rgba(0, 0, 0, 0.8)',
      lightGray: '#777',
      mediumGray: '#666',
      white: '#fff',
      shadowColor: '#000',
    },
    fontSizes: {
      small: 12,
      medium: 14,
      large: 16,
      extraLarge: 18,
    },
    spacing: {
      small: 8,
      medium: 12,
      large: 20,
      extraLarge: 30,
    },
    borderRadius: {
      small: 8,
      medium: 10,
      large: 12,
    },
    shadow: {
      light: {
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
      },
      medium: {
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 2,
      },
    },
  },
  cryptoVibrant: {
    colors: {
      primary: '#1A2B3C',
      secondary: '#00D2B8',
      accent: '#F5A623',
      background: '#FFFFFF',
      text: '#1E293B',
      textSecondary: '#64748B',
      cardBackground: '#F5F7FA',
      subPrimary: '#033e3e',
      danger: '#e74c3c',
      disabled: '#cbd5e1',
      border: '#94a3b8',
      textOnPrimary: '#ffffff',
      sent: '#E53935',
      received: '#4CAF50',
      buttonText: '#ffffff',
      disabledText: '#777',
      modalBackdrop: 'rgba(0, 0, 0, 0.8)',
      lightGray: '#777',
      mediumGray: '#666',
      white: '#fff',
      shadowColor: '#000',
    },
    fontSizes: {
      small: 12,
      medium: 14,
      large: 16,
      extraLarge: 18,
    },
    spacing: {
      small: 8,
      medium: 12,
      large: 20,
      extraLarge: 30,
    },
    borderRadius: {
      small: 8,
      medium: 10,
      large: 12,
    },
    shadow: {
      light: {
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
      },
      medium: {
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 2,
      },
    },
  },
};

const ThemeContext = createContext({
  theme: themes.lightPolished,
  toggleTheme: (isCrypto: boolean) => {},
});

export const ThemeProvider = ({children}: any) => {
  const [theme, setTheme] = useState(themes.lightPolished);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const storedTheme = await EncryptedStorage.getItem('theme');
        console.log('Initial theme loaded:', storedTheme);
        setTheme(
          storedTheme === 'cryptoVibrant'
            ? themes.cryptoVibrant
            : themes.lightPolished,
        );
      } catch (error) {
        console.error('Error loading theme:', error);
        setTheme(themes.lightPolished);
      }
    };
    loadTheme();
  }, []);

  const toggleTheme = async isCrypto => {
    const newTheme = isCrypto ? themes.cryptoVibrant : themes.lightPolished;
    console.log('Toggling to:', isCrypto ? 'cryptoVibrant' : 'lightPolished');
    setTheme(newTheme);
    try {
      await EncryptedStorage.setItem(
        'theme',
        isCrypto ? 'cryptoVibrant' : 'lightPolished',
      );
      console.log('Theme saved successfully');
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  };

  return (
    <ThemeContext.Provider value={{theme, toggleTheme}}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
