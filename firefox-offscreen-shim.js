// Firefox offscreen shim — handles OFFSCREEN_PLAY_SOUND via AudioContext
// and SW_KEEPALIVE as no-op. Firefox background pages support audio natively
// so no offscreen document is needed.

(function () {
  'use strict';

  // Stub chrome.offscreen so calls from the Chrome bundle don't throw
  if (typeof chrome !== 'undefined' && !chrome.offscreen) {
    chrome.offscreen = {
      createDocument: () => Promise.resolve(),
      closeDocument: () => Promise.resolve(),
      hasDocument: () => Promise.resolve(false),
      Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' },
    };
  }

  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  }

  function playNotificationSound(soundUrl) {
    const ctx = getAudioContext();

    return fetch(soundUrl)
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Failed to fetch sound: ' + response.status);
        }
        return response.arrayBuffer();
      })
      .then(function (buffer) {
        return ctx.decodeAudioData(buffer);
      })
      .then(function (decoded) {
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(ctx.destination);
        source.start(0);
      })
      .catch(function (err) {
        console.warn('[firefox-offscreen-shim] Audio playback failed:', err.message);
      });
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || typeof message !== 'object') return false;

    if (message.type === 'OFFSCREEN_PLAY_SOUND') {
      const url = message.soundUrl || message.url;
      if (url) {
        playNotificationSound(url).then(function () {
          sendResponse({ success: true });
        });
        return true; // async
      }
      sendResponse({ success: false, error: 'No sound URL provided' });
      return false;
    }

    if (message.type === 'SW_KEEPALIVE') {
      // No-op — Firefox background pages are persistent
      sendResponse({ alive: true });
      return false;
    }

    return false;
  });
})();
