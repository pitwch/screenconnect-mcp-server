# Changelog

## 0.2.0

- **Streamable HTTP transport (`MCP_TRANSPORT=http`):** full single-tenant MCP Streamable HTTP on `/mcp` backed by `@modelcontextprotocol/server` `createMcpHandler` with constant-time Bearer auth (`MCP_HTTP_BEARER_TOKEN` ≥ 32 chars), DNS-rebinding `Host` protection, `Origin` allowlist (`MCP_HTTP_ALLOWED_ORIGINS`), 1 MiB request body cap, and unauthenticated `GET /health`
- **Client response size cap:** abort oversized upstream ScreenConnect responses above `SCREENCONNECT_MAX_RESPONSE_BYTES` (default 10 MiB, max 50 MiB) with actionable filter guidance
- **New read capabilities:** lightweight `get_session` tool (`GetSessionBySessionID`) and `offlineOnly` filter on `list_sessions` / `search_sessions` (`GuestConnectedCount = 0`, mutually exclusive with `onlineOnly`)
- **Write safety (`dryRun`):** optional `dryRun: true` preview mode on `add_session_note`, `send_message_to_session`, `update_session_name`, and `update_custom_properties` (validates allowlist & target session without mutating ScreenConnect)
- **Destructive target guard (`expectedName`):** optional case-insensitive `expectedName` verification against session `name` or `machineName` on `send_command_to_session` and `send_toolbox_item` before queuing (`PolicyError: target_mismatch`)
- **Claude Desktop one-click bundle (`.mcpb`):** self-contained Node bundle (`npm run build:mcpb`) automatically attached to every GitHub Release
- **Docs & quickstart:** `npx -y screenconnect-mcp-server` quickstart, npm & MCP Registry badges, Streamable HTTP & `.mcpb` setup instructions

## 0.1.5

- Official MCP Registry metadata (`server.json`, `io.github.pitwch/screenconnect-mcp-server`)
- Automated npm + MCP Registry publishing via GitHub Actions OIDC (Trusted Publishing + provenance)
- Normalize `bin` entry in `package.json`

## 0.1.4

- `includeRaw` also redacts `HardwareNetworkAddress` (MAC) and omits Events/Connections dumps
- Map EventType 80–87 (CopiedFiles, SentFiles, ReceivedFiles, …)

## 0.1.3

- Flatten nested live API payloads (`Session` / `GuestInfo`) for details, OS, user, IP, custom properties
- Fix online status mapping (`IsGuestConnected`, nested counts; honor `onlineOnly` filter)
- Warn when session group fields are absent — do not enable `ALLOWED_GROUPS` until they appear
- `includeRaw` strips GuestPublicKey, WakeToken, screenshots, serial/MAC and truncates huge strings
- `get_session_events` adds readable `eventTypeName` (Connected, Disconnected, RanCommand, …)

## 0.1.2

- Audit logs keep `sessionId` readable; only free-text fields (e.g. command previews) are secret-redacted
- README branding: banner, icon, social preview (ALSO-style), Pedrett footer assets
- Full ScreenConnect extension setup tutorials (EN/DE): REST secret / `CTRLAuthHeader`

## 0.1.1

- `create_session` annotations use `destructiveHint: true` (mcpproxy-aligned)
- Stricter group allowlist matching (exact / path-prefix only); upstream filter AND when configured
- Audit logs redact command previews; API errors mask password/token patterns
- `health_check` no longer returns `baseUrl` or unfiltered inventory counts
- `SCREENCONNECT_BASE_URL` requires `https://`
- Hardened `mergeCustomProperties` for non-array upstream shapes
- Ignore `*.live.json` fixture captures


## 0.1.0


- Initial open-source release: ScreenConnect RESTful API Manager MCP server
- Code-enforced modes: `read` (default), `write`, `destructive` (+ `SCREENCONNECT_ENABLE_COMMANDS`)
- Read tools: health, list/search sessions, details, events
- Write tools: notes, messages, rename, custom properties
- Destructive tools: command, toolbox, create session (`confirm: true`)
- Session-group allowlist and stderr audit logging (no secrets)
- stdio transport (default); optional HTTP bearer probe on loopback
- Docker non-root image, mcpproxy/client examples, CI
