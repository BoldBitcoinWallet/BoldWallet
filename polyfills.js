// Polyfills for React Native
import { InteractionManager } from 'react-native';
import 'react-native-get-random-values';

// Suppress InteractionManager deprecation warnings
const originalWarn = console.warn;
console.warn = (...args) => {
  const message = args[0];
  if (typeof message === 'string' && message.includes('InteractionManager has been deprecated')) {
    // Suppress this specific warning
    return;
  }
  originalWarn.apply(console, args);
};

// Polyfill requestIdleCallback for React Native
if (typeof global.requestIdleCallback === 'undefined') {
  global.requestIdleCallback = (callback, options = {}) => {
    const timeout = options.timeout || 5000;
    
    return InteractionManager.runAfterInteractions(() => {
      // Use setTimeout to simulate idle callback
      const startTime = Date.now();
      
      const timeoutId = setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => Math.max(0, timeout - (Date.now() - startTime))
        });
      }, 0);
      
      // Return a function to cancel the callback
      return () => clearTimeout(timeoutId);
    });
  };
}

// Polyfill cancelIdleCallback
if (typeof global.cancelIdleCallback === 'undefined') {
  global.cancelIdleCallback = (id) => {
    if (typeof id === 'function') {
      id(); // Call the cancel function
    }
  };
}
