'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('confirmDlg', {
  onData: (cb) => ipcRenderer.on('confirm:data', (_e, data) => cb(data)),
  accept: () => ipcRenderer.send('confirm:accept'),
  cancel: () => ipcRenderer.send('confirm:cancel'),
});
