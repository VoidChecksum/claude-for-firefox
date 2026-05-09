// Firefox background script entry point — ES module loader
// Imports shims and patches before the main service worker bundle.

import './firefox-compat.js';
import './firefox-offscreen-shim.js';
import './firefox-oauth-interceptor.js';
import './firefox-token-injector.js';
import './firefox-action-handler.js';
import './assets/service-worker.ts-gaAAsstG.js';
