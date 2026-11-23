# Security model

Hard guarantees are enforced in code (`src/policy/*`, tool registration), not only in model prompts.

## Modes

| `SCREENCONNECT_MODE` | Tools |
|----------------------|--------|
| `read` (default) | health, list/search, details, events, server info |
| `write` | + notes, messages, rename, custom properties |
| `destructive` | + commands, toolbox, create session — **also requires** `SCREENCONNECT_ENABLE_COMMANDS=true` |

Tools outside the active mode are **not registered** (hidden from `tools/list`) and are rejected again inside the handler gate.

## Destructive confirmations

`send_command_to_session`, `send_toolbox_item`, and `create_session` require `confirm: true` and set `destructiveHint: true` (mcpproxy maps them as destructive, not write).

## Session group allowlist

When `SCREENCONNECT_ALLOWED_GROUPS` is set:

1. List/search/health probes AND the allowlist into `GetSessionsByFilter` when possible.
2. Every session-scoped result is checked again client-side (exact path / group name, or child under an allowed path prefix).

Empty allowlist = unrestricted (unsuitable for production MSP multi-tenant hosts).

Use **full group paths** such as `All Machines/Contoso`. Short tokens like `Machines` or `IT` do **not** match mid-path segments.

**Important (live API):** Some ScreenConnect builds do **not** return `SessionGroupPath` / `GroupName` on list or details payloads, and `SessionGroupPath` filters may match nothing. In that case leave `SCREENCONNECT_ALLOWED_GROUPS` **empty** — otherwise the allowlist will deny every session. List/search responses include `groupFieldsWarning` when group fields are absent.

Before enabling the allowlist in production: confirm your instance returns group fields on session payloads (check `groupFieldsPresent` / `groups` on `search_sessions` or `get_session_details`).

## Audit log

Each tool invocation emits one JSON line on **stderr** after redaction:

```json
{"type":"audit","ts":"...","tool":"search_sessions","tier":"read","ok":true}
```

Command previews are redacted (password/token patterns) and truncated to 120 characters. Structured fields such as `sessionId` stay readable for operator traceability. Secrets and secret-named fields are never logged.

## Transport

- **stdio** (default): required for production mcpproxy. Use `SCREENCONNECT_MODE=read` and `SCREENCONNECT_ENABLE_COMMANDS=false` until write/destructive is explicitly approved.
- **HTTP** (`MCP_TRANSPORT=http`): requires bearer token, defaults to `127.0.0.1`. Tool execution over HTTP is disabled in v0.1.x (ping/initialize only) — do not use for mcpproxy tool routing.

## Base URL

`SCREENCONNECT_BASE_URL` must be `https://`. Plain `http://` is rejected.
