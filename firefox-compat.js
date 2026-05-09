/**
 * Firefox API Compatibility Layer for Claude Browser Extension
 * Loaded FIRST in every extension page context.
 * Shims Chrome-only APIs so bundled Chrome JS runs unmodified on Firefox.
 */
(function () {
  'use strict';

  // Guard: skip entirely if running in actual Chrome
  if (typeof browser === 'undefined') return;

  const TAG = '[Claude Firefox]';
  const STORAGE_KEY = '_ffTabGroups';
  const TAB_GROUP_ID_NONE = -1;

  // ─── Utility ──────────────────────────────────────────────────────
  /** Wrap a browser.* promise-based API as a Chrome callback-style API */
  function promiseToCallback(fn) {
    return function (...args) {
      const last = args[args.length - 1];
      const cb = typeof last === 'function' ? args.pop() : null;
      const p = fn.apply(this, args);
      if (cb) {
        p.then(r => cb(r), e => { chrome.runtime.lastError = e; cb(undefined); });
      }
      return p;
    };
  }

  /** Minimal chrome.Event stub */
  function makeEvent() {
    const listeners = new Set();
    return {
      addListener(fn) { listeners.add(fn); },
      removeListener(fn) { listeners.delete(fn); },
      hasListener(fn) { return listeners.has(fn); },
      hasListeners() { return listeners.size > 0; },
      _fire(...args) { for (const fn of listeners) { try { fn(...args); } catch (_) { /* swallow */ } } },
    };
  }

  // ─── 1. chrome.sidePanel → browser.sidebarAction ──────────────────
  if (typeof chrome.sidePanel === 'undefined' && browser.sidebarAction) {
    chrome.sidePanel = {
      setOptions(opts, cb) {
        const work = async () => {
          if (opts && opts.path) {
            await browser.sidebarAction.setPanel({ panel: opts.path, tabId: opts.tabId });
          }
          if (opts && typeof opts.enabled === 'boolean') {
            // Firefox doesn't have per-tab enable, but we can set title to signal
          }
        };
        const p = work();
        if (cb) p.then(() => cb(), e => { chrome.runtime.lastError = e; cb(); });
        return p;
      },
      open(opts, cb) {
        // browser.sidebarAction.open() requires user gesture in Firefox
        const p = browser.sidebarAction.open().catch(() => {
          // toggle is available in older Firefox
          if (browser.sidebarAction.toggle) return browser.sidebarAction.toggle();
        });
        if (cb) p.then(() => cb(), e => { chrome.runtime.lastError = e; cb(); });
        return p;
      },
      close(opts, cb) {
        const p = browser.sidebarAction.close ? browser.sidebarAction.close() : Promise.resolve();
        if (cb) p.then(() => cb(), e => { chrome.runtime.lastError = e; cb(); });
        return p;
      },
      getOptions(opts, cb) {
        const result = { enabled: true };
        if (cb) cb(result);
        return Promise.resolve(result);
      },
      setPanelBehavior(behavior, cb) {
        // Chrome MV3 concept, no Firefox equivalent
        if (cb) cb();
        return Promise.resolve();
      },
    };
  }

  // ─── 2. chrome.tabGroups polyfill ─────────────────────────────────
  const TAB_GROUP_COLORS = Object.freeze([
    'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange',
  ]);

  // In-memory group cache: groupId → { id, title, color, collapsed, windowId }
  let groupCache = new Map();
  // tabId → groupId
  let tabGroupMap = new Map();
  let nextGroupId = 1;
  let cacheLoaded = false;

  async function loadGroupCache() {
    if (cacheLoaded) return;
    try {
      const data = await browser.storage.local.get(STORAGE_KEY);
      const saved = data[STORAGE_KEY];
      if (saved) {
        groupCache = new Map(saved.groups || []);
        tabGroupMap = new Map(saved.tabMap || []);
        nextGroupId = saved.nextId || 1;
      }
    } catch (_) { /* first run, empty cache */ }
    cacheLoaded = true;
  }

  async function persistGroupCache() {
    try {
      await browser.storage.local.set({
        [STORAGE_KEY]: {
          groups: [...groupCache.entries()],
          tabMap: [...tabGroupMap.entries()],
          nextId: nextGroupId,
        },
      });
    } catch (_) { /* best-effort */ }
  }

  function makeGroup(windowId) {
    const id = nextGroupId++;
    const group = { id, title: '', color: 'grey', collapsed: false, windowId: windowId || -1 };
    groupCache.set(id, group);
    return group;
  }

  function matchesQuery(group, query) {
    if (!query) return true;
    if (query.collapsed !== undefined && group.collapsed !== query.collapsed) return false;
    if (query.color !== undefined && group.color !== query.color) return false;
    if (query.title !== undefined && group.title !== query.title) return false;
    if (query.windowId !== undefined && query.windowId !== -2 && group.windowId !== query.windowId) return false;
    return true;
  }

  chrome.tabGroups = {
    TAB_GROUP_ID_NONE,
    Color: TAB_GROUP_COLORS.reduce((o, c) => { o[c.toUpperCase()] = c; return o; }, {}),

    get: promiseToCallback(async function (groupId) {
      await loadGroupCache();
      const g = groupCache.get(groupId);
      if (!g) throw new Error(`No group with id: ${groupId}`);
      return { ...g };
    }),

    query: promiseToCallback(async function (queryInfo) {
      await loadGroupCache();
      const results = [];
      for (const g of groupCache.values()) {
        if (matchesQuery(g, queryInfo)) results.push({ ...g });
      }
      return results;
    }),

    update: promiseToCallback(async function (groupId, updateProperties) {
      await loadGroupCache();
      const g = groupCache.get(groupId);
      if (!g) throw new Error(`No group with id: ${groupId}`);
      if (updateProperties.title !== undefined) g.title = updateProperties.title;
      if (updateProperties.color !== undefined) g.color = updateProperties.color;
      if (updateProperties.collapsed !== undefined) g.collapsed = updateProperties.collapsed;
      groupCache.set(groupId, g);
      await persistGroupCache();
      return { ...g };
    }),

    move: promiseToCallback(async function (groupId, moveProperties) {
      await loadGroupCache();
      const g = groupCache.get(groupId);
      if (!g) throw new Error(`No group with id: ${groupId}`);
      if (moveProperties && moveProperties.windowId !== undefined) g.windowId = moveProperties.windowId;
      groupCache.set(groupId, g);
      await persistGroupCache();
      return { ...g };
    }),

    onCreated: makeEvent(),
    onUpdated: makeEvent(),
    onRemoved: makeEvent(),
    onMoved: makeEvent(),
  };

  // Patch chrome.tabs.group
  const origTabsGroup = chrome.tabs.group;
  chrome.tabs.group = promiseToCallback(async function (options) {
    await loadGroupCache();
    let groupId = options.groupId;
    if (groupId === undefined || groupId === null) {
      const tabIds = Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds];
      let windowId = -1;
      if (tabIds.length > 0) {
        try {
          const t = await browser.tabs.get(tabIds[0]);
          windowId = t.windowId;
        } catch (_) { /* fallback */ }
      }
      const g = makeGroup(windowId);
      groupId = g.id;
      chrome.tabGroups.onCreated._fire({ ...g });
    }
    const tabIds = Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds];
    for (const tid of tabIds) {
      tabGroupMap.set(tid, groupId);
    }
    await persistGroupCache();
    return groupId;
  });

  // Patch chrome.tabs.ungroup
  const origTabsUngroup = chrome.tabs.ungroup;
  chrome.tabs.ungroup = promiseToCallback(async function (tabIds) {
    await loadGroupCache();
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    for (const tid of ids) {
      tabGroupMap.delete(tid);
    }
    // Clean up empty groups
    const usedGroups = new Set(tabGroupMap.values());
    for (const gid of [...groupCache.keys()]) {
      if (!usedGroups.has(gid)) {
        const removed = groupCache.get(gid);
        groupCache.delete(gid);
        if (removed) chrome.tabGroups.onRemoved._fire({ ...removed });
      }
    }
    await persistGroupCache();
  });

  // Patch chrome.tabs.get to include groupId
  const origTabsGet = chrome.tabs.get.bind(chrome.tabs);
  chrome.tabs.get = promiseToCallback(async function (tabId) {
    const tab = await browser.tabs.get(tabId);
    await loadGroupCache();
    tab.groupId = tabGroupMap.get(tabId) ?? TAB_GROUP_ID_NONE;
    return tab;
  });

  // Patch chrome.tabs.query to include groupId and support groupId filter
  const origTabsQuery = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = promiseToCallback(async function (queryInfo) {
    const filterGroupId = queryInfo ? queryInfo.groupId : undefined;
    const cleanQuery = { ...queryInfo };
    delete cleanQuery.groupId;
    const tabs = await browser.tabs.query(cleanQuery);
    await loadGroupCache();
    for (const tab of tabs) {
      tab.groupId = tabGroupMap.get(tab.id) ?? TAB_GROUP_ID_NONE;
    }
    if (filterGroupId !== undefined) {
      return tabs.filter(t => t.groupId === filterGroupId);
    }
    return tabs;
  });

  // Auto-cleanup when tabs are removed
  if (browser.tabs && browser.tabs.onRemoved) {
    browser.tabs.onRemoved.addListener(async (tabId) => {
      await loadGroupCache();
      if (tabGroupMap.has(tabId)) {
        const gid = tabGroupMap.get(tabId);
        tabGroupMap.delete(tabId);
        // Remove group if now empty
        const usedGroups = new Set(tabGroupMap.values());
        if (!usedGroups.has(gid)) {
          const removed = groupCache.get(gid);
          groupCache.delete(gid);
          if (removed) chrome.tabGroups.onRemoved._fire({ ...removed });
        }
        await persistGroupCache();
      }
    });
  }

  // ─── 3. chrome.offscreen ──────────────────────────────────────────
  if (typeof chrome.offscreen === 'undefined') {
    chrome.offscreen = {
      Reason: Object.freeze({
        TESTING: 'TESTING',
        AUDIO_PLAYBACK: 'AUDIO_PLAYBACK',
        IFRAME_SCRIPTING: 'IFRAME_SCRIPTING',
        DOM_SCRAPING: 'DOM_SCRAPING',
        BLOBS: 'BLOBS',
        DOM_PARSER: 'DOM_PARSER',
        USER_MEDIA: 'USER_MEDIA',
        DISPLAY_MEDIA: 'DISPLAY_MEDIA',
        WEB_RTC: 'WEB_RTC',
        CLIPBOARD: 'CLIPBOARD',
        LOCAL_STORAGE: 'LOCAL_STORAGE',
        WORKERS: 'WORKERS',
        BATTERY_STATUS: 'BATTERY_STATUS',
        MATCH_MEDIA: 'MATCH_MEDIA',
        GEOLOCATION: 'GEOLOCATION',
      }),
      createDocument(params, cb) {
        // Firefox background pages have full DOM access; no-op
        if (cb) cb();
        return Promise.resolve();
      },
      hasDocument(cb) {
        // Always report true — Firefox background can do what offscreen does
        if (cb) cb(true);
        return Promise.resolve(true);
      },
      closeDocument(cb) {
        if (cb) cb();
        return Promise.resolve();
      },
    };
  }

  // ─── 4. chrome.identity bridge ────────────────────────────────────
  if (typeof chrome.identity === 'undefined' || !chrome.identity.getRedirectURL) {
    const existing = chrome.identity || {};
    chrome.identity = {
      ...existing,
      getRedirectURL(path) {
        if (browser.identity && browser.identity.getRedirectURL) {
          return browser.identity.getRedirectURL(path || '');
        }
        // Fallback: construct a plausible redirect URL
        const extId = browser.runtime.id || 'claude-for-firefox';
        const base = `https://${extId}.extensions.allizom.org/`;
        return path ? base + path : base;
      },
      launchWebAuthFlow: promiseToCallback(async function (details) {
        if (browser.identity && browser.identity.launchWebAuthFlow) {
          return browser.identity.launchWebAuthFlow(details);
        }
        throw new Error('identity.launchWebAuthFlow not available');
      }),
      getAuthToken: promiseToCallback(async function (details) {
        // Chrome-specific; Firefox uses launchWebAuthFlow instead
        throw new Error('getAuthToken is Chrome-only; use launchWebAuthFlow or native messaging');
      }),
      removeCachedAuthToken: promiseToCallback(async function (details) {
        // No-op on Firefox
        return {};
      }),
      getProfileUserInfo: promiseToCallback(async function (details) {
        // Chrome-specific
        return { email: '', id: '' };
      }),
    };
  }

  // ─── 5. chrome.debugger shim ──────────────────────────────────────
  if (typeof chrome.debugger === 'undefined') {
    const debuggerSessions = new Map(); // tabId → true

    chrome.debugger = {
      onEvent: makeEvent(),
      onDetach: makeEvent(),

      attach: promiseToCallback(async function (target, requiredVersion) {
        if (target && target.tabId != null) {
          debuggerSessions.set(target.tabId, true);
        }
        // Firefox doesn't have chrome.debugger; best-effort attach
      }),

      detach: promiseToCallback(async function (target) {
        if (target && target.tabId != null) {
          debuggerSessions.delete(target.tabId);
          chrome.debugger.onDetach._fire(target, 'canceled_by_user');
        }
      }),

      sendCommand: promiseToCallback(async function (target, method, commandParams) {
        const tabId = target && target.tabId;
        if (tabId == null) throw new Error('debugger.sendCommand requires target.tabId');

        // Limited method support via scripting / tabs APIs
        if (method === 'Runtime.evaluate') {
          const expr = commandParams && commandParams.expression;
          if (!expr) return { result: { type: 'undefined' } };
          try {
            const results = await browser.scripting.executeScript({
              target: { tabId },
              func: new Function('return (' + expr + ')'),
              world: 'MAIN',
            });
            const value = results && results[0] && results[0].result;
            return {
              result: {
                type: typeof value,
                value,
                description: String(value),
              },
            };
          } catch (e) {
            return {
              result: { type: 'object', subtype: 'error', description: e.message },
              exceptionDetails: { text: e.message },
            };
          }
        }

        if (method === 'Page.captureScreenshot') {
          try {
            const dataUrl = await browser.tabs.captureTab(tabId, {
              format: (commandParams && commandParams.format) || 'png',
            });
            // Strip "data:image/...;base64," prefix
            const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
            return { data: base64 };
          } catch (e) {
            throw new Error('Page.captureScreenshot failed: ' + e.message);
          }
        }

        // Unsupported methods return empty result
        console.warn(TAG, `debugger.sendCommand: unsupported method "${method}"`);
        return {};
      }),

      getTargets: promiseToCallback(async function () {
        return [];
      }),
    };
  }

  // ─── 6. declarativeNetRequest constants ───────────────────────────
  if (chrome.declarativeNetRequest) {
    const dnr = chrome.declarativeNetRequest;

    if (!dnr.RuleActionType) {
      dnr.RuleActionType = Object.freeze({
        BLOCK: 'block',
        REDIRECT: 'redirect',
        ALLOW: 'allow',
        UPGRADE_SCHEME: 'upgradeScheme',
        MODIFY_HEADERS: 'modifyHeaders',
        ALLOW_ALL_REQUESTS: 'allowAllRequests',
      });
    }

    if (!dnr.HeaderOperation) {
      dnr.HeaderOperation = Object.freeze({
        APPEND: 'append',
        SET: 'set',
        REMOVE: 'remove',
      });
    }

    if (!dnr.ResourceType) {
      dnr.ResourceType = Object.freeze({
        MAIN_FRAME: 'main_frame',
        SUB_FRAME: 'sub_frame',
        STYLESHEET: 'stylesheet',
        SCRIPT: 'script',
        IMAGE: 'image',
        FONT: 'font',
        OBJECT: 'object',
        XMLHTTPREQUEST: 'xmlhttprequest',
        PING: 'ping',
        CSP_REPORT: 'csp_report',
        MEDIA: 'media',
        WEBSOCKET: 'websocket',
        OTHER: 'other',
      });
    }
  } else {
    // declarativeNetRequest may not exist at all in some Firefox versions
    chrome.declarativeNetRequest = {
      RuleActionType: Object.freeze({
        BLOCK: 'block',
        REDIRECT: 'redirect',
        ALLOW: 'allow',
        UPGRADE_SCHEME: 'upgradeScheme',
        MODIFY_HEADERS: 'modifyHeaders',
        ALLOW_ALL_REQUESTS: 'allowAllRequests',
      }),
      HeaderOperation: Object.freeze({
        APPEND: 'append',
        SET: 'set',
        REMOVE: 'remove',
      }),
      ResourceType: Object.freeze({
        MAIN_FRAME: 'main_frame',
        SUB_FRAME: 'sub_frame',
        STYLESHEET: 'stylesheet',
        SCRIPT: 'script',
        IMAGE: 'image',
        FONT: 'font',
        OBJECT: 'object',
        XMLHTTPREQUEST: 'xmlhttprequest',
        PING: 'ping',
        CSP_REPORT: 'csp_report',
        MEDIA: 'media',
        WEBSOCKET: 'websocket',
        OTHER: 'other',
      }),
      getDynamicRules: promiseToCallback(async () => []),
      getSessionRules: promiseToCallback(async () => []),
      updateDynamicRules: promiseToCallback(async () => {}),
      updateSessionRules: promiseToCallback(async () => {}),
      getEnabledRulesets: promiseToCallback(async () => []),
      updateEnabledRulesets: promiseToCallback(async () => {}),
      isRegexSupported: promiseToCallback(async () => ({ isSupported: true })),
      getMatchedRules: promiseToCallback(async () => ({ rulesMatchedInfo: [] })),
      onRuleMatchedDebug: makeEvent(),
    };
  }

  // ─── Init log ─────────────────────────────────────────────────────
  console.log(TAG, 'Compatibility layer loaded');
})();
