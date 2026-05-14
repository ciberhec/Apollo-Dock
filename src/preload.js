const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apolloDock', {
  getRegistry: () => ipcRenderer.invoke('registry:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  openTool: (toolId) => ipcRenderer.send('tool:open', toolId),
  hideDock: () => ipcRenderer.send('dock:hide'),
  quit: () => ipcRenderer.send('dock:quit'),
  openExternal: (url) => ipcRenderer.send('dock:open-external', url),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', cb)
});

contextBridge.exposeInMainWorld('domainAgent', {
  analyze: (domain) => ipcRenderer.invoke('domain-agent:analyze', domain)
});
