# Claude for Firefox

Community port of Anthropic's Claude browser extension for Firefox.

This project provides a compatibility layer that lets Claude's browser extension
run natively in Firefox, including sidebar chat, browser automation, and
integration with Claude Code and Claude Desktop.

---

## Features

- Sidebar chat interface for conversing with Claude
- Browser navigation, clicking, and form filling via agent actions
- Claude Code integration through native messaging
- Claude Desktop integration
- Scheduled tasks and multi-tab workflows
- Accessibility tree for reading page content
- Visual indicators during agent actions (highlights, overlays)
- Keyboard shortcut: Cmd+E (macOS) / Ctrl+E (Linux, Windows)

## Prerequisites

- Firefox 128 or later
- Claude Code installed and logged in (`claude --version` to verify)
- Node.js 18+ (provides `npx web-ext` for the launcher script)

## Installation

Clone the repository and run the installer for your platform:

**macOS / Linux:**

```
git clone https://github.com/anthropics/claude-for-firefox.git
cd claude-for-firefox
./install.sh
```

**Windows (PowerShell):**

```
git clone https://github.com/anthropics/claude-for-firefox.git
cd claude-for-firefox
powershell -ExecutionPolicy Bypass -File install.ps1
```

The installer will:

1. Extract OAuth tokens from your existing Claude Code session.
2. Register native messaging host manifests for Firefox.
3. Launch Firefox with the extension loaded via `web-ext run`.

## Usage

**Launching the extension:**

After installation, start the extension with the provided launcher:

```
# macOS / Linux
./launch.sh

# Windows
powershell -File launch.ps1
```

Or load it manually: open `about:debugging#/runtime/this-firefox`, click
"Load Temporary Add-on", and select `manifest.json` from this directory.

**Keyboard shortcut:**

Press Cmd+E (macOS) or Ctrl+E (Linux/Windows) to toggle the Claude sidebar.

**Claude Code discovery:**

Claude Code discovers the extension through the native messaging hosts
registered during installation. The flag `--chrome-native-host` works for
Firefox as well -- no separate flag is needed.

## How It Works

Firefox does not support all Chrome extension APIs. This port includes a
compatibility shim (`chrome-compat.js`) that bridges the gaps:

- **Sidebar:** Uses Firefox's `sidebar_action` API instead of Chrome's
  `sidePanel`.
- **Tab groups:** Emulated in-memory. Firefox has no tab-group API, so groups
  are tracked virtually without visual indicators in the tab bar.
- **Debugger API:** Chrome's `chrome.debugger` is not available in Firefox.
  Agent actions that need script injection fall back to
  `browser.scripting.executeScript`.
- **Native messaging:** Manifests are placed in Firefox's per-platform
  native-messaging-hosts directory (or Windows registry) instead of Chrome's.
- **OAuth tokens:** Firefox's `identity.getRedirectURL()` returns a URL that
  Anthropic's OAuth server does not accept. Tokens are bootstrapped from
  Claude Code's existing authenticated session and injected at install time.

Two native messaging hosts are registered:

| Host name | Purpose |
|---|---|
| `com.anthropic.claude_browser_extension` | Browser extension communication |
| `com.anthropic.claude_code_browser_extension` | Claude Code integration |

## Known Limitations

- **Tab groups are virtual.** Groups are tracked internally but do not appear
  as visual groupings in Firefox's tab bar.
- **Debugger API is limited.** Actions that rely on Chrome's debugger protocol
  use `scripting.executeScript` as a fallback, which may behave differently in
  edge cases.
- **OAuth tokens need periodic refresh.** Because tokens are bootstrapped from
  Claude Code rather than obtained through a browser OAuth flow, they expire.
  Re-run the token refresh script when authentication errors appear.

## Token Refresh

Tokens extracted from Claude Code expire periodically. When you see
authentication errors in the sidebar, refresh them:

```
# macOS / Linux
./refresh-tokens.sh

# Windows
powershell -File refresh-tokens.ps1
```

This reads current tokens from Claude Code's credential store and updates
`firefox-injected-tokens.json`. The extension picks up new tokens
automatically on the next API call.

## Troubleshooting

**Extension does not appear in the sidebar:**

- Ensure Firefox 128+ is installed (`firefox --version`).
- Check `about:debugging#/runtime/this-firefox` for load errors.
- Verify `manifest.json` exists in the project root.

**"Native messaging host not found" errors:**

- Re-run the installer to regenerate host manifests.
- macOS: check `~/Library/Application Support/Mozilla/NativeMessagingHosts/`.
- Linux: check `~/.mozilla/native-messaging-hosts/`.
- Windows: check registry keys under
  `HKCU\Software\Mozilla\NativeMessagingHosts\`.

**Authentication errors / "token expired":**

- Run `./refresh-tokens.sh` (or `refresh-tokens.ps1` on Windows).
- Make sure Claude Code is logged in: run `claude` in a terminal and verify
  it starts without prompting for credentials.

**Agent actions fail or behave unexpectedly:**

- Some sites block content-script injection. Check the browser console
  (Ctrl+Shift+J) for errors.
- The debugger-API fallback via `scripting.executeScript` does not support all
  CDP features. Complex page interactions may not work identically to Chrome.

**`web-ext` errors on launch:**

- Ensure Node.js 18+ is installed (`node --version`).
- Run `npx web-ext lint` in the project directory to check for manifest issues.

## License

The core extension assets are from Anthropic's Claude browser extension. The
Firefox compatibility layer, installers, and native-messaging-host setup
scripts are community-contributed.

See the LICENSE file for details.

## Contributing

Contributions are welcome. Please open an issue before submitting large
changes to discuss the approach.

When submitting a pull request:

1. Ensure `npx web-ext lint` passes with no errors.
2. Test on at least one platform (macOS, Linux, or Windows).
3. Do not commit credentials, tokens, or personal paths.
