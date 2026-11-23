# Changelog

## 0.1.1

- `create_session` annotations use `destructiveHint: true` (mcpproxy-aligned)
- Stricter group allowlist matching (exact / path-prefix only); upstream filter AND when configured
- Audit logs redact command previews; API errors mask password/token patterns beyond UUIDs
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
