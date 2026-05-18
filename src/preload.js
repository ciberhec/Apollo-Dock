const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apolloDock', {
  getRegistry: () => ipcRenderer.invoke('registry:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  openTool: (toolId) => ipcRenderer.send('tool:open', toolId),
  hideDock: () => ipcRenderer.send('dock:hide'),
  quit: () => ipcRenderer.send('dock:quit'),
  openExternal: (url) => ipcRenderer.send('dock:open-external', url),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', cb),
  dragWindowBy: (delta) => ipcRenderer.send('dock:drag-by', delta),
  menuHidden: () => ipcRenderer.invoke('menu-hidden'),
  menuShown: () => ipcRenderer.invoke('menu-shown')
});

contextBridge.exposeInMainWorld('domainAgent', {
  analyze: (domain) => ipcRenderer.invoke('domain-agent:analyze', domain)
});
