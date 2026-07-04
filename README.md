# Apollo Dock

A floating macOS desktop launcher for the Apollo.io Product Advocate & Technical Support team. Always visible on top of any app, it gives you instant access to internal support tools without leaving your workflow.

---

## Installation

1. Go to the [latest release](https://github.com/ciberhec/Apollo-Dock/releases/latest)
2. Download the file for your Mac:
   - **Apple Silicon (M1/M2/M3/M4):** `Apollo Dock-x.x.x-arm64-mac.zip`
   - **Intel:** `Apollo Dock-x.x.x-mac.zip`
3. Unzip and drag **Apollo Dock.app** to your Applications folder
4. Open it from Spotlight (`⌘ Space → "Apollo Dock"`) or from Applications

> **First launch:** macOS may show a security prompt since the app is not distributed through the App Store. Go to **System Settings → Privacy & Security** and click **Open Anyway**.

---

## Interface modes

Apollo Dock runs in two modes, switchable from Settings:

| Mode | Description |
|---|---|
| **Bubble** | A small floating circle you can drag anywhere on screen. Click it to expand the tool panel. |
| **Sidebar** | An edge-anchored panel always visible on the side of your screen. |

---

## Tools

### 🌐 Domain Agent

Checks a domain's email authentication setup (SPF, DKIM, DMARC) and blacklist status, and generates a customer-ready reply you can send directly.

**How to use:**
1. Click **Domain Agent** from the dock
2. Type the customer's domain (e.g. `company.com`) and click **Run Analysis**
3. Review the **Status Summary** — each check shows PASS or FAIL with the raw DNS record
4. Read the **Step-by-step Fix Guide** for any failures — it includes provider-specific instructions
5. Copy the **Customer-Ready Message** to your clipboard, or edit it directly before sending

**Subdomain support:** If you enter a subdomain (e.g. `mail.company.com`), Domain Agent also checks the root domain and flags any differences between the two.

---

## Settings

Open Settings by clicking the ⚙️ icon in the dock panel.

| Setting | Description |
|---|---|
| **Display Mode** | Switch between Bubble and Sidebar |
| **Opacity** | Adjust the transparency of the dock (0–100%) |
| **Theme** | Dark or Light |
| **Check for updates** | Manually check for a new version. If an update is available, you can download and install it in one click — Apollo Dock will restart automatically. |

---

## Updates

Apollo Dock checks for updates automatically every 6 hours. When a new version is available, you'll see a notification in the Settings panel. Click **Install update** and the app will download, verify, and relaunch itself — no manual download needed.

---

## License

MIT
