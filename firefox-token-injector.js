/**
 * Firefox Token Lifecycle Manager
 *
 * Solves the OAuth incompatibility where Anthropic's server only accepts
 * chrome-extension:// redirect URIs. Bootstraps tokens from Claude Code's
 * existing session via a bundled JSON file written by the installer.
 *
 * Token storage keys in chrome.storage.local:
 *   accessToken, refreshToken, tokenExpiry
 *
 * Token source file (bundled by installer):
 *   firefox-injected-tokens.json
 */
(function () {
  'use strict';

  // Guard: only activate in Firefox
  if (typeof browser === 'undefined') return;

  const LOG_PREFIX = '[Claude Firefox Token]';
  const TOKEN_FILE = chrome.runtime.getURL('firefox-injected-tokens.json');
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const EXPIRY_BUFFER_MS = 10 * 60 * 1000;   // 10 minutes
  const INITIAL_DELAY_MS = 500;

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function error(...args) {
    console.error(LOG_PREFIX, ...args);
  }

  /**
   * Read tokens from the bundled JSON file written by the installer.
   * Returns { accessToken, refreshToken, tokenExpiry } or null.
   */
  async function readTokenFile() {
    try {
      const resp = await fetch(TOKEN_FILE);
      if (!resp.ok) {
        warn('Token file not found or unreadable:', resp.status);
        return null;
      }
      const data = await resp.json();
      if (!data.accessToken) {
        warn('Token file present but missing accessToken');
        return null;
      }
      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || '',
        tokenExpiry: typeof data.expiresAt === 'number'
          ? data.expiresAt
          : (typeof data.tokenExpiry === 'number' ? data.tokenExpiry : 0),
      };
    } catch (e) {
      warn('Failed to read token file:', e.message);
      return null;
    }
  }

  /**
   * Retrieve current tokens from extension storage.
   */
  function getStoredTokens() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ['accessToken', 'refreshToken', 'tokenExpiry'],
        (result) => resolve(result || {})
      );
    });
  }

  /**
   * Persist tokens into extension storage.
   */
  function storeTokens(tokens) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiry: tokens.tokenExpiry,
        },
        () => {
          log('Tokens written to storage');
          resolve();
        }
      );
    });
  }

  /**
   * Returns true if the stored token is missing or expires within the buffer window.
   */
  function isExpiredOrMissing(stored) {
    if (!stored || !stored.accessToken) return true;
    if (!stored.tokenExpiry) return false; // no expiry info, assume valid
    return Date.now() >= stored.tokenExpiry - EXPIRY_BUFFER_MS;
  }

  /**
   * Try to inject tokens from the bundled file if storage is empty or stale.
   */
  async function ensureTokens() {
    const stored = await getStoredTokens();
    if (!isExpiredOrMissing(stored)) return;

    log(stored.accessToken ? 'Token expiring soon, refreshing from file' : 'No valid token in storage, bootstrapping from file');

    const fileTokens = await readTokenFile();
    if (!fileTokens) {
      warn('Cannot bootstrap tokens -- token file unavailable. Run the installer.');
      return;
    }

    if (!fileTokens.accessToken) {
      warn('Token file has no accessToken');
      return;
    }

    await storeTokens(fileTokens);
    log('Tokens bootstrapped from file');
  }

  // --- Patch chrome.identity.launchWebAuthFlow ---

  if (chrome.identity && typeof chrome.identity.launchWebAuthFlow === 'function') {
    const _originalLaunchWebAuthFlow = chrome.identity.launchWebAuthFlow.bind(chrome.identity);

    chrome.identity.launchWebAuthFlow = function (details, callback) {
      // Support both callback and promise styles
      const isPromise = typeof callback !== 'function';

      const handleResult = async (err) => {
        // Real flow failed -- fall back to token file
        warn('launchWebAuthFlow failed, falling back to token file:', err && err.message);

        const fileTokens = await readTokenFile();

        if (fileTokens && fileTokens.accessToken) {
          await storeTokens(fileTokens);
          log('Tokens refreshed from file after auth flow failure');

          if (details && details.interactive) {
            // Interactive calls expect a redirect URL; we can't synthesize one.
            // Return undefined to signal the caller to re-check storage.
            if (!isPromise) callback(undefined);
            return undefined;
          }

          // Non-interactive (silent refresh): return undefined (silent fail)
          if (!isPromise) callback(undefined);
          return undefined;
        }

        // Token file also unavailable
        if (details && details.interactive) {
          const msg = 'Firefox OAuth redirect not supported by Anthropic. Run the Claude for Firefox installer to refresh tokens.';
          if (!isPromise) {
            chrome.runtime.lastError = { message: msg };
            callback(undefined);
          } else {
            throw new Error(msg);
          }
          return undefined;
        }

        // Non-interactive: silent fail
        if (!isPromise) callback(undefined);
        return undefined;
      };

      // Try the real flow first
      try {
        if (isPromise) {
          return _originalLaunchWebAuthFlow(details)
            .then((redirectUrl) => redirectUrl)
            .catch((err) => handleResult(err));
        }

        _originalLaunchWebAuthFlow(details, (redirectUrl) => {
          if (chrome.runtime.lastError || !redirectUrl) {
            handleResult(chrome.runtime.lastError || new Error('No redirect URL'));
          } else {
            callback(redirectUrl);
          }
        });
      } catch (e) {
        return handleResult(e);
      }
    };

    log('Patched chrome.identity.launchWebAuthFlow');
  }

  // --- Initial bootstrap (delayed) ---

  setTimeout(() => {
    ensureTokens().catch((e) => error('Initial token bootstrap failed:', e.message));
  }, INITIAL_DELAY_MS);

  // --- Periodic refresh ---

  setInterval(() => {
    ensureTokens().catch((e) => error('Periodic token check failed:', e.message));
  }, REFRESH_INTERVAL_MS);

  log('Token lifecycle manager initialized');
})();
