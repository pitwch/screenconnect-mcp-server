# ScreenConnect setup: RESTful API Manager & MCP

Step-by-step guide to install the ConnectWise Labs **RESTful API Manager** extension, create the shared secret (the value this MCP uses as `SCREENCONNECT_API_SECRET` / `CTRLAuthHeader`), and wire the server safely for mcpproxy or ChatGPT / Claude / Gemini.

This is **not** ConnectWise Manage API keys and **not** ScreenConnect web Basic-auth. The extension uses a shared secret in the `CTRLAuthHeader` HTTP header.

---

## Prerequisites

- Admin access to your ScreenConnect / ConnectWise Control instance
- Permission to install extensions (**Administration → Extensions**)
- Network path from the MCP host to `https://your-instance…` (HTTPS only)
- Node.js 20+ if you run the server from source

---

## 1. Install the extension

1. Sign in to ScreenConnect as an administrator.
2. Open **Administration** (gear / Admin).
3. Open the **Extensions** tab.
4. Open the **Extension Marketplace** / gallery.
5. Find **RESTful API Manager** (publisher: **ConnectWise Labs**).
6. **Install** and ensure the extension is **enabled**.

Default extension GUID (use unless your build differs):

```text
2d558935-686a-4bd0-9991-07539f5fe749
```

If the GUID on the Extensions page is different, copy it — you will set `SCREENCONNECT_EXTENSION_ID` later.

---

## 2. Create the RESTful authentication secret

The “token” is a **shared secret you choose**. The extension does not mint OAuth tokens.

1. On the Extensions list, open the **⋮** (three-dot) menu for **RESTful API Manager**.
2. Choose **Edit Settings** (wording may vary slightly by version).
3. Set **`RESTfulAuthenticationSecret`** to a long random value, for example a new GUID or a 32+ character secret from a password manager.

```bash
# Example: generate a GUID on Linux/macOS
uuidgen
# or
openssl rand -hex 24
```

4. Optional but recommended: set **`RESTfulAllowedOrigin`** to one exact origin (e.g. `https://your-instance.example.com`) if your deployment requires Origin checks. If you set this, the MCP must send the same value as `SCREENCONNECT_ORIGIN`.
5. Save the settings.

**Store the secret like a password.** Anyone with this value can call the extension API as far as ScreenConnect permissions allow (including session notes, messages, and — if enabled — remote commands).

Map to MCP env:

| Extension setting | MCP environment variable |
|-------------------|--------------------------|
| `RESTfulAuthenticationSecret` | `SCREENCONNECT_API_SECRET` |
| `RESTfulAllowedOrigin` (if set) | `SCREENCONNECT_ORIGIN` |
| Extension GUID | `SCREENCONNECT_EXTENSION_ID` |

---

## 3. Note your instance base URL

Use the HTTPS URL of the ScreenConnect web UI **without** a trailing path to a specific page:

```text
https://control.example.com
```

If ScreenConnect is installed under a context path, include it (still no trailing slash required):

```text
https://remote.example.com/ScreenConnect
```

This becomes `SCREENCONNECT_BASE_URL`. Plain `http://` is rejected by this server.

---

## 4. Verify the API with curl

From a machine that can reach the instance:

```bash
export SCREENCONNECT_BASE_URL='https://your-instance.example.com'
export SCREENCONNECT_API_SECRET='paste-the-secret-here'
export SCREENCONNECT_EXTENSION_ID='2d558935-686a-4bd0-9991-07539f5fe749'
# Only if RESTfulAllowedOrigin is configured:
# export SCREENCONNECT_ORIGIN='https://your-instance.example.com'

curl -sS -X POST \
  -H 'Content-Type: application/json' \
  -H "CTRLAuthHeader: ${SCREENCONNECT_API_SECRET}" \
  ${SCREENCONNECT_ORIGIN:+-H "Origin: ${SCREENCONNECT_ORIGIN}"} \
  -d '["SessionType = '\''Access'\''"]' \
  "${SCREENCONNECT_BASE_URL}/App_Extensions/${SCREENCONNECT_EXTENSION_ID}/Service.ashx/GetSessionsByFilter"
```

### How to read the result

| Result | Meaning |
|--------|---------|
| JSON array of sessions | Auth and extension path are OK |
| HTTP 401 / 403 | Wrong secret, or Origin mismatch |
| HTTP 404 | Wrong base URL or extension GUID / extension disabled |
| HTML login page | URL does not hit the extension endpoint (check path / reverse proxy) |

Inspect one object and confirm group fields used by the MCP allowlist, typically:

- `SessionGroupPath` and/or `GroupPath`
- `GroupName` and/or `SessionGroupName`

If those fields are empty on your build, `SCREENCONNECT_ALLOWED_GROUPS` cannot scope sessions correctly — fix or leave the allowlist empty only in tightly controlled labs.

---

## 5. Configure this MCP server (read-only first)

`.env` or process environment:

```bash
SCREENCONNECT_BASE_URL=https://your-instance.example.com
SCREENCONNECT_API_SECRET=paste-the-secret-here
SCREENCONNECT_EXTENSION_ID=2d558935-686a-4bd0-9991-07539f5fe749
# SCREENCONNECT_ORIGIN=https://your-instance.example.com

SCREENCONNECT_MODE=read
SCREENCONNECT_ENABLE_COMMANDS=false

# Production: full session-group paths only (not short tokens like "IT")
# SCREENCONNECT_ALLOWED_GROUPS=All Machines/Contoso,All Machines/Fabrikam
```

Build and run (stdio — preferred for mcpproxy):

```bash
npm install
npm run build
node dist/index.js
```

Client / mcpproxy examples: [mcp-client.example.json](./mcp-client.example.json), [mcpproxy.example.yaml](./mcpproxy.example.yaml).

Smoke checks once connected:

1. Call `health_check` — expect `ok: true`.
2. Call `search_sessions` with a known name or group.
3. Call `get_session_details` for one GUID and confirm OS / user / group fields look right.

Do **not** set `SCREENCONNECT_MODE=write` or `destructive` / `SCREENCONNECT_ENABLE_COMMANDS=true` until those flows are approved. HTTP transport remains a limited stub (tool calls return 501); use **stdio** for production.

---

## 6. Security checklist

- [ ] Secret is unique, long, and not committed to git
- [ ] `SCREENCONNECT_MODE=read` for first production rollout
- [ ] `SCREENCONNECT_ENABLE_COMMANDS=false`
- [ ] `SCREENCONNECT_ALLOWED_GROUPS` set to full paths when multi-tenant
- [ ] MCP runs over stdio (or private Docker network), not a public HTTP port
- [ ] Rotate `RESTfulAuthenticationSecret` if it may have leaked (update extension + MCP env together)

See also [security-model.md](./security-model.md).

---

## Filter syntax (optional)

`GetSessionsByFilter` uses SQL-like expressions, for example:

- `GuestConnectedCount > 0`
- `SessionType = 'Access'`
- `Name LIKE '*finance*'`
- `CustomProperty1 LIKE '*Critical*'`

In MCP tools, prefer structured fields on `search_sessions` / `list_sessions`, or pass a raw `filter` for advanced queries.

---

## Not available via this extension

Session-group admin UI listing, panel audit log, ending sessions, and file transfer are outside the RESTful API Manager surface and out of scope for this MCP.

---

## Deutsch

Ausführliche deutsche Anleitung: [extension-setup.de.md](./extension-setup.de.md).
