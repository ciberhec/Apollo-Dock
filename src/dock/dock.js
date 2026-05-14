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

let state = { mode: 'bubble', opacity: 1, theme: 'dark' };
let registry = { tools: [] };

function applyTheme(theme) {
  els.body.classList.remove('theme-dark', 'theme-light', 'theme-apollo');
  els.body.classList.add(`theme-${theme}`);
}

function applyMode(mode) {
  els.body.classList.remove('mode-bubble', 'mode-sidebar');
  els.body.classList.add(`mode-${mode}`);
  els.bubble.hidden = mode !== 'bubble';
  els.sidebar.hidden = mode !== 'sidebar';
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
}

// Bubble panel toggle
els.bubbleCore.addEventListener('click', (e) => {
  if (e.detail === 0) return; // ignore from drag
  els.bubblePanel.hidden = !els.bubblePanel.hidden;
});

// Settings open/close
function openSettings() { els.settings.hidden = false; }
function closeSettings() { els.settings.hidden = true; }
els.bubbleSettingsBtn.addEventListener('click', openSettings);
els.sidebarSettingsBtn.addEventListener('click', openSettings);
els.settingsCloseBtn.addEventListener('click', closeSettings);
api.onOpenSettings(openSettings);

// Hide / quit
els.bubbleHideBtn.addEventListener('click', () => api.hideDock());
els.sidebarHideBtn.addEventListener('click', () => api.hideDock());
els.quitBtn.addEventListener('click', () => api.quit());

// Mode
els.modeGroup.addEventListener('click', async (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  const mode = btn.dataset.mode;
  state = await api.updateSettings({ mode });
  applyMode(mode);
  setActiveSeg(els.modeGroup, 'mode', mode);
});

// Theme
els.themeGroup.addEventListener('click', async (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  const theme = btn.dataset.theme;
  state = await api.updateSettings({ theme });
  applyTheme(theme);
  setActiveSeg(els.themeGroup, 'theme', theme);
});

// Opacity
els.opacitySlider.addEventListener('input', async (e) => {
  const pct = Number(e.target.value);
  els.opacityValue.textContent = `${pct}%`;
  state = await api.updateSettings({ opacity: pct / 100 });
});

init();
