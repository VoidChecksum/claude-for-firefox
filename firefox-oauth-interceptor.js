// Firefox OAuth interceptor — redirects navigations targeting
// chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/* to the equivalent
// moz-extension:// URL so OAuth callbacks and deep-links work.

(function () {
  'use strict';

  var CHROME_EXT_ORIGIN = 'chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn';
  var MOZ_EXT_ORIGIN = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
    ? chrome.runtime.getURL('').replace(/\/$/, '')
    : '';

  if (!MOZ_EXT_ORIGIN) {
    console.warn('[firefox-oauth-interceptor] Cannot determine own extension origin');
    return;
  }

  if (typeof chrome === 'undefined' || !chrome.webNavigation ||
      !chrome.webNavigation.onBeforeNavigate) {
    // webNavigation API unavailable — nothing to intercept
    return;
  }

  chrome.webNavigation.onBeforeNavigate.addListener(function (details) {
    if (!details || !details.url) return;

    if (details.url.indexOf(CHROME_EXT_ORIGIN) !== 0) return;

    var suffix = details.url.slice(CHROME_EXT_ORIGIN.length);
    var redirectUrl = MOZ_EXT_ORIGIN + suffix;

    chrome.tabs.update(details.tabId, { url: redirectUrl }).catch(function (err) {
      console.warn('[firefox-oauth-interceptor] Redirect failed:', err.message);
    });
  });
})();
