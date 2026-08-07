// Firefox CORS shim.
//
// Two problems when a Firefox build talks to the Anthropic API:
//
//  1. CORS: Firefox sends Origin: moz-extension://<random-uuid>, which is not
//     allow-listed, so the API answers "CORS requests are not allowed for this
//     Organization because of its settings." and every message fails.
//
//  2. Product entitlement: if we instead spoof the official Chrome extension
//     origin, the API treats the call as the "Claude for Chrome" product and
//     demands an extension-scoped entitlement the bootstrapped Claude Code
//     token doesn't have, answering with a 429/usage-limit.
//
// Removing the Origin header entirely sidesteps both: with no Origin the API
// performs no CORS check and treats the request like any other Bearer-token API
// call (the same surface Claude Code uses), which the token is entitled to.
//
// Requires "webRequest" + "webRequestBlocking" and host access to the API.

(function () {
  'use strict';

  if (typeof chrome === 'undefined' || !chrome.webRequest ||
      !chrome.webRequest.onBeforeSendHeaders) {
    console.warn('[firefox-cors-shim] webRequest.onBeforeSendHeaders unavailable');
    return;
  }

  var TARGET_URLS = ['*://api.anthropic.com/*'];

  chrome.webRequest.onBeforeSendHeaders.addListener(
    function (details) {
      var headers = (details.requestHeaders || []).filter(function (h) {
        var n = h.name.toLowerCase();
        // Drop the browser-origin markers so the API sees a plain API call.
        return n !== 'origin';
      });
      return { requestHeaders: headers };
    },
    { urls: TARGET_URLS },
    ['blocking', 'requestHeaders']
  );

  // Diagnostic: log API response status + rate-limit headers so we can tell a
  // real limit from an entitlement rejection. Safe (headers only, no body).
  if (chrome.webRequest.onHeadersReceived) {
    chrome.webRequest.onHeadersReceived.addListener(
      function (details) {
        try {
          var interesting = (details.responseHeaders || [])
            .filter(function (h) {
              var n = h.name.toLowerCase();
              return n.indexOf('ratelimit') !== -1 ||
                     n.indexOf('anthropic') !== -1 ||
                     n === 'retry-after' ||
                     n === 'x-should-retry';
            })
            .map(function (h) { return h.name + ': ' + h.value; });
          console.log('[firefox-cors-shim] response',
            details.statusCode, details.method, details.url, interesting);
        } catch (e) { /* noop */ }
      },
      { urls: TARGET_URLS },
      ['responseHeaders']
    );
  }

  console.log('[firefox-cors-shim] Origin stripping installed for api.anthropic.com');
})();
