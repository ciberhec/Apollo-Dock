const api = window.apolloDock;

const els = {
  body: document.body,
  bubble: document.getElementById('bubble'),
  bubbleCore: document.getElementById('bubbleCore'),
  bubblePanel: document.getElementById('bubblePanel'),
  bubbleToolGrid: document.getElementById('bubbleToolGrid'),
  bubbleSettingsBtn: document.getElementById('bubbleSettingsBtn'),
  bubbleHideBtn: document.getElementById('bubbleHideBtn'),
  sidebar: document.getElementById('sidebar'),
  sidebarToolList: document.getElementById('sidebarToolList'),
  sidebarSettingsBtn: document.getElementById('sidebarSettingsBtn'),
  sidebarHideBtn: document.getElementById('sidebarHideBtn'),
  settings: document.getElementById('settings'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  modeGroup: document.getElementById('modeGroup'),
  themeGroup: document.getElementById('themeGroup'),
  opacitySlider: document.getElementById('opacitySlider'),
  opacityValue: document.getElementById('opacityValue'),
  quitBtn: document.getElementById('quitBtn'),
  updateBadge: document.getElementById('updateBadge'),
  updateBanner: document.getElementById('updateBanner'),
  updateCheckBtn: document.getElementById('updateCheckBtn'),
  updateVersionLabel: document.getElementById('updateVersionLabel'),
  updateStatusMsg: document.getElementById('updateStatusMsg')
};

const DRAG_THRESHOLD = 3;
const CLICK_SUPPRESS_MS = 200;

let state = { mode: 'bubble', opacity: 1, theme: 'dark' };
let registry = { tools: [] };
let drag = null;
let suppressClickUntil = 0;

function applyTheme(theme) {
  els.body.classList.remove('theme-dark', 'theme-light');
  els.body.classList.add(`theme-${theme}`);
}

function applyMode(mode) {
  els.body.classList.remove('mode-bubble', 'mode-sidebar');
  els.body.classList.add(`mode-${mode}`);
  els.bubble.hidden = mode !== 'bubble';
  els.sidebar.hidden = mode !== 'sidebar';
  els.bubblePanel.hidden = true;
  els.settings.hidden = true;
  pushClickThroughState();
}

function setActiveSeg(group, key, value) {
  group.querySelectorAll('.seg').forEach((b) => {
    b.classList.toggle('active', b.dataset[key] === value);
  });
}

function renderTools() {
  els.bubbleToolGrid.innerHTML = '';
  els.sidebarToolList.innerHTML = '';

  registry.tools.forEach((tool) => {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `<span class="tool-icon">${tool.icon || '🔧'}</span><span class="tool-name">${tool.name}</span>`;
    card.addEventListener('click', () => api.openTool(tool.id));
    els.bubbleToolGrid.appendChild(card);

    const row = document.createElement('div');
    row.className = 'sidebar-tool-row';
    row.innerHTML = `<span class="tool-icon">${tool.icon || '🔧'}</span><span class="tool-name">${tool.name}</span>`;
    row.addEventListener('click', () => api.openTool(tool.id));
    els.sidebarToolList.appendChild(row);
  });
}

function isMenuOpen() {
  return !els.bubblePanel.hidden || !els.settings.hidden;
}

function pushClickThroughState() {
  if (isMenuOpen()) {
    api.menuShown();
  } else {
    api.menuHidden();
  }
}

async function openBubbleMenu() {
  await api.menuShown();
  els.bubblePanel.hidden = false;
}

function closeBubbleMenu() {
  if (els.bubblePanel.hidden) return;
  els.bubblePanel.hidden = true;
  pushClickThroughState();
}

async function openSettings() {
  await api.menuShown();
  els.settings.hidden = false;
}

function closeSettings() {
  if (els.settings.hidden) return;
  els.settings.hidden = true;
  pushClickThroughState();
}

els.bubbleCore.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  try { els.bubbleCore.setPointerCapture(e.pointerId); } catch {}
  drag = {
    pointerId: e.pointerId,
    lastScreenX: e.screenX,
    lastScreenY: e.screenY,
    moved: false
  };
});

els.bubbleCore.addEventListener('pointermove', (e) => {
  if (!drag || drag.pointerId !== e.pointerId) return;
  const dx = e.screenX - drag.lastScreenX;
  const dy = e.screenY - drag.lastScreenY;
  if (dx === 0 && dy === 0) return;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
  drag.moved = true;
  drag.lastScreenX = e.screenX;
  drag.lastScreenY = e.screenY;
  api.dragWindowBy({ dx, dy });
});

function endDrag(e) {
  if (!drag || drag.pointerId !== e.pointerId) return;
  if (drag.moved) suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
  try { els.bubbleCore.releasePointerCapture(drag.pointerId); } catch {}
  drag = null;
}

els.bubbleCore.addEventListener('pointerup', endDrag);
els.bubbleCore.addEventListener('pointercancel', endDrag);

els.bubbleCore.addEventListener('click', async (e) => {
  if (Date.now() < suppressClickUntil) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (els.bubblePanel.hidden) {
    await openBubbleMenu();
  } else {
    closeBubbleMenu();
  }
});

els.bubbleSettingsBtn.addEventListener('click', openSettings);
els.sidebarSettingsBtn.addEventListener('click', openSettings);
els.settingsCloseBtn.addEventListener('click', closeSettings);
api.onOpenSettings(openSettings);

els.bubbleHideBtn.addEventListener('click', () => {
  els.bubblePanel.hidden = true;
  els.settings.hidden = true;
  pushClickThroughState();
  api.hideDock();
});
els.sidebarHideBtn.addEventListener('click', () => {
  els.settings.hidden = true;
  pushClickThroughState();
  api.hideDock();
});
els.quitBtn.addEventListener('click', () => api.quit());

els.modeGroup.addEventListener('click', async (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  const mode = btn.dataset.mode;
  state = await api.updateSettings({ mode });
  applyMode(mode);
  setActiveSeg(els.modeGroup, 'mode', mode);
});

els.themeGroup.addEventListener('click', async (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  const theme = btn.dataset.theme;
  state = await api.updateSettings({ theme });
  applyTheme(theme);
  setActiveSeg(els.themeGroup, 'theme', theme);
});

els.opacitySlider.addEventListener('input', async (e) => {
  const pct = Number(e.target.value);
  els.opacityValue.textContent = `${pct}%`;
  state = await api.updateSettings({ opacity: pct / 100 });
});

// -----------------------------------------------------------------------------
// Updater
// -----------------------------------------------------------------------------

let appVersion = '';

function formatBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function renderUpdate(updateState) {
  if (!updateState) return;
  const { phase, available, progress, message, error } = updateState;

  // Settings panel — always reflects current state.
  els.updateVersionLabel.textContent = `Version ${appVersion || '—'}`;
  if (error) {
    els.updateStatusMsg.textContent = error;
    els.updateStatusMsg.className = 'update-status-msg error';
  } else if (message) {
    els.updateStatusMsg.textContent = message;
    els.updateStatusMsg.className = 'update-status-msg';
  } else if (phase === 'available' && available) {
    els.updateStatusMsg.textContent = `Update available: v${available.version}`;
    els.updateStatusMsg.className = 'update-status-msg highlight';
  } else if (phase === 'downloading' && progress) {
    const pct = progress.total ? Math.round((progress.received / progress.total) * 100) : null;
    els.updateStatusMsg.textContent = pct !== null
      ? `Downloading… ${pct}% (${formatBytes(progress.received)} / ${formatBytes(progress.total)})`
      : `Downloading… ${formatBytes(progress.received)}`;
    els.updateStatusMsg.className = 'update-status-msg';
  } else {
    els.updateStatusMsg.textContent = '';
    els.updateStatusMsg.className = 'update-status-msg';
  }

  els.updateCheckBtn.disabled = phase === 'checking' || phase === 'downloading'
    || phase === 'verifying' || phase === 'staging' || phase === 'installing';
  els.updateCheckBtn.textContent = phase === 'checking' ? 'Checking…' : 'Check for updates';

  // Bubble badge — only when an update is available, ready, or installing.
  const showBadge = phase === 'available' || phase === 'downloading'
    || phase === 'verifying' || phase === 'staging' || phase === 'installing';
  els.updateBadge.hidden = !showBadge;

  // In-panel banner.
  if (phase === 'available' && available) {
    els.updateBanner.hidden = false;
    els.updateBanner.className = 'update-banner available';
    els.updateBanner.innerHTML = `
      <div class="update-banner-text">
        <strong>Update available — v${available.version}</strong>
        <div class="update-banner-sub">Click "Update now" to download and install. Apollo Dock will restart.</div>
      </div>
      <div class="update-banner-actions">
        <button class="btn-primary" id="updateInstallBtn">Update now</button>
        <button class="btn-ghost" id="updateLaterBtn">Later</button>
      </div>
    `;
    document.getElementById('updateInstallBtn').addEventListener('click', () => api.updater.install());
    document.getElementById('updateLaterBtn').addEventListener('click', () => { els.updateBanner.hidden = true; });
  } else if (phase === 'downloading' || phase === 'verifying' || phase === 'staging' || phase === 'installing') {
    els.updateBanner.hidden = false;
    els.updateBanner.className = 'update-banner progress';
    const label =
      phase === 'downloading' ? els.updateStatusMsg.textContent || 'Downloading…' :
      phase === 'verifying'   ? 'Verifying download…' :
      phase === 'staging'     ? 'Preparing update…' :
                                'Installing — Apollo Dock will restart.';
    els.updateBanner.innerHTML = `<div class="update-banner-text">${label}</div>`;
  } else if (phase === 'error' && error) {
    els.updateBanner.hidden = false;
    els.updateBanner.className = 'update-banner error';
    els.updateBanner.innerHTML = `
      <div class="update-banner-text">
        <strong>Update failed</strong>
        <div class="update-banner-sub">${error}</div>
      </div>
      <div class="update-banner-actions">
        <button class="btn-ghost" id="updateDismissBtn">Dismiss</button>
      </div>
    `;
    document.getElementById('updateDismissBtn').addEventListener('click', () => { els.updateBanner.hidden = true; });
  } else {
    els.updateBanner.hidden = true;
  }
}

els.updateCheckBtn.addEventListener('click', () => api.updater.check());

async function init() {
  state = await api.getSettings();
  registry = await api.getRegistry();
  if (state.theme !== 'dark' && state.theme !== 'light') {
    state = await api.updateSettings({ theme: 'dark' });
  }
  applyTheme(state.theme);
  applyMode(state.mode);
  setActiveSeg(els.modeGroup, 'mode', state.mode);
  setActiveSeg(els.themeGroup, 'theme', state.theme);
  els.opacitySlider.value = Math.round(state.opacity * 100);
  els.opacityValue.textContent = `${els.opacitySlider.value}%`;
  renderTools();

  appVersion = await api.getVersion();
  api.updater.onStateChanged(renderUpdate);
  renderUpdate(await api.updater.getState());
}

init();
