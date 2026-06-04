'use strict';

// Shared preload for the two pieces of app chrome: the top title bar
// (src/topbar) and the left sidebar (src/sidebar). Each page uses the subset
// of this API it needs; exposing the whole surface keeps the bridge simple.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lmw', {
  // main -> renderer
  onAccounts: (cb) => ipcRenderer.on('accounts', (_e, accounts) => cb(accounts)),
  onActiveChanged: (cb) => ipcRenderer.on('active-changed', (_e, id) => cb(id)),
  onUnreadChanged: (cb) => ipcRenderer.on('unread-changed', (_e, map) => cb(map)),
  onMaximized: (cb) => ipcRenderer.on('maximized', (_e, val) => cb(val)),
  onAutostart: (cb) => ipcRenderer.on('autostart', (_e, val) => cb(val)),

  // renderer -> main
  selectAccount: (id) => ipcRenderer.send('select-account', id),
  openAccountContext: (id) => ipcRenderer.send('open-account-context', id),
  addAccount: () => ipcRenderer.send('add-account'),
  reloadActive: () => ipcRenderer.send('reload-active'),
  setAutostart: (on) => ipcRenderer.send('set-autostart', on),
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
});
