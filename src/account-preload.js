'use strict';

// Main-world preload for EVERY account view (loaded with contextIsolation:false
// so it can see and patch the page's own globals). nodeIntegration stays false,
// so the remote page still gets no Node access — require/ipcRenderer remain
// preload-local. Two jobs:
//
//   1) Unread count via the Badging API. Outlook/Gmail call
//      navigator.setAppBadge(n) with their unread count; we capture it and
//      forward it to the main process. This is authoritative and works even for
//      providers (Outlook) whose page title doesn't carry a "(N)" count.
//   2) For Google accounts (flagged via additionalArguments), the real-Chrome
//      fingerprint that gets past Google's "browser may not be secure" gate.
const { ipcRenderer } = require('electron');

// --- (1) unread via the Badging API ----------------------------------------
(() => {
  const report = (count) => {
    try { ipcRenderer.send('account:badge', count); } catch (_) { /* noop */ }
  };
  try {
    // Outlook on the web only uses the Badging API when it believes it's an
    // installed app — it gates the call on `matchMedia('(display-mode:
    // standalone)')`. In a wrapped tab that's false, so it never badges (Gmail
    // badges regardless). Spoof the standalone display-mode query to true so
    // Outlook reports its unread count; harmless for the other providers.
    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const mql = realMatchMedia(query);
      if (/display-mode\s*:\s*standalone/i.test(String(query))) {
        try { Object.defineProperty(mql, 'matches', { get: () => true, configurable: true }); } catch (_) {}
      }
      return mql;
    };
  } catch (_) { /* never break the page */ }
  try {
    // Defining these guarantees the API is present, so the web app feature-
    // detects it and calls it. We don't forward to any native badge — the
    // wrapper does its own per-account accounting in the main process.
    navigator.setAppBadge = (count) => {
      if (typeof count === 'number' && isFinite(count)) report(count);
      // A badge with no number (a "dot") leaves the numeric count unchanged.
      return Promise.resolve();
    };
    navigator.clearAppBadge = () => { report(0); return Promise.resolve(); };
  } catch (_) { /* never break the page */ }
})();

// --- (2) Google real-Chrome fingerprint ------------------------------------
if (process.argv.includes('--lmw-google')) {
  try {
    const full = process.versions.chrome;          // e.g. "130.0.6723.191"
    const major = full.split('.')[0];              // e.g. "130"

    const brands = [
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major },
      { brand: 'Not?A_Brand', version: '99' },
    ];
    const fullVersionList = [
      { brand: 'Chromium', version: full },
      { brand: 'Google Chrome', version: full },
      { brand: 'Not?A_Brand', version: '99.0.0.0' },
    ];
    const high = {
      architecture: 'x86', bitness: '64', brands, fullVersionList,
      mobile: false, model: '', platform: 'Linux', platformVersion: '6.5.0',
      uaFullVersion: full, wow64: false,
    };
    const uaData = {
      brands, mobile: false, platform: 'Linux',
      getHighEntropyValues: () => Promise.resolve(high),
      toJSON: () => ({ brands, mobile: false, platform: 'Linux' }),
    };
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => uaData, configurable: true,
    });

    const t = Date.now() / 1000;
    const chrome = window.chrome || {};
    chrome.app = chrome.app || {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    };
    chrome.runtime = chrome.runtime || {
      OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformOs: {},
      connect: function () {}, sendMessage: function () {},
    };
    chrome.loadTimes = chrome.loadTimes || function () {
      return {
        requestTime: t, startLoadTime: t, commitLoadTime: t,
        finishDocumentLoadTime: t, finishLoadTime: t, firstPaintTime: t,
        firstPaintAfterLoadTime: 0, navigationType: 'Other',
        wasFetchedViaSpdy: true, wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2',
      };
    };
    chrome.csi = chrome.csi || function () {
      return { startE: Date.now(), onloadT: Date.now(), pageT: 1000, tran: 15 };
    };
    window.chrome = chrome;
  } catch (e) { /* never break the page */ }
}
