// Jest setup: stub browser globals that may be missing in jsdom in CI/Node
if (typeof global.indexedDB === 'undefined') {
  global.indexedDB = {
    open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null }),
  };
}
if (typeof global.window === 'undefined') global.window = global;
if (typeof global.document === 'undefined') global.document = {};
