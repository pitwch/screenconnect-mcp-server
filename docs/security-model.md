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

`send_command_to_session`, `send_toolbox_item`, and `create_session` require `confirm: true` and set `destructiveHint: true`.

## Session group allowlist

When `SCREENCONNECT_ALLOWED_GROUPS` is set, every session-scoped call checks group path/name fields on the session payload. Empty allowlist = unrestricted (document as unsuitable for production MSP multi-tenant hosts).

## Audit log

Each tool invocation emits one JSON line on **stderr**:

```json
{"type":"audit","ts":"...","tool":"search_sessions","tier":"read","ok":true}
```

Commands are truncated to 120 characters. Secrets and secret-named fields are never logged.

## Transport

- **stdio** (default): recommended for ChatGPT/Claude/Gemini clients and mcpproxy.
- **HTTP** (`MCP_TRANSPORT=http`): requires bearer token, defaults to `127.0.0.1`, Origin checks when configured. Tool execution over HTTP is disabled in v0.1.0 (ping/initialize only).
