// Firefox action handler — toggles the Firefox sidebar in place of Chrome's
// sidePanel, and (crucially) gives the sidebar a per-tab panel URL carrying
// the active tab id.
//
// The Chrome side panel is opened as `sidepanel.html?tabId=<id>`; the bundled
// UI reads that `tabId` query param to know which tab it operates on. The
// Firefox sidebar, however, loads the manifest's default panel (`sidepanel.html`
// with no query string) regardless of how it's opened (Ctrl+E, View menu, or
// toolbar button), so `tabId` is null and every send throws "No active tab".
//
// Fix: proactively assign each tab its own panel URL via
// browser.sidebarAction.setPanel({ tabId, panel }). This mirrors Chrome's
// per-tab side panel model, so whichever way the sidebar is opened it already
// has the right tab context.

(function () {
  'use strict';

  // Stub chrome.sidePanel so calls from the Chrome bundle don't throw
  // (firefox-compat.js provides a richer shim; this is a no-op fallback).
  if (typeof chrome !== 'undefined' && !chrome.sidePanel) {
    chrome.sidePanel = {
      open: function () { return Promise.resolve(); },
      close: function () { return Promise.resolve(); },
      setOptions: function () { return Promise.resolve(); },
      setPanelBehavior: function () { return Promise.resolve(); },
      getOptions: function () { return Promise.resolve({}); },
      getPanelBehavior: function () { return Promise.resolve({}); },
    };
  }

  if (typeof chrome === 'undefined') return;

  var sidebarApi = chrome.sidebarAction ||
    (typeof browser !== 'undefined' && browser.sidebarAction);
  if (!sidebarApi || !sidebarApi.setPanel) {
    console.warn('[firefox-action-handler] sidebarAction.setPanel not available');
    return;
  }

  var PANEL_BASE = chrome.runtime.getURL('sidepanel.html');
  // Tabs whose per-tab panel we've already assigned — avoids redundant
  // setPanel calls (which would reload an open sidebar).
  var assigned = new Set();

  function panelUrlFor(tabId) {
    return PANEL_BASE +
      '?tabId=' + encodeURIComponent(tabId) +
      '&mainTabId=' + encodeURIComponent(tabId);
  }

  function syncPanelForTab(tabId, force) {
    if (!tabId || tabId < 0) return;
    if (!force && assigned.has(tabId)) return;
    try {
      var r = sidebarApi.setPanel({ tabId: tabId, panel: panelUrlFor(tabId) });
      if (r && typeof r.then === 'function') r.catch(function () {});
      assigned.add(tabId);
    } catch (e) { /* best-effort */ }
  }

  // Assign panels for all currently-open tabs so the active one is ready
  // before the user first opens the sidebar.
  try {
    chrome.tabs.query({}, function (tabs) {
      (tabs || []).forEach(function (t) { syncPanelForTab(t.id); });
    });
  } catch (e) { /* noop */ }

  if (chrome.tabs) {
    if (chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener(function (info) {
        syncPanelForTab(info && info.tabId);
      });
    }
    if (chrome.tabs.onCreated) {
      chrome.tabs.onCreated.addListener(function (tab) {
        if (tab && tab.id != null) syncPanelForTab(tab.id);
      });
    }
    if (chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
        if (changeInfo && changeInfo.status === 'complete') syncPanelForTab(tabId);
      });
    }
    if (chrome.tabs.onRemoved) {
      chrome.tabs.onRemoved.addListener(function (tabId) {
        assigned.delete(tabId);
      });
    }
  }

  if (chrome.windows && chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener(function (windowId) {
      if (windowId == null || windowId < 0) return;
      try {
        chrome.tabs.query({ active: true, windowId: windowId }, function (tabs) {
          if (tabs && tabs[0]) syncPanelForTab(tabs[0].id);
        });
      } catch (e) { /* noop */ }
    });
  }

  // Toolbar button: make sure the clicked tab's panel is set, then toggle.
  if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener(function (tab) {
      var tabId = tab && tab.id;
      if (tabId != null) syncPanelForTab(tabId, true);
      if (sidebarApi.toggle) {
        sidebarApi.toggle();
      } else if (sidebarApi.open) {
        sidebarApi.open();
      }
    });
  }
})();
