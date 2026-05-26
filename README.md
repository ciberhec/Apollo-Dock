# Apollo Dock

Apollo Dock is a scalable macOS desktop tool launcher built for the Apollo.io Product Advocate / Technical Support team. It runs as a floating, always-on-top bubble (or as an edge-anchored sidebar) and serves as a single entry point for internal support utilities. The first bundled tool is **Domain Agent**, a DNS authentication and email-deliverability checker that returns customer-ready remediation guidance without making the agent bounce between MXToolbox, GlockApps, and provider docs.

## Prerequisites

- macOS (Apple Silicon or Intel)
- [Homebrew](https://brew.sh) — the installer will offer to install it if missing
- Node.js ≥ 18 — the installer will install it via Homebrew if missing

## Installation

From the project root, run the one-shot installer:

```bash
bash launcher/install.sh
```

The script will: check for Homebrew (install if missing) → check for Node ≥ 18 (install if missing) → `npm install` → package the Electron app with `electron-builder` → move the resulting `Apollo Dock.app` into `/Applications`.

Then launch it from Spotlight (`⌘ + Space → "Apollo Dock"`) or from the Applications folder.

## Run in development mode

```bash
npm install
npm run dev
```

This boots Electron without packaging. The tray icon appears in the macOS menu bar; right-click for **Open / Settings / Quit**.

## Adding a new tool

Apollo Dock is built so that adding a new tool requires zero changes to the dock core.

1. Create a folder under `src/tools/<your-tool>/` containing at least `index.html`. Anything else (CSS, renderer scripts, Node helpers) is up to the tool.
2. Add an entry to `config/tools-registry.json`:

```json
{
  "tools": [
    {
      "id": "your-tool",
      "name": "Your Tool",
      "icon": "🛠️",
      "description": "Short description",
      "entry": "tools/your-tool/index.html"
    }
  ]
}
```

3. Restart Apollo Dock — the new tool appears automatically in both the bubble panel and the sidebar.

If the tool needs Node-level capabilities (DNS, filesystem, network), register an `ipcMain.handle(...)` channel in `src/main.js` and expose it via `src/preload.js`, mirroring how `domain-agent:analyze` is wired up. The renderer stays sandboxed.

## Configuring API keys (placeholder)

Apollo Dock will eventually integrate with external services. None of these are active yet; the scaffolding is in place so they can be turned on without re-architecting.

Create a `.env` file at the project root (already in `.gitignore`):

```bash
# Anthropic — used by Domain Agent's "Analyze with Claude" button
# See src/tools/domain-agent/core/ai-integration.js
ANTHROPIC_API_KEY=

# Notion — used by Domain Agent's future "Save to Notion" button
# See NOTION_INTEGRATION.md
NOTION_TOKEN=
NOTION_DOMAIN_DB_ID=
```

When a key is present at launch, the corresponding UI affordance (currently disabled) will enable itself.

## License

MIT
