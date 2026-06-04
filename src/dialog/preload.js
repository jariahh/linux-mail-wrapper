'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dlg', {
  onServices: (cb) => ipcRenderer.on('services', (_e, list) => cb(list)),
  confirm: (payload) => ipcRenderer.send('add-account:confirm', payload),
  cancel: () => ipcRenderer.send('add-account:cancel'),
});
