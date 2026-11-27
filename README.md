<p align="center">
  <img src="docs/assets/banner.png" alt="MCP Server for ConnectWise ScreenConnect" width="100%" />
</p>

<p align="center">
  <img src="docs/assets/icon.png" alt="ScreenConnect MCP Server" width="96" height="96" />
</p>

<h1 align="center">ScreenConnect MCP Server</h1>

<p align="center">
  <strong>MCP server for ConnectWise ScreenConnect</strong><br/>
  Sessions · Notes · Messages · Commands — MSP-safe read / write / destructive modes
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.de.md">Deutsch</a>
</p>

<p align="center">
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-stdio-0ea5e9?style=flat-square" alt="MCP" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-22c55e?style=flat-square" alt="MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 20+" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/version-0.1.4-6366f1?style=flat-square" alt="Version 0.1.4" /></a>
  <a href="https://www.pitw.ch"><img src="https://img.shields.io/badge/by-Pedrett%20IT%2BWeb%20AG-0f172a?style=flat-square" alt="Pedrett IT+Web AG" /></a>
</p>

Unofficial community project; not affiliated with or endorsed by ConnectWise.

---

## Overview

This server connects AI assistants (ChatGPT, Claude, Gemini, …) to a ScreenConnect instance via the **RESTful API Manager** extension. Security boundaries are enforced **in code**: default read-only mode, optional write tools, and destructive command/toolbox tools only with explicit opt-in.

| | |
|---|---|
| **Protocol** | [Model Context Protocol](https://modelcontextprotocol.io) (stdio; HTTP probe optional) |
| **API** | ConnectWise Labs RESTful API Manager |
| **Stack** | TypeScript · Node.js 20+ · `@modelcontextprotocol/server` |
| **License** | MIT |

### Highlights

- `SCREENCONNECT_MODE=read|write|destructive` with tools hidden when disabled
- `SCREENCONNECT_ENABLE_COMMANDS` + `confirm: true` for high-impact actions
- Session-group allowlist and secret-free stderr audit log
- Same TypeScript/MCP stack style as [also-cloud-marketplace-mcp](https://github.com/pitwch/also-cloud-marketplace-mcp)

---

## Table of contents

- [Quick start](#quick-start)
- [ScreenConnect extension setup](#screenconnect-extension-setup)
- [Configuration](#configuration)
- [Client setup](#client-setup)
- [Tools](#tools)
- [Docker](#docker)
- [Development](#development)
- [Links](#links)
- [License & provider](#license--provider)

---

## Quick start

```bash
git clone https://github.com/pitwch/screenconnect-mcp-server.git
cd screenconnect-mcp-server
npm install
npm run build
```

Set credentials (see [Configuration](#configuration)) and register the server in your MCP client:

```text
command: node
args:    [<REPO>/dist/index.js]
```

---

## ScreenConnect extension setup

**Start here if you do not have a REST secret yet.**

Full tutorial (install extension → create `RESTfulAuthenticationSecret` → curl probe → MCP env):

- English: [docs/extension-setup.md](docs/extension-setup.md)
- Deutsch: [docs/extension-setup.de.md](docs/extension-setup.de.md)

Short version:

1. **Administration → Extensions** → install **RESTful API Manager** (ConnectWise Labs).
2. **⋮ → Edit Settings** → set `RESTfulAuthenticationSecret` (long random secret / GUID). That value is `SCREENCONNECT_API_SECRET` and is sent as `CTRLAuthHeader`.
3. Optional: set `RESTfulAllowedOrigin` and mirror it as `SCREENCONNECT_ORIGIN`.
4. Probe with curl (`GetSessionsByFilter`), then start this server with `SCREENCONNECT_MODE=read`.

---

## Configuration

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SCREENCONNECT_BASE_URL` | yes | — | Instance HTTPS URL |
| `SCREENCONNECT_API_SECRET` | yes | — | Extension `RESTfulAuthenticationSecret` (`CTRLAuthHeader`) |
| `SCREENCONNECT_EXTENSION_ID` | no | `2d558935-686a-4bd0-9991-07539f5fe749` | Extension GUID |
| `SCREENCONNECT_ORIGIN` | no | — | Must match `RESTfulAllowedOrigin` when set |
| `SCREENCONNECT_ALLOWED_GROUPS` | no | empty | Full session-group paths (comma-separated) |
| `SCREENCONNECT_MODE` | no | `read` | `read` · `write` · `destructive` |
| `SCREENCONNECT_ENABLE_COMMANDS` | no | `false` | Required for destructive tools |
| `SCREENCONNECT_TIMEOUT_MS` | no | `30000` | Per-call timeout |
| `MCP_TRANSPORT` | no | `stdio` | Prefer `stdio` for mcpproxy (`http` is a limited stub) |

See [`.env.example`](.env.example) and [docs/security-model.md](docs/security-model.md).

---

## Tools

### Read (`SCREENCONNECT_MODE=read`)

| Tool | Purpose |
|------|---------|
| `health_check` | Reachability + auth probe |
| `list_sessions` / `search_sessions` | `GetSessionsByFilter` (structured or raw filter) |
| `get_session_details` | OS, user, IP, custom properties, online state |
| `get_session_events` | Events from session details |
| `get_server_info` | Local mode/allowlist metadata |

### Write (`MODE=write`)

| Tool | Purpose |
|------|---------|
| `add_session_note` | Append note |
| `send_message_to_session` | Guest message |
| `update_session_name` | Rename |
| `update_custom_properties` | Merge slots 1–8 |

### Destructive (`MODE=destructive` + `ENABLE_COMMANDS=true` + `confirm: true`)

| Tool | Purpose |
|------|---------|
| `send_command_to_session` | Queue cmd/PowerShell; optional output poll |
| `send_toolbox_item` | Run toolbox item |
| `create_session` | Create Support/Meeting/Access session |

---

## Client setup

<details>
<summary><strong>ChatGPT / Claude / Gemini</strong></summary>

Most MCP clients use a JSON `mcpServers` block. Start from [docs/mcp-client.example.json](docs/mcp-client.example.json) and adjust the path and env values for your host (ChatGPT Desktop/Codex, Claude Desktop/Code, Gemini CLI, …).

</details>

<details>
<summary><strong>mcpproxy</strong></summary>

See [docs/mcpproxy.example.yaml](docs/mcpproxy.example.yaml). Use **stdio** only. Start with read mode on mcp.pitw.ch before enabling write/destructive.

</details>

---

## Docker

```bash
docker build -t screenconnect-mcp-server .
docker run --rm -i \
  -e SCREENCONNECT_BASE_URL=https://your-instance.example.com \
  -e SCREENCONNECT_API_SECRET=... \
  -e SCREENCONNECT_MODE=read \
  screenconnect-mcp-server
```

Runs as non-root. Do not publish the HTTP port on the public internet.

---

## Development

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke
```

Live fixture capture (lab instance only): `npm run capture-fixtures`  
(`*.live.json` is gitignored.)

**Important:** write only MCP JSON-RPC to stdout — log exclusively with `console.error`.

### Releasing

Each `package.json` version gets a GitHub Release (`vX.Y.Z`) with notes from [`CHANGELOG.md`](CHANGELOG.md).

```bash
# 1. Bump version in package.json + CHANGELOG.md, commit to main
# 2. Tag and push — CI publishes the release automatically
git tag -a v0.1.5 -m "v0.1.5"
git push origin v0.1.5
```

Releases: https://github.com/pitwch/screenconnect-mcp-server/releases

The `publish-mcp.yml` workflow publishes the npm package and then `server.json` to the [official MCP Registry](https://registry.modelcontextprotocol.io) (`io.github.pitwch/screenconnect-mcp-server`). It needs the repository secret `NPM_TOKEN`; registry auth uses GitHub OIDC. Keep `version` in `package.json` and `server.json` in sync.

---

## Links

| Resource | URL |
|----------|-----|
| Repository | https://github.com/pitwch/screenconnect-mcp-server |
| Extension setup | [docs/extension-setup.md](docs/extension-setup.md) |
| ALSO Cloud MCP (sibling) | https://github.com/pitwch/also-cloud-marketplace-mcp |
| MCP Spec | https://modelcontextprotocol.io |
| Provider | https://www.pitw.ch |
| Social preview | [`docs/assets/social-preview.png`](docs/assets/social-preview.png) (1280×640 — GitHub → Settings → General → Social preview) |

---

## License & provider

MIT License — see [`LICENSE`](LICENSE).

<br/>

<p align="center">
  <a href="https://www.pitw.ch">
    <img src="docs/assets/pedrett-logo.svg" alt="Pedrett IT+Web AG" height="72" />
  </a>
</p>

<p align="center">
  <strong>Developed and provided by</strong><br/>
  <a href="https://www.pitw.ch"><strong>Pedrett IT+Web AG</strong></a><br/>
  <a href="https://www.pitw.ch">www.pitw.ch</a>
</p>

<p align="center">
  <em>Full automation and support — directly from the developer.</em>
</p>

<p align="center">
  <sub>Murgtalstrasse 20 · 9542 Münchwilen TG · Switzerland · <a href="mailto:info@pitw.ch">info@pitw.ch</a></sub>
</p>
