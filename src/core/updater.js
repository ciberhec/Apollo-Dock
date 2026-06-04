/**
 * Apollo Dock — in-app updater.
 *
 * Flow (Option B, see project documentation §13):
 *   1. Poll GitHub Releases for the latest tag.
 *   2. If the tag is newer than the packaged version, broadcast `available`.
 *   3. When the user confirms, download the .zip release asset to userData,
 *      verify its SHA-256 against the value embedded in the release body,
 *      extract via macOS `ditto`, and hand off to a relauncher script that
 *      swaps the bundle and re-opens it.
 *
 * The relauncher script lives outside the .app bundle so the swap survives
 * the bundle being replaced. No code-signing required: the .zip is fetched
 * directly via HTTPS (Electron's net module), so macOS never sets the
 * quarantine bit on the downloaded file.
 */

const { app, BrowserWindow, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REPO_OWNER = 'ciberhec';
const REPO_NAME = 'Apollo-Dock';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STATE_CHANNEL = 'updater:state-changed';

const RELAUNCHER_SCRIPT = `#!/usr/bin/env bash
# Apollo Dock — bundle swap relauncher.
# Args: parent_pid running_app_path staged_app_path
set -u

PARENT_PID="\${1:-}"
RUNNING_APP="\${2:-}"
STAGED_APP="\${3:-}"

if [[ -z "$PARENT_PID" || -z "$RUNNING_APP" || -z "$STAGED_APP" ]]; then
  echo "relauncher: missing arguments" >&2
  exit 64
fi

# Wait up to 30s for the parent Electron process to exit.
for _ in $(seq 1 60); do
  if ! kill -0 "$PARENT_PID" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

BACKUP_APP="\${RUNNING_APP}.old"
[[ -d "$BACKUP_APP" ]] && rm -rf "$BACKUP_APP"

if [[ -d "$RUNNING_APP" ]]; then
  mv "$RUNNING_APP" "$BACKUP_APP"
fi

if mv "$STAGED_APP" "$RUNNING_APP"; then
  rm -rf "$BACKUP_APP"
  open "$RUNNING_APP"
  exit 0
fi

# Rollback if the swap failed.
[[ -d "$RUNNING_APP" ]] && rm -rf "$RUNNING_APP"
[[ -d "$BACKUP_APP" ]] && mv "$BACKUP_APP" "$RUNNING_APP"
[[ -d "$RUNNING_APP" ]] && open "$RUNNING_APP"
exit 1
`;

let currentState = { phase: 'idle', message: null, available: null, progress: null, error: null };
let scheduledTimer = null;

function broadcast() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(STATE_CHANNEL, currentState);
  }
}

function setState(patch) {
  currentState = { ...currentState, ...patch };
  broadcast();
}

function getState() {
  return currentState;
}

// -----------------------------------------------------------------------------
// GitHub release lookup
// -----------------------------------------------------------------------------

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = net.request({
      method: 'GET',
      url: `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Apollo-Dock-Updater' }
    });
    let body = '';
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API responded ${res.statusCode}`));
        res.on('data', () => {});
        return;
      }
      res.on('data', (chunk) => { body += chunk.toString('utf8'); });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function parseVersion(tag) {
  const m = String(tag || '').match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compareVersions(a, b) {
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function parseSha256FromBody(body) {
  if (!body) return null;
  const m = body.match(/SHA-?256[^a-f0-9]*([a-f0-9]{64})/i);
  return m ? m[1].toLowerCase() : null;
}

function pickMacZipAsset(release) {
  if (!release || !Array.isArray(release.assets)) return null;
  return release.assets.find((a) =>
    /\.zip$/i.test(a.name) && /(mac|darwin)/i.test(a.name)
  ) || null;
}

// -----------------------------------------------------------------------------
// Check for update
// -----------------------------------------------------------------------------

async function checkForUpdate({ manual = false } = {}) {
  if (currentState.phase === 'downloading' ||
      currentState.phase === 'verifying' ||
      currentState.phase === 'staging' ||
      currentState.phase === 'installing') {
    return currentState;
  }
  setState({ phase: 'checking', error: null, message: 'Checking for updates…' });
  try {
    const release = await fetchLatestRelease();
    const latest = parseVersion(release.tag_name);
    const current = parseVersion(app.getVersion());
    if (!latest || !current) {
      throw new Error('Could not parse version numbers.');
    }
    if (compareVersions(latest, current) <= 0) {
      setState({ phase: 'idle', available: null, message: manual ? 'You are on the latest version.' : null });
      return currentState;
    }

    const asset = pickMacZipAsset(release);
    if (!asset) {
      throw new Error('No macOS .zip asset attached to the latest release.');
    }
    const sha256 = parseSha256FromBody(release.body);
    if (!sha256) {
      throw new Error('Release body is missing a SHA-256 checksum.');
    }

    setState({
      phase: 'available',
      available: {
        version: release.tag_name.replace(/^v/, ''),
        notes: release.body || '',
        downloadUrl: asset.browser_download_url,
        assetName: asset.name,
        sha256,
        publishedAt: release.published_at
      },
      message: null
    });
    return currentState;
  } catch (err) {
    setState({ phase: 'error', error: err.message || String(err), message: null });
    return currentState;
  }
}

// -----------------------------------------------------------------------------
// Download + verify
// -----------------------------------------------------------------------------

function updateWorkDir() {
  const dir = path.join(app.getPath('userData'), 'updater');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function downloadToFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const req = net.request({
      method: 'GET',
      url,
      redirect: 'follow',
      headers: { 'User-Agent': 'Apollo-Dock-Updater' }
    });
    let total = 0;
    let received = 0;
    const out = fs.createWriteStream(destPath);
    let lastEmit = 0;

    req.on('response', (res) => {
      if (res.statusCode >= 400) {
        out.destroy();
        reject(new Error(`Download responded ${res.statusCode}`));
        return;
      }
      const len = Number(res.headers['content-length'] || 0);
      total = Array.isArray(len) ? Number(len[0]) : len;
      res.on('data', (chunk) => {
        received += chunk.length;
        out.write(chunk);
        const now = Date.now();
        if (onProgress && now - lastEmit > 250) {
          lastEmit = now;
          onProgress({ received, total });
        }
      });
      res.on('end', () => {
        out.end(() => {
          if (onProgress) onProgress({ received, total: total || received });
          resolve({ bytes: received });
        });
      });
      res.on('error', (err) => { out.destroy(); reject(err); });
    });
    req.on('error', (err) => { out.destroy(); reject(err); });
    req.end();
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// -----------------------------------------------------------------------------
// Stage + swap
// -----------------------------------------------------------------------------

function extractZipWithDitto(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = spawnSync('/usr/bin/ditto', ['-x', '-k', zipPath, destDir], { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error('ditto failed to extract the update archive.');
  }
}

function findStagedApp(stagedDir) {
  const entries = fs.readdirSync(stagedDir);
  const candidate = entries.find((name) => name.endsWith('.app'));
  if (candidate) return path.join(stagedDir, candidate);
  // electron-builder sometimes nests the .app under mac-arm64/ or mac/.
  for (const name of entries) {
    const sub = path.join(stagedDir, name);
    if (fs.statSync(sub).isDirectory()) {
      const inner = fs.readdirSync(sub).find((n) => n.endsWith('.app'));
      if (inner) return path.join(sub, inner);
    }
  }
  return null;
}

function writeRelauncher() {
  const scriptPath = path.join(updateWorkDir(), 'relauncher.sh');
  fs.writeFileSync(scriptPath, RELAUNCHER_SCRIPT, { mode: 0o755 });
  return scriptPath;
}

function currentAppBundlePath() {
  // app.getPath('exe') in a packed mac build is .../Apollo Dock.app/Contents/MacOS/Apollo Dock.
  const exe = app.getPath('exe');
  const idx = exe.indexOf('.app/');
  if (idx === -1) return null;
  return exe.slice(0, idx + 4);
}

async function installUpdate() {
  if (!app.isPackaged) {
    setState({ phase: 'error', error: 'Cannot install updates in development mode.' });
    return currentState;
  }
  if (currentState.phase !== 'available' || !currentState.available) {
    setState({ phase: 'error', error: 'No update is ready to install.' });
    return currentState;
  }

  const info = currentState.available;
  const workDir = updateWorkDir();
  const zipPath = path.join(workDir, info.assetName);
  const stagingDir = path.join(workDir, `staging-${info.version}`);

  try {
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });

    setState({ phase: 'downloading', progress: { received: 0, total: 0 }, error: null });
    await downloadToFile(info.downloadUrl, zipPath, (p) => {
      setState({ progress: p });
    });

    setState({ phase: 'verifying', message: 'Verifying download…', progress: null });
    const actual = await sha256File(zipPath);
    if (actual !== info.sha256) {
      fs.unlinkSync(zipPath);
      throw new Error('Checksum mismatch. The downloaded file was corrupted; please try again.');
    }

    setState({ phase: 'staging', message: 'Preparing update…' });
    extractZipWithDitto(zipPath, stagingDir);
    const stagedApp = findStagedApp(stagingDir);
    if (!stagedApp) {
      throw new Error('Update archive did not contain a .app bundle.');
    }

    const runningApp = currentAppBundlePath();
    if (!runningApp) {
      throw new Error('Could not locate the running app bundle.');
    }

    const relauncher = writeRelauncher();

    setState({ phase: 'installing', message: 'Installing update — Apollo Dock will restart.' });

    // Spawn the relauncher detached so it survives our exit, then quit.
    spawn('/bin/bash', [relauncher, String(process.pid), runningApp, stagedApp], {
      detached: true,
      stdio: 'ignore'
    }).unref();

    setTimeout(() => app.quit(), 250);
    return currentState;
  } catch (err) {
    setState({ phase: 'error', error: err.message || String(err), message: null, progress: null });
    return currentState;
  }
}

// -----------------------------------------------------------------------------
// Scheduling
// -----------------------------------------------------------------------------

function start() {
  if (!app.isPackaged) {
    setState({ phase: 'idle', message: 'Updater disabled in development mode.' });
    return;
  }
  // Initial check shortly after launch (don't block the UI).
  setTimeout(() => { checkForUpdate().catch(() => {}); }, 5_000);
  if (scheduledTimer) clearInterval(scheduledTimer);
  scheduledTimer = setInterval(() => { checkForUpdate().catch(() => {}); }, CHECK_INTERVAL_MS);
}

function stop() {
  if (scheduledTimer) clearInterval(scheduledTimer);
  scheduledTimer = null;
}

module.exports = {
  start,
  stop,
  checkForUpdate,
  installUpdate,
  getState,
  STATE_CHANNEL
};
