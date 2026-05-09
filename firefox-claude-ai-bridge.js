// Firefox claude.ai bridge — replaces Chrome's externally_connectable.
// Listens for window.postMessage from the page, forwards to the extension
// background via chrome.runtime.sendMessage, and sends responses back.
// Also injects a small page-context script that exposes the messaging API.

(function () {
  'use strict';

  var EXTENSION_ID = chrome.runtime.id;
  var MSG_PREFIX = '__claude_firefox_ext_';
  var MSG_REQUEST = MSG_PREFIX + 'request';
  var MSG_RESPONSE = MSG_PREFIX + 'response';
  var MSG_EVENT = MSG_PREFIX + 'event';

  // ------------------------------------------------------------------
  // 1. Inject page-context script that the claude.ai page can call
  // ------------------------------------------------------------------
  function injectPageScript() {
    var code = [
      '(function(){',
      '  "use strict";',
      '  var MSG_REQUEST = "' + MSG_REQUEST + '";',
      '  var MSG_RESPONSE = "' + MSG_RESPONSE + '";',
      '  var MSG_EVENT = "' + MSG_EVENT + '";',
      '  var pending = {};',
      '  var reqId = 0;',
      '',
      '  function sendMessage(message) {',
      '    return new Promise(function(resolve, reject) {',
      '      var id = ++reqId;',
      '      pending[id] = { resolve: resolve, reject: reject };',
      '      window.postMessage({',
      '        type: MSG_REQUEST,',
      '        id: id,',
      '        payload: message',
      '      }, "*");',
      '      setTimeout(function() {',
      '        if (pending[id]) {',
      '          pending[id].reject(new Error("Extension message timeout"));',
      '          delete pending[id];',
      '        }',
      '      }, 30000);',
      '    });',
      '  }',
      '',
      '  window.addEventListener("message", function(ev) {',
      '    if (!ev.data || ev.source !== window) return;',
      '    if (ev.data.type === MSG_RESPONSE && pending[ev.data.id]) {',
      '      if (ev.data.error) {',
      '        pending[ev.data.id].reject(new Error(ev.data.error));',
      '      } else {',
      '        pending[ev.data.id].resolve(ev.data.payload);',
      '      }',
      '      delete pending[ev.data.id];',
      '    }',
      '  });',
      '',
      '  window.__claudeFirefoxExtension = {',
      '    sendMessage: sendMessage,',
      '    extensionId: "' + EXTENSION_ID + '"',
      '  };',
      '',
      '  window.dispatchEvent(new CustomEvent("claude-extension-available", {',
      '    detail: { extensionId: "' + EXTENSION_ID + '" }',
      '  }));',
      '})();',
    ].join('\n');

    var script = document.createElement('script');
    script.textContent = code;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  // ------------------------------------------------------------------
  // 2. Listen for messages from the page and forward to background
  // ------------------------------------------------------------------
  window.addEventListener('message', function (ev) {
    if (!ev.data || ev.source !== window || ev.data.type !== MSG_REQUEST) {
      return;
    }

    var requestId = ev.data.id;
    var payload = ev.data.payload;

    // Tag the message so the background knows it came from claude.ai
    var bgMessage = Object.assign({}, payload, {
      _source: 'claude_ai_bridge',
    });

    chrome.runtime.sendMessage(bgMessage, function (response) {
      var error = chrome.runtime.lastError;
      window.postMessage({
        type: MSG_RESPONSE,
        id: requestId,
        payload: error ? undefined : response,
        error: error ? error.message : undefined,
      }, '*');
    });
  });

  // ------------------------------------------------------------------
  // 3. Forward events from background to the page
  // ------------------------------------------------------------------
  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message && message._target === 'claude_ai_page') {
      window.postMessage({
        type: MSG_EVENT,
        payload: message,
      }, '*');
      sendResponse({ received: true });
      return false;
    }
    return false;
  });

  // ------------------------------------------------------------------
  // 4. Inject the page script once DOM is ready
  // ------------------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPageScript);
  } else {
    injectPageScript();
  }
})();
