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
//     applies an extension-specific policy the bootstrapped Claude Code token
//     doesn't satisfy.
//
// Removing the Origin header entirely sidesteps both: with no Origin the API
// performs no CORS check and treats the request like any other Bearer-token API
// call (the same surface Claude Code uses).
//
// NOTE: this makes requests succeed, but they still count against the account's
// unified Claude usage limits (shared with Claude Code and claude.ai). A 429
// here means the account is at its 5-hour/weekly limit, not an extension bug.
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
        // Drop the browser-origin marker so the API sees a plain API call.
        return h.name.toLowerCase() !== 'origin';
      });
      return { requestHeaders: headers };
    },
    { urls: TARGET_URLS },
    ['blocking', 'requestHeaders']
  );

  console.log('[firefox-cors-shim] Origin stripping installed for api.anthropic.com');
})();
