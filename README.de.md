<p align="center">
  <img src="docs/assets/banner.png" alt="MCP Server für ConnectWise ScreenConnect" width="100%" />
</p>

<p align="center">
  <img src="docs/assets/icon.png" alt="ScreenConnect MCP Server" width="96" height="96" />
</p>

<h1 align="center">ScreenConnect MCP Server</h1>

<p align="center">
  <strong>MCP-Server für ConnectWise ScreenConnect</strong><br/>
  Sessions · Notizen · Nachrichten · Befehle — MSP-sichere Modi read / write / destructive
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.de.md">Deutsch</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/screenconnect-mcp-server"><img src="https://img.shields.io/npm/v/screenconnect-mcp-server?style=flat-square&logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://registry.modelcontextprotocol.io/v0.1/servers/io.github.pitwch%2Fscreenconnect-mcp-server/versions/latest"><img src="https://img.shields.io/badge/MCP_Registry-io.github.pitwch-6366f1?style=flat-square" alt="Official MCP Registry" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-stdio%20%7C%20Streamable%20HTTP-0ea5e9?style=flat-square" alt="MCP stdio und Streamable HTTP" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-22c55e?style=flat-square" alt="MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 20+" /></a>
</p>

Inoffizielles Community-Projekt; nicht mit ConnectWise verbunden oder von ConnectWise unterstützt.

## Überblick

Der Server verbindet KI-Assistenten (ChatGPT, Claude, Gemini, …) mit einer ScreenConnect-Instanz über die Extension **RESTful API Manager**. Sicherheitsgrenzen sind **im Code** erzwungen: Standard ist read-only; Write-Tools unterstützen `dryRun: true`, und Destructive-Tools sind nur mit explizitem Opt-in aktiv.

- **Eigenständige Token-Auth (kein Admin-Passwort, kein Vendor-Lock-in):** Direkte Verbindung über `RESTfulAuthenticationSecret` (`CTRLAuthHeader`) statt Basic Auth oder SaaS-Zwischenproxy.
- **3 Sicherheitsstufen im Code:** `read` (Standard) · `write` (`dryRun`-Vorschau) · `destructive` (`SCREENCONNECT_ENABLE_COMMANDS=true`, `confirm: true`, optional `expectedName`-Zielprüfung).
- **Verifizierte Releases:** Sigstore-signierte npm-Releases via OIDC Trusted Publishing, gelistet in der offiziellen [MCP Registry](https://registry.modelcontextprotocol.io) (`io.github.pitwch/screenconnect-mcp-server`), inkl. Claude-Desktop-`.mcpb`-Bundle.

Stack wie beim [ALSO Cloud Marketplace MCP](https://github.com/pitwch/also-cloud-marketplace-mcp): TypeScript, Node.js 20+, `@modelcontextprotocol/server`, MIT.

## Schnellstart

### Option 1: `npx` (empfohlen)

```json
{
  "mcpServers": {
    "screenconnect": {
      "command": "npx",
      "args": ["-y", "screenconnect-mcp-server"],
      "env": {
        "SCREENCONNECT_BASE_URL": "https://your-instance.example.com",
        "SCREENCONNECT_API_SECRET": "your-restful-api-manager-secret",
        "SCREENCONNECT_MODE": "read"
      }
    }
  }
}
```

### Option 2: Claude Desktop One-Click-Bundle (`.mcpb`)

1. `screenconnect-mcp-server-vX.Y.Z.mcpb` aus den [GitHub Releases](https://github.com/pitwch/screenconnect-mcp-server/releases) laden.
2. Per Doppelklick in **Claude Desktop** installieren und Base URL sowie REST-Secret eingeben (Standardmodus: `read`).

### Option 3: Streamable HTTP (Docker / Server / `mcpproxy`)

```bash
SCREENCONNECT_BASE_URL=https://your-instance.example.com \
SCREENCONNECT_API_SECRET=... \
MCP_TRANSPORT=http \
MCP_HTTP_BEARER_TOKEN="$(openssl rand -hex 32)" \
npx -y screenconnect-mcp-server
```

Stellt MCP Streamable HTTP unter `http://127.0.0.1:8080/mcp` (Bearer ≥ 32 Zeichen + Host/Origin-Prüfung) sowie `GET /health` bereit.

## Extension & Secret einrichten

**Hier starten, wenn ihr noch kein REST-Secret habt.**

Schritt-für-Schritt (Extension installieren → `RESTfulAuthenticationSecret` setzen → curl-Test → MCP-Env):

- [docs/extension-setup.de.md](docs/extension-setup.de.md) (Deutsch)
- [docs/extension-setup.md](docs/extension-setup.md) (English)

Kurzfassung:

1. **Administration → Extensions** → **RESTful API Manager** (ConnectWise Labs) installieren.
2. **⋮ → Edit Settings** → `RESTfulAuthenticationSecret` setzen (langer Zufallswert). Das ist `SCREENCONNECT_API_SECRET` / Header `CTRLAuthHeader`.
3. Optional `RESTfulAllowedOrigin` → `SCREENCONNECT_ORIGIN`.
4. Mit curl `GetSessionsByFilter` prüfen, danach MCP mit `SCREENCONNECT_MODE=read` starten.

## Konfiguration

| Variable | Pflicht | Default | Zweck |
|----------|---------|---------|-------|
| `SCREENCONNECT_BASE_URL` | ja | — | HTTPS-URL der Instanz |
| `SCREENCONNECT_API_SECRET` | ja | — | `RESTfulAuthenticationSecret` (`CTRLAuthHeader`) |
| `SCREENCONNECT_MODE` | nein | `read` | `read` · `write` · `destructive` |
| `SCREENCONNECT_ENABLE_COMMANDS` | nein | `false` | Pflicht für Destructive-Tools |
| `SCREENCONNECT_ALLOWED_GROUPS` | nein | leer | Volle Session-Gruppenpfade |
| `SCREENCONNECT_MAX_RESPONSE_BYTES` | nein | `10485760` | Antwortlimit in Bytes (Standard 10 MiB, max. 50 MiB) |
| `MCP_TRANSPORT` | nein | `stdio` | `stdio` oder `http` (Streamable HTTP auf `/mcp`) |
| `MCP_HTTP_BEARER_TOKEN` | bei `http` | — | Bearer-Token (**mind. 32 Zeichen**) |

Details: [docs/security-model.md](docs/security-model.md), [`.env.example`](.env.example).

## Tools

- **Read:** `health_check`, `list_sessions`, `search_sessions` (inkl. `onlineOnly` / `offlineOnly`), `get_session`, `get_session_details`, `get_session_events`, `get_server_info`
- **Write (alle mit `dryRun: true`):** `add_session_note`, `send_message_to_session`, `update_session_name`, `update_custom_properties`
- **Destructive (`confirm: true`, optional `expectedName`):** `send_command_to_session`, `send_toolbox_item`, `create_session`

## Clients / mcpproxy

Beispiele: [docs/mcpproxy.example.yaml](docs/mcpproxy.example.yaml), [docs/mcp-client.example.json](docs/mcp-client.example.json) (ChatGPT, Claude, Gemini, …).  
Unterstützt **stdio** (Standard) und **Streamable HTTP** (`/mcp`, nur über Loopback oder TLS-Reverse-Proxy betreiben).

## Entwicklung

```bash
git clone https://github.com/pitwch/screenconnect-mcp-server.git
cd screenconnect-mcp-server
npm install
npm run build && npm test && npm run smoke && npm run build:mcpb
```

## Lizenz

MIT — [`LICENSE`](LICENSE).

<p align="center">
  <a href="https://www.pitw.ch">
    <img src="docs/assets/pedrett-logo.svg" alt="Pedrett IT+Web AG" height="72" />
  </a>
</p>

<p align="center">
  <strong>Pedrett IT+Web AG</strong> · <a href="https://www.pitw.ch">www.pitw.ch</a>
</p>
