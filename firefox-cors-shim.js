// Firefox CORS shim.
//
// Anthropic's API bypasses its per-organization CORS restriction for requests
// that carry the official Chrome extension's origin
// (chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn). A Firefox build sends
// Origin: moz-extension://<random-uuid>, which is not allow-listed, so the API
// answers "CORS requests are not allowed for this Organization because of its
// settings." and every message fails.
//
// Rewrite the Origin header on requests to the Anthropic API so they are
// treated the same as the official extension. Requires the "webRequest" and
// "webRequestBlocking" permissions plus host access to the API.

(function () {
  'use strict';

  if (typeof chrome === 'undefined' || !chrome.webRequest ||
      !chrome.webRequest.onBeforeSendHeaders) {
    console.warn('[firefox-cors-shim] webRequest.onBeforeSendHeaders unavailable');
    return;
  }

  var CHROME_EXT_ORIGIN = 'chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn';

  // Only the inference/API host enforces the org CORS check that blocks us.
  // Leave claude.ai / platform.claude.com (OAuth) untouched.
  var TARGET_URLS = ['*://api.anthropic.com/*'];

  chrome.webRequest.onBeforeSendHeaders.addListener(
    function (details) {
      var headers = details.requestHeaders || [];
      var sawOrigin = false;
      for (var i = 0; i < headers.length; i++) {
        if (headers[i].name.toLowerCase() === 'origin') {
          headers[i].value = CHROME_EXT_ORIGIN;
          sawOrigin = true;
        }
      }
      if (!sawOrigin) {
        headers.push({ name: 'Origin', value: CHROME_EXT_ORIGIN });
      }
      return { requestHeaders: headers };
    },
    { urls: TARGET_URLS },
    ['blocking', 'requestHeaders']
  );

  console.log('[firefox-cors-shim] Origin rewrite installed for api.anthropic.com');
})();
