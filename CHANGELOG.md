# Changelog

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
