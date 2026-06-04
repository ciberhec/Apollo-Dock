#!/usr/bin/env bash
# Apollo Dock — one-shot installer for macOS.
# Installs Homebrew (if missing), Node.js >= 18, npm deps, packages the
# Electron app with electron-builder, and installs the resulting .app into
# ~/Applications.
#
# Why ~/Applications instead of /Applications: the in-app updater needs to
# swap the .app bundle in place without prompting the user for an admin
# password every release. ~/Applications is user-writable; /Applications is
# not. Spotlight, the Dock, and Launchpad all index ~/Applications normally.

set -euo pipefail

bold()   { printf "\033[1m%s\033[0m\n" "$*"; }
green()  { printf "\033[1;32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[1;33m%s\033[0m\n" "$*"; }
red()    { printf "\033[1;31m%s\033[0m\n" "$*"; }

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "${SCRIPT_DIR}/.." && pwd )"

bold "==> Apollo Dock installer"
bold "    Project root: ${PROJECT_ROOT}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  red "This installer targets macOS only. Detected: $(uname -s)"
  exit 1
fi

# 1. Homebrew --------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  yellow "==> Homebrew not found. Installing…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
else
  green "==> Homebrew already installed."
fi

# 2. Node.js >= 18 ---------------------------------------------------------
needs_node_install=0
if command -v node >/dev/null 2>&1; then
  current_major=$(node -p "process.versions.node.split('.')[0]")
  if (( current_major < 18 )); then
    yellow "==> Node $(node -v) is older than 18. Upgrading via Homebrew…"
    needs_node_install=1
  else
    green "==> Node $(node -v) detected."
  fi
else
  yellow "==> Node.js not found. Installing via Homebrew…"
  needs_node_install=1
fi

if (( needs_node_install == 1 )); then
  brew install node
fi

# 3. npm install -----------------------------------------------------------
cd "${PROJECT_ROOT}"
bold "==> Installing npm dependencies (this can take a minute)…"
npm install

# 4. Build (electron-builder) ---------------------------------------------
# Use `pack` (electron-builder --dir) here, not the full `build` — this
# produces only the .app bundle the installer needs to copy. The full
# `build` target also creates DMG and ZIP artifacts; those are only useful
# for publishing releases and the DMG step is flaky on recent macOS
# versions because of a known hdiutil "No such file or directory" bug.
# Testers do not need release artifacts, so we skip them entirely here.
bold "==> Packaging Apollo Dock with electron-builder…"
npm run pack

# 5. Install .app into ~/Applications -------------------------------------
APP_NAME="Apollo Dock.app"
SRC_APP=""
for candidate in \
  "${PROJECT_ROOT}/dist/mac-arm64/${APP_NAME}" \
  "${PROJECT_ROOT}/dist/mac/${APP_NAME}" \
  "${PROJECT_ROOT}/dist/mac-x64/${APP_NAME}" \
  "${PROJECT_ROOT}/dist/mac-universal/${APP_NAME}"
do
  if [[ -d "${candidate}" ]]; then
    SRC_APP="${candidate}"
    break
  fi
done

if [[ -z "${SRC_APP}" ]]; then
  red "==> Could not locate built ${APP_NAME} under ${PROJECT_ROOT}/dist/. Check electron-builder output above."
  exit 1
fi

USER_APPS="${HOME}/Applications"
DEST="${USER_APPS}/${APP_NAME}"
LEGACY_DEST="/Applications/${APP_NAME}"

mkdir -p "${USER_APPS}"

# One-time migration: if a previous install lives in /Applications, remove it.
# Requires sudo because /Applications isn't user-writable. We only need this
# once; future updates will land in ~/Applications without any sudo prompt.
if [[ -d "${LEGACY_DEST}" ]]; then
  yellow "==> Detected legacy install at ${LEGACY_DEST}."
  yellow "    Removing it so the new install in ${USER_APPS} is the only copy."
  yellow "    (You may be prompted for your password — this is a one-time step.)"
  sudo rm -rf "${LEGACY_DEST}"
fi

if [[ -d "${DEST}" ]]; then
  yellow "==> Removing previous installation at ${DEST}…"
  rm -rf "${DEST}"
fi

bold "==> Installing to ${DEST}…"
cp -R "${SRC_APP}" "${DEST}"

green ""
green "================================================================"
green "  Apollo Dock installed successfully."
green ""
green "  • Launch:    open \"${DEST}\""
green "  • Or: Spotlight (⌘ + Space) → \"Apollo Dock\""
green "  • Right-click the tray icon for Open / Settings / Quit."
green ""
green "  First launch: macOS will warn that the app is from an"
green "  unidentified developer. Right-click the app → Open → Open."
green "  This only happens once. Future updates happen in-app with"
green "  no Gatekeeper prompt."
green "================================================================"
