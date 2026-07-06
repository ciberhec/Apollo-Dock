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
  menuShown: () => ipcRenderer.invoke('menu-shown'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  updater: {
    getState: () => ipcRenderer.invoke('updater:get-state'),
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStateChanged: (cb) => {
      const listener = (_e, state) => cb(state);
      ipcRenderer.on('updater:state-changed', listener);
      return () => ipcRenderer.removeListener('updater:state-changed', listener);
    }
  }
});

contextBridge.exposeInMainWorld('domainAgent', {
  analyze: (domain) => ipcRenderer.invoke('domain-agent:analyze', domain)
});

contextBridge.exposeInMainWorld('domainAge', {
  lookup: (domain) => ipcRenderer.invoke('domain-age:lookup', domain)
});
