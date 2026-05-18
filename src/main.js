const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const dnsLookup = require('./tools/domain-agent/core/dns-lookup');
const scraper = require('./tools/domain-agent/core/scraper');
const analyzer = require('./tools/domain-agent/core/analyzer');

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  mode: 'bubble',
  opacity: 1.0,
  theme: 'dark',
  position: null
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE(), 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

function loadRegistry() {
  const file = path.join(__dirname, '..', 'config', 'tools-registry.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('Failed to load tools registry:', err);
    return { tools: [] };
  }
}

let dockWindow = null;
let tray = null;
const toolWindows = new Map();
let settings = { ...DEFAULT_SETTINGS };
let menuOpen = false;
let bubbleHovered = false;

function updateClickThrough() {
  if (!dockWindow) return;
  if (settings.mode !== 'bubble') {
    dockWindow.setIgnoreMouseEvents(false);
    return;
  }
  if (menuOpen || bubbleHovered) {
    dockWindow.setIgnoreMouseEvents(false);
  } else {
    dockWindow.setIgnoreMouseEvents(true, { forward: true });
  }
}

function getDockDimensions(mode) {
  if (mode === 'sidebar') return { width: 220, height: 560 };
  return { width: 360, height: 480 };
}

function createDockWindow() {
  const { width, height } = getDockDimensions(settings.mode);
  const display = screen.getPrimaryDisplay().workAreaSize;

  const x = settings.position?.x ?? display.width - width - 24;
  const y = settings.position?.y ?? 80;

  dockWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  dockWindow.setAlwaysOnTop(true, 'floating');
  dockWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  dockWindow.setOpacity(settings.opacity);

  dockWindow.loadFile(path.join(__dirname, 'dock', 'dock.html'));

  dockWindow.webContents.on('did-finish-load', () => {
    updateClickThrough();
  });

  dockWindow.on('move', () => {
    if (!dockWindow) return;
    const [px, py] = dockWindow.getPosition();
    settings.position = { x: px, y: py };
    saveSettings(settings);
  });

  dockWindow.on('closed', () => { dockWindow = null; });
}

function resizeDockForMode(mode) {
  if (!dockWindow) return;
  const { width, height } = getDockDimensions(mode);
  const bounds = dockWindow.getBounds();
  dockWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
}

function openTool(toolId) {
  const registry = loadRegistry();
  const tool = registry.tools.find((t) => t.id === toolId);
  if (!tool) return;

  if (toolWindows.has(toolId)) {
    const existing = toolWindows.get(toolId);
    if (!existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return;
    }
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: tool.name,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, tool.entry));
  win.on('closed', () => toolWindows.delete(toolId));
  toolWindows.set(toolId, win);
}

function buildTrayIcon() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 18, height: 18 });
  }
  return nativeImage.createEmpty();
}

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('Apollo Dock');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Dock',
      click: () => {
        if (!dockWindow) createDockWindow();
        else dockWindow.show();
      }
    },
    {
      label: 'Settings',
      click: () => {
        if (!dockWindow) createDockWindow();
        dockWindow.show();
        dockWindow.webContents.send('open-settings');
      }
    },
    { type: 'separator' },
    { label: 'Quit Apollo Dock', click: () => { app.quit(); } }
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    if (!dockWindow) {
      createDockWindow();
    } else if (dockWindow.isVisible()) {
      dockWindow.hide();
    } else {
      dockWindow.show();
    }
  });
}

app.whenReady().then(() => {
  settings = loadSettings();
  createDockWindow();
  createTray();
  if (process.platform === 'darwin') app.dock?.hide();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

ipcMain.handle('registry:get', () => loadRegistry());
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:update', (_evt, partial) => {
  settings = { ...settings, ...partial };
  saveSettings(settings);
  if (dockWindow) {
    if (typeof partial.opacity === 'number') dockWindow.setOpacity(partial.opacity);
    if (partial.mode) {
      resizeDockForMode(partial.mode);
      menuOpen = false;
      bubbleHovered = false;
      updateClickThrough();
    }
  }
  return settings;
});
ipcMain.on('tool:open', (_evt, toolId) => openTool(toolId));
ipcMain.on('dock:hide', () => dockWindow?.hide());
ipcMain.on('dock:quit', () => app.quit());
ipcMain.on('dock:open-external', (_evt, url) => { if (url) shell.openExternal(url); });

ipcMain.handle('get-screen-info', () => {
  if (!dockWindow) return null;
  const bounds = dockWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  return {
    workArea: display.workArea,
    windowBounds: bounds
  };
});

ipcMain.on('dock:move-window', (_evt, pos) => {
  if (!dockWindow || !pos) return;
  const bounds = dockWindow.getBounds();
  const x = Number.isFinite(pos.x) ? Math.round(pos.x) : bounds.x;
  const y = Number.isFinite(pos.y) ? Math.round(pos.y) : bounds.y;
  dockWindow.setBounds({ x, y, width: bounds.width, height: bounds.height });
});

ipcMain.on('menu-hidden', () => {
  menuOpen = false;
  updateClickThrough();
});

ipcMain.on('menu-shown', () => {
  menuOpen = true;
  updateClickThrough();
});

ipcMain.on('bubble-hover', (_evt, hovered) => {
  bubbleHovered = Boolean(hovered);
  updateClickThrough();
});

ipcMain.handle('domain-agent:analyze', async (_evt, rawDomain) => {
  const domain = String(rawDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return { ok: false, error: `"${rawDomain}" is not a valid domain.` };
  }

  try {
    const dnsResults = await dnsLookup.fullLookup(domain);

    const missing = {
      spf: !dnsResults.spf,
      dmarc: !dnsResults.dmarc,
      dkim: !dnsResults.dkim,
      blacklists: dnsResults.blacklists.length === 0
    };

    let scraped = null;
    if (missing.spf || missing.dmarc || missing.dkim || missing.blacklists) {
      try {
        scraped = await scraper.scrapeFallback(domain, missing);
        if (!dnsResults.spf && scraped.spf) dnsResults.spf = scraped.spf;
        if (!dnsResults.dmarc && scraped.dmarc) dnsResults.dmarc = scraped.dmarc;
      } catch (err) {
        dnsResults.errors.scraping = err.message;
      }
    }

    const report = analyzer.analyze(dnsResults);
    return { ok: true, report, scraped };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});
