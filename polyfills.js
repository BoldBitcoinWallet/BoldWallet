// Polyfills for React Native
// IMPORTANT: These must be set BEFORE any other imports that use them

// Buffer polyfill for libraries that use Node.js Buffer (e.g., bc-ur)
const {Buffer} = require('buffer');
global.Buffer = global.Buffer || Buffer;

// Branta SDK AES helpers use btoa/atob. Some Hermes builds omit them;
// without these, ZK decrypt silently fails and SDK 4.x returns unknown.
if (typeof global.btoa !== 'function') {
  global.btoa = value =>
    Buffer.from(String(value), 'binary').toString('base64');
}
if (typeof global.atob !== 'function') {
  global.atob = value =>
    Buffer.from(String(value), 'base64').toString('binary');
}

// Branta AES decrypt ends in `new TextDecoder().decode(...)`. Hermes on this
// RN build has TextEncoder but not TextDecoder, so a successful decrypt still
// throws and SDK 4.x reports unknown (no merchant card).
if (typeof global.TextEncoder !== 'function') {
  global.TextEncoder = class TextEncoder {
    encode(value) {
      return new Uint8Array(Buffer.from(String(value), 'utf8'));
    }
  };
}
if (typeof global.TextDecoder !== 'function') {
  global.TextDecoder = class TextDecoder {
    decode(input) {
      if (input == null) {
        return '';
      }
      const bytes =
        input instanceof Uint8Array ? input : new Uint8Array(input);
      return Buffer.from(bytes).toString('utf8');
    }
  };
}

// Stream polyfill for libraries that use Node.js stream (e.g., cipher-base)
const stream = require('readable-stream');
if (typeof global.stream === 'undefined') {
  global.stream = stream;
}

// Now we can import other modules
import {InteractionManager} from 'react-native';
import 'react-native-get-random-values';

// Suppress InteractionManager deprecation warnings
const originalWarn = console.warn;
console.warn = (...args) => {
  const message = args[0];
  if (
    typeof message === 'string' &&
    message.includes('InteractionManager has been deprecated')
  ) {
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
          timeRemaining: () => Math.max(0, timeout - (Date.now() - startTime)),
        });
      }, 0);

      // Return a function to cancel the callback
      return () => clearTimeout(timeoutId);
    });
  };
}

// Polyfill cancelIdleCallback
if (typeof global.cancelIdleCallback === 'undefined') {
  global.cancelIdleCallback = id => {
    if (typeof id === 'function') {
      id(); // Call the cancel function
    }
  };
}

global.theme = {
  colors: {},
};
