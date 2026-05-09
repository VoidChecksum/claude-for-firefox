// Firefox content script compatibility shim — ensures the chrome namespace
// and missing Chrome-only APIs exist so the extension bundle runs cleanly.

(function () {
  'use strict';

  // Ensure chrome === browser in content scripts
  if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
    globalThis.chrome = globalThis.browser;
  }

  // chrome.tabGroups is Chrome-only. Provide the constants content scripts
  // reference so they don't throw on property access.
  if (typeof chrome !== 'undefined' && !chrome.tabGroups) {
    chrome.tabGroups = {
      TAB_GROUP_ID_NONE: -1,
      Color: {
        GREY: 'grey',
        BLUE: 'blue',
        RED: 'red',
        YELLOW: 'yellow',
        GREEN: 'green',
        PINK: 'pink',
        PURPLE: 'purple',
        CYAN: 'cyan',
        ORANGE: 'orange',
      },
    };
  }

  // Stub chrome.sidePanel for content-script contexts
  if (typeof chrome !== 'undefined' && !chrome.sidePanel) {
    chrome.sidePanel = {
      open: function () { return Promise.resolve(); },
      close: function () { return Promise.resolve(); },
      setOptions: function () { return Promise.resolve(); },
      setPanelBehavior: function () { return Promise.resolve(); },
    };
  }
})();
