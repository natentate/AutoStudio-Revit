// Narrow, promise-based bridge between the sandboxed renderer and the main process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('autostudio', {
  platform: process.platform,
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (opts) => ipcRenderer.invoke('project:save', opts),
  exportFile: (opts) => ipcRenderer.invoke('file:export', opts),
  setDocumentState: (state) => ipcRenderer.send('doc:state', state),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, command) => fn(command)),
  onOpenFile: (fn) => ipcRenderer.on('open-file', (_e, file) => fn(file)),
  closeWindow: () => ipcRenderer.send('window:close'),
  rendererReady: () => ipcRenderer.send('renderer:ready'),
});
