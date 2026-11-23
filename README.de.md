# ScreenConnect MCP Server

**MCP-Server für ConnectWise ScreenConnect** (Extension RESTful API Manager)  
Sessions · Notizen · Nachrichten · Befehle — mit MSP-sicheren Modi read / write / destructive

[English](README.md) · [Deutsch](README.de.md)

Inoffizielles Community-Projekt; nicht mit ConnectWise verbunden oder von ConnectWise unterstützt.

## Überblick

Der Server verbindet KI-Assistenten (ChatGPT, Claude, Gemini, …) mit einer ScreenConnect-Instanz über die Extension **RESTful API Manager**. Sicherheitsgrenzen sind **im Code** erzwungen: Standard ist read-only; Write-Tools und Destructive-Tools nur mit explizitem Opt-in.

Stack wie beim [ALSO Cloud Marketplace MCP](https://github.com/pitwch/also-cloud-marketplace-mcp): TypeScript, Node.js 20+, `@modelcontextprotocol/server`, MIT.

## Schnellstart

```bash
git clone https://github.com/pitwch/screenconnect-mcp-server.git
cd screenconnect-mcp-server
npm install
npm run build
```

Credentials setzen und im MCP-Client registrieren (`node <REPO>/dist/index.js`).

## Konfiguration

| Variable | Pflicht | Default | Zweck |
|----------|---------|---------|-------|
| `SCREENCONNECT_BASE_URL` | ja | — | HTTPS-URL der Instanz |
| `SCREENCONNECT_API_SECRET` | ja | — | `RESTfulAuthenticationSecret` (`CTRLAuthHeader`) |
| `SCREENCONNECT_MODE` | nein | `read` | `read` · `write` · `destructive` |
| `SCREENCONNECT_ENABLE_COMMANDS` | nein | `false` | Pflicht für Destructive-Tools |
| `SCREENCONNECT_ALLOWED_GROUPS` | nein | leer | Kommagetrennte Session-Gruppen |

Details: [docs/extension-setup.md](docs/extension-setup.md), [docs/security-model.md](docs/security-model.md), [`.env.example`](.env.example).

## Tools

- **Read:** `health_check`, `list_sessions`, `search_sessions`, `get_session_details`, `get_session_events`, `get_server_info`
- **Write:** `add_session_note`, `send_message_to_session`, `update_session_name`, `update_custom_properties`
- **Destructive:** `send_command_to_session`, `send_toolbox_item`, `create_session` (jeweils `confirm: true`)

## Clients / mcpproxy

Beispiele: [docs/mcpproxy.example.yaml](docs/mcpproxy.example.yaml), [docs/mcp-client.example.json](docs/mcp-client.example.json) (ChatGPT, Claude, Gemini, …).  
Empfehlung: stdio, zuerst nur lesend auf mcp.pitw.ch freigeben.

## Lizenz

MIT — [`LICENSE`](LICENSE).  
Pedrett IT+Web AG · https://www.pitw.ch
