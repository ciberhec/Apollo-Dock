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
  quitBtn: document.getElementById('quitBtn')
};

const LAYOUT = {
  bubbleSize: 56,
  bubbleMargin: 16,
  panelWidth: 240,
  panelGap: 12,
  panelMaxHeight: 0.8
};

let state = { mode: 'bubble', opacity: 1, theme: 'dark' };
let registry = { tools: [] };
let lastHoverState = null;

function applyTheme(theme) {
  els.body.classList.remove('theme-dark', 'theme-light', 'theme-apollo');
  els.body.classList.add(`theme-${theme}`);
}

function applyMode(mode) {
  els.body.classList.remove('mode-bubble', 'mode-sidebar');
  els.body.classList.add(`mode-${mode}`);
  els.bubble.hidden = mode !== 'bubble';
  els.sidebar.hidden = mode !== 'sidebar';
  closeBubbleMenu();
  closeSettings();
  reflowAfterModeChange();
  pushClickThroughState();
}

function reflowAfterModeChange() {
  void els.body.offsetHeight;
  els.bubblePanel.style.maxHeight = '80vh';
  els.bubblePanel.style.overflowY = 'auto';
  els.bubblePanel.style.maxWidth = `${LAYOUT.panelWidth}px`;
  els.settings.style.maxHeight = 'calc(100vh - 32px)';
  els.settings.style.maxWidth = 'calc(100vw - 32px)';
  els.settings.style.overflowY = 'auto';
  void els.body.offsetHeight;
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

async function positionBubblePanel() {
  const info = await api.getScreenInfo();
  if (!info) return;
  const { workArea, windowBounds } = info;

  const bubbleScreenLeft = windowBounds.x + LAYOUT.bubbleMargin;
  const bubbleScreenTop = windowBounds.y + LAYOUT.bubbleMargin;
  const bubbleScreenRight = bubbleScreenLeft + LAYOUT.bubbleSize;

  const spaceRight = workArea.x + workArea.width - bubbleScreenRight - LAYOUT.panelGap;
  const spaceLeft = bubbleScreenLeft - workArea.x - LAYOUT.panelGap;

  const panelMaxHeight = Math.floor(workArea.height * LAYOUT.panelMaxHeight);
  els.bubblePanel.style.maxHeight = `${panelMaxHeight}px`;
  els.bubblePanel.style.overflowY = 'auto';

  const panelTopInWindow = LAYOUT.bubbleMargin;
  let panelLeftInWindow = LAYOUT.bubbleMargin + LAYOUT.bubbleSize + LAYOUT.panelGap;

  let newWindowX = windowBounds.x;
  let newWindowY = windowBounds.y;

  if (spaceRight < LAYOUT.panelWidth && spaceLeft >= LAYOUT.panelWidth) {
    const shift = LAYOUT.panelWidth - spaceRight + LAYOUT.panelGap;
    newWindowX = windowBounds.x - shift;
  } else if (spaceRight < LAYOUT.panelWidth) {
    const overflowRight = LAYOUT.panelWidth - spaceRight + LAYOUT.panelGap;
    newWindowX = Math.max(workArea.x, windowBounds.x - overflowRight);
  }

  const panelScreenTopFinal = newWindowY + panelTopInWindow;
  const panelScreenBottom = panelScreenTopFinal + panelMaxHeight;
  const workBottom = workArea.y + workArea.height;
  if (panelScreenBottom > workBottom) {
    const overflowBottom = panelScreenBottom - workBottom;
    newWindowY = Math.max(workArea.y, windowBounds.y - overflowBottom);
  }
  if (newWindowY + panelTopInWindow < workArea.y) {
    newWindowY = workArea.y - panelTopInWindow;
  }

  if (newWindowX !== windowBounds.x || newWindowY !== windowBounds.y) {
    api.moveWindow({ x: newWindowX, y: newWindowY });
  }

  els.bubblePanel.style.left = `${panelLeftInWindow}px`;
  els.bubblePanel.style.right = 'auto';
  els.bubblePanel.style.top = `${panelTopInWindow}px`;
  els.bubblePanel.style.bottom = 'auto';
}

async function openBubbleMenu() {
  await positionBubblePanel();
  els.bubblePanel.hidden = false;
  api.menuShown();
}

function closeBubbleMenu() {
  if (els.bubblePanel.hidden) return;
  els.bubblePanel.hidden = true;
  pushClickThroughState();
}

function openSettings() {
  els.settings.hidden = false;
  api.menuShown();
}

function closeSettings() {
  if (els.settings.hidden) return;
  els.settings.hidden = true;
  pushClickThroughState();
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

function pointInsideRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function handleMouseMove(e) {
  if (state.mode !== 'bubble') {
    if (lastHoverState !== true) {
      lastHoverState = true;
      api.bubbleHover(true);
    }
    return;
  }
  const inBubble = pointInsideRect(e.clientX, e.clientY, els.bubbleCore.getBoundingClientRect());
  const inPanel = !els.bubblePanel.hidden && pointInsideRect(e.clientX, e.clientY, els.bubblePanel.getBoundingClientRect());
  const inSettings = !els.settings.hidden && pointInsideRect(e.clientX, e.clientY, els.settings.getBoundingClientRect());
  const hovered = inBubble || inPanel || inSettings;
  if (hovered !== lastHoverState) {
    lastHoverState = hovered;
    api.bubbleHover(hovered);
  }
}

async function init() {
  state = await api.getSettings();
  registry = await api.getRegistry();
  applyTheme(state.theme);
  applyMode(state.mode);
  setActiveSeg(els.modeGroup, 'mode', state.mode);
  setActiveSeg(els.themeGroup, 'theme', state.theme);
  els.opacitySlider.value = Math.round(state.opacity * 100);
  els.opacityValue.textContent = `${els.opacitySlider.value}%`;
  renderTools();
  pushClickThroughState();
}

els.bubbleCore.addEventListener('click', async (e) => {
  if (e.detail === 0) return;
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
  closeBubbleMenu();
  closeSettings();
  api.hideDock();
});
els.sidebarHideBtn.addEventListener('click', () => {
  closeSettings();
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

document.addEventListener('mousemove', handleMouseMove);
window.addEventListener('blur', () => {
  if (lastHoverState !== false) {
    lastHoverState = false;
    api.bubbleHover(false);
  }
});

init();
