# ScreenConnect MCP Server

**MCP server for ConnectWise ScreenConnect** (RESTful API Manager extension)  
Sessions · Notes · Messages · Commands — with MSP-safe read / write / destructive modes

[English](README.md) · [Deutsch](README.de.md)

[![MCP](https://img.shields.io/badge/MCP-stdio-0ea5e9?style=flat-square)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![version](https://img.shields.io/badge/version-0.1.0-6366f1?style=flat-square)](package.json)
[![by Pedrett IT+Web AG](https://img.shields.io/badge/by-Pedrett%20IT%2BWeb%20AG-0f172a?style=flat-square)](https://www.pitw.ch)

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

## Configuration

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SCREENCONNECT_BASE_URL` | yes | — | Instance HTTPS URL |
| `SCREENCONNECT_API_SECRET` | yes | — | Extension `RESTfulAuthenticationSecret` (`CTRLAuthHeader`) |
| `SCREENCONNECT_EXTENSION_ID` | no | `2d558935-686a-4bd0-9991-07539f5fe749` | Extension GUID |
| `SCREENCONNECT_ORIGIN` | no | — | Must match `RESTfulAllowedOrigin` when set |
| `SCREENCONNECT_ALLOWED_GROUPS` | no | empty | Comma-separated group paths/names |
| `SCREENCONNECT_MODE` | no | `read` | `read` · `write` · `destructive` |
| `SCREENCONNECT_ENABLE_COMMANDS` | no | `false` | Required for destructive tools |
| `SCREENCONNECT_TIMEOUT_MS` | no | `30000` | Per-call timeout |
| `MCP_TRANSPORT` | no | `stdio` | `stdio` or `http` |

See [`.env.example`](.env.example), [docs/extension-setup.md](docs/extension-setup.md), and [docs/security-model.md](docs/security-model.md).

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

See [docs/mcpproxy.example.yaml](docs/mcpproxy.example.yaml). Prefer **stdio**. Start with read mode on mcp.pitw.ch before enabling write/destructive.

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

**Important:** write only MCP JSON-RPC to stdout — log exclusively with `console.error`.

---

## Links

| Resource | URL |
|----------|-----|
| Repository | https://github.com/pitwch/screenconnect-mcp-server |
| ALSO Cloud MCP (sibling) | https://github.com/pitwch/also-cloud-marketplace-mcp |
| MCP Spec | https://modelcontextprotocol.io |
| Provider | https://www.pitw.ch |

---

## License & provider

MIT License — see [`LICENSE`](LICENSE).

**Developed and provided by [Pedrett IT+Web AG](https://www.pitw.ch)**  
Murgtalstrasse 20 · 9542 Münchwilen TG · Switzerland · info@pitw.ch
