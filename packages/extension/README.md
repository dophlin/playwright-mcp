# OpenMate Extension

The OpenMate Extension is a Chrome/Chromium extension that bridges the
OpenMate MCP server to your existing browser profile. Instead of spinning
up a fresh automation profile, OpenMate drives pages you are already
signed in to — reusing your cookies, sessions, and storage — so AI agents
can act on your real logged-in state without a separate login flow.

## Prerequisites

- Chrome, Edge, or another Chromium-based browser (Developer Mode
available).
- Node.js ≥ 18 and npm (only required if you are building from source).

## Install from source (local development)

This is the supported install path while OpenMate is pre-release. A
Chrome Web Store listing will ship in a later milestone.

```bash
# Inside the OpenMate monorepo checkout:
cd playwright-mcp
npm install
cd packages/extension
npm run build
```

Then load the built extension into Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select
  `playwright-mcp/packages/extension/dist`.
4. You should see **OpenMate Extension** appear in the extensions list
  with the OpenMate icon.

## Connecting the extension to the MCP server

Run the OpenMate MCP server with the extension transport enabled (the
exact server entry point depends on which OpenMate MCP server package you
are using; it mirrors the upstream `--extension` flag):

```json
{
  "mcpServers": {
    "openmate-extension": {
      "command": "npx",
      "args": [
        "<openmate-mcp-server-package>",
        "--extension"
      ]
    }
  }
}
```

### Bypassing the connection approval dialog

By default, the extension shows an approval dialog the first time the MCP
server tries to attach to your browser. To skip that dialog on a trusted
machine:

1. Click the OpenMate Extension action, or open its status page.
2. Copy the token value displayed in the popup.
3. Add it to your MCP server config as an environment variable named
  after your token variable (the upstream convention is
   `PLAYWRIGHT_MCP_EXTENSION_TOKEN`; OpenMate keeps the same variable
   name in Milestone 1 to stay drop-in compatible with existing setups):

```json
{
  "mcpServers": {
    "openmate-extension": {
      "command": "npx",
      "args": ["<openmate-mcp-server-package>", "--extension"],
      "env": {
        "PLAYWRIGHT_MCP_EXTENSION_TOKEN": "your-token-here"
      }
    }
  }
}
```

The token is unique to your browser profile. Treat it like a password.

## Scope for Milestone 1

This version of the OpenMate Extension is intentionally branding-only on
top of its upstream bridge. Connection, permissions, and the underlying
CDP relay behavior are unchanged. Popup shell UI (Geist typography, the
OpenMate dashboard affordances, and the Overlay HUD) ships in a later
milestone — see
`[specs/001-milestone-1-completion/spec.md](../../../specs/001-milestone-1-completion/spec.md)`
and
`[documents/Openmate_m1_execution_plan.md](../../../documents/Openmate_m1_execution_plan.md)`
in the OpenMate monorepo for the full roadmap.

---

## NOTICE

This extension is derived from `microsoft/playwright-mcp`
(the `packages/extension` workspace), which is distributed under the
Apache License, Version 2.0. OpenMate's modifications — metadata, brand
text, icons, popup titles, and an additive CSS token layer — are also
licensed under Apache-2.0. See `LICENSE` at the repository root for the
full license text, and upstream
[https://github.com/microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) for the original source and
copyright notices.