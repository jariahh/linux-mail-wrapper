'use strict';

// Main-world preload for GOOGLE account views only (loaded with
// contextIsolation:false so these patches land in the page's own world before
// any Google script runs; nodeIntegration stays false, so the page gets no Node
// access). Google's "this browser or app may not be secure" sign-in gate rejects
// embedded browsers that betray themselves via:
//   1. navigator.userAgentData advertising only "Chromium" (never "Google
//      Chrome"), at the real engine version, and
//   2. an empty window.chrome object (real Chrome exposes app/runtime/
//      loadTimes/csi).
// The HTTP-header rewrite in main.js fixes what Google sees over the wire; this
// fixes what its in-page JS sees.
//
// (Unread counts are NOT handled here — they're scraped from the page DOM by the
// main process; see UNREAD_JS in main.js.)
(() => {
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
})();
