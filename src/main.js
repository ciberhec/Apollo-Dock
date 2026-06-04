const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const dnsLookup = require('./tools/domain-agent/core/dns-lookup');
const scraper = require('./tools/domain-agent/core/scraper');
const analyzer = require('./tools/domain-agent/core/analyzer');
const updater = require('./core/updater');

if (process.platform === 'darwin') app.setActivationPolicy('regular');

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
let preMenuPosition = null;

function updateClickThrough() {
  if (!dockWindow) return;
  dockWindow.setIgnoreMouseEvents(false);
}

function getDockDimensions(mode, isMenuOpen) {
  if (mode === 'sidebar') return { width: 220, height: 560 };
  if (isMenuOpen) return { width: 356, height: 480 };
  return { width: 88, height: 88 };
}

function clampToWorkArea(x, y, width, height) {
  const display = screen.getDisplayNearestPoint({ x, y });
  const wa = display.workArea;
  let nx = x;
  let ny = y;
  if (nx + width > wa.x + wa.width) nx = wa.x + wa.width - width;
  if (ny + height > wa.y + wa.height) ny = wa.y + wa.height - height;
  if (nx < wa.x) nx = wa.x;
  if (ny < wa.y) ny = wa.y;
  return { x: nx, y: ny };
}

function createDockWindow() {
  const { width, height } = getDockDimensions(settings.mode, menuOpen);
  const display = screen.getPrimaryDisplay().workAreaSize;

  const x = settings.position?.x ?? display.width - width - 24;
  const y = settings.position?.y ?? 80;

  dockWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  dockWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  dockWindow.setOpacity(settings.opacity);

  dockWindow.loadFile(path.join(__dirname, 'dock', 'dock.html'));

  dockWindow.webContents.on('did-finish-load', () => {
    updateClickThrough();
    if (dockWindow && !dockWindow.isVisible()) dockWindow.show();
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
  const { width, height } = getDockDimensions(mode, menuOpen);
  const bounds = dockWindow.getBounds();
  dockWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
}

function applyMenuOpenSize(open) {
  if (!dockWindow || settings.mode !== 'bubble') return;
  const { width, height } = getDockDimensions('bubble', open);
  const bounds = dockWindow.getBounds();

  if (open) {
    preMenuPosition = { x: bounds.x, y: bounds.y };
    const clamped = clampToWorkArea(bounds.x, bounds.y, width, height);
    dockWindow.setBounds({ x: clamped.x, y: clamped.y, width, height });
  } else {
    const anchor = preMenuPosition || { x: bounds.x, y: bounds.y };
    preMenuPosition = null;
    dockWindow.setBounds({ x: anchor.x, y: anchor.y, width, height });
  }
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
  const iconPath = path.join(__dirname, '..', 'assets', 'Apollo Dock logo.png');
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 22, height: 22 });
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
  if (process.platform === 'darwin') app.setActivationPolicy('regular');
  settings = loadSettings();
  createDockWindow();
  createTray();
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular');
    app.dock?.show();
  }
  updater.start();
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
      menuOpen = false;
      preMenuPosition = null;
      resizeDockForMode(partial.mode);
      updateClickThrough();
    }
  }
  return settings;
});
ipcMain.on('tool:open', (_evt, toolId) => openTool(toolId));
ipcMain.on('dock:hide', () => dockWindow?.hide());
ipcMain.on('dock:quit', () => app.quit());
ipcMain.on('dock:open-external', (_evt, url) => { if (url) shell.openExternal(url); });

ipcMain.on('dock:drag-by', (_evt, delta) => {
  if (!dockWindow || !delta) return;
  const dx = Number.isFinite(delta.dx) ? Math.round(delta.dx) : 0;
  const dy = Number.isFinite(delta.dy) ? Math.round(delta.dy) : 0;
  if (dx === 0 && dy === 0) return;
  const [x, y] = dockWindow.getPosition();
  dockWindow.setPosition(x + dx, y + dy);
  if (preMenuPosition) {
    preMenuPosition.x += dx;
    preMenuPosition.y += dy;
  }
});

ipcMain.handle('menu-hidden', () => {
  menuOpen = false;
  applyMenuOpenSize(false);
  updateClickThrough();
});

ipcMain.handle('menu-shown', () => {
  menuOpen = true;
  applyMenuOpenSize(true);
  updateClickThrough();
});

ipcMain.handle('updater:get-state', () => updater.getState());
ipcMain.handle('updater:check', () => updater.checkForUpdate({ manual: true }));
ipcMain.handle('updater:install', () => updater.installUpdate());
ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('domain-agent:analyze', async (_evt, rawDomain) => {
  const domain = String(rawDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return { ok: false, error: `"${rawDomain}" is not a valid domain.` };
  }

  try {
    const rootDomain = dnsLookup.getRootDomain(domain);
    const inputIsSubdomain = dnsLookup.isSubdomain(domain);

    const [dnsResults, rootDnsResults] = await Promise.all([
      dnsLookup.fullLookup(domain),
      inputIsSubdomain ? dnsLookup.fullLookup(rootDomain) : Promise.resolve(null)
    ]);

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
    const rootReport = rootDnsResults ? analyzer.analyze(rootDnsResults) : null;
    const subdomainContext = rootReport ? analyzer.compareSubdomainToRoot(report, rootReport) : null;

    return { ok: true, report, rootReport, subdomainContext, scraped };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});
