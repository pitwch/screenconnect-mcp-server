# Security model

Hard guarantees are enforced in code (`src/policy/*`, tool registration), not only in model prompts.

## Modes

| `SCREENCONNECT_MODE` | Tools |
|----------------------|--------|
| `read` (default) | health, list/search, get session, details, events, server info |
| `write` | + notes, messages, rename, custom properties (all support `dryRun: true`) |
| `destructive` | + commands, toolbox, create session — **also requires** `SCREENCONNECT_ENABLE_COMMANDS=true` |

Tools outside the active mode are **not registered** (hidden from `tools/list`) and are rejected again inside the handler gate.

## Write dry-run & destructive confirmations

- All four write tools (`add_session_note`, `send_message_to_session`, `update_session_name`, `update_custom_properties`) support `dryRun: true` to validate the allowlist and inspect the target/merged state without mutating ScreenConnect.
- `send_command_to_session`, `send_toolbox_item`, and `create_session` require `confirm: true` and set `destructiveHint: true` (mcpproxy maps them as destructive, not write).
- `send_command_to_session` and `send_toolbox_item` accept an optional `expectedName` guard that verifies a case-insensitive match against the target session's `name` or `machineName` before queuing anything (`PolicyError: target_mismatch`).

## Session group allowlist

When `SCREENCONNECT_ALLOWED_GROUPS` is set:

1. List/search/health probes AND the allowlist into `GetSessionsByFilter` when possible.
2. Every session-scoped result is checked again client-side (exact path / group name, or child under an allowed path prefix).

Empty allowlist = unrestricted (unsuitable for production MSP multi-tenant hosts).

Use **full group paths** such as `All Machines/Contoso`. Short tokens like `Machines` or `IT` do **not** match mid-path segments.

**Important (live API):** Some ScreenConnect builds do **not** return `SessionGroupPath` / `GroupName` on list or details payloads, and `SessionGroupPath` filters may match nothing. In that case leave `SCREENCONNECT_ALLOWED_GROUPS` **empty** — otherwise the allowlist will deny every session. List/search responses include `groupFieldsWarning` when group fields are absent.

Before enabling the allowlist in production: confirm your instance returns group fields on session payloads (check `groupFieldsPresent` / `groups` on `search_sessions` or `get_session_details`).

## Upstream response size cap

`ScreenConnectClient` caps upstream responses at `SCREENCONNECT_MAX_RESPONSE_BYTES` (default 10 MiB, maximum 50 MiB), checking both `Content-Length` and streamed bytes so broad unfiltered queries cannot exhaust server memory.

## Audit log

Each tool invocation emits one JSON line on **stderr** after redaction:

```json
{"type":"audit","ts":"...","tool":"search_sessions","tier":"read","ok":true}
```

Command previews are redacted (password/token patterns) and truncated to 120 characters. Structured fields such as `sessionId` stay readable for operator traceability. Secrets and secret-named fields are never logged.

## Transport

- **stdio** (default): zero open ports; ideal for desktop MCP clients and local `mcpproxy` setups. Use `SCREENCONNECT_MODE=read` and `SCREENCONNECT_ENABLE_COMMANDS=false` until write/destructive is explicitly approved.
- **Streamable HTTP** (`MCP_TRANSPORT=http`): single-tenant MCP Streamable HTTP endpoint at `/mcp` plus unauthenticated `GET /health`.
  - Requires `MCP_HTTP_BEARER_TOKEN` of at least **32 characters** (validated via constant-time `timingSafeEqual`).
  - Defaults to loopback (`127.0.0.1:8080`). Validates `Host` headers (DNS rebinding protection) and `Origin` headers (defaults to localhost; customize via `MCP_HTTP_ALLOWED_ORIGINS`).
  - Caps incoming POST bodies at 1 MiB.
  - Terminate TLS in front of `/mcp` if exposing beyond loopback or a private container network; never expose without strong authentication.

## Base URL

`SCREENCONNECT_BASE_URL` must be `https://`. Plain `http://` is rejected, as are URLs containing embedded credentials, query strings, or fragments.
