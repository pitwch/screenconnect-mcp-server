# ScreenConnect extension setup

1. In ScreenConnect **Administration → Extensions**, install **RESTful API Manager** (ConnectWise Labs).
2. Open extension settings (⋮ → Edit Settings):
   - Set `RESTfulAuthenticationSecret` to a long random secret.
   - Optionally set `RESTfulAllowedOrigin` to a single exact origin.
3. Confirm the extension GUID (default `2d558935-686a-4bd0-9991-07539f5fe749`). Override with `SCREENCONNECT_EXTENSION_ID` if different.
4. From a host that can reach the instance:

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "CTRLAuthHeader: $SCREENCONNECT_API_SECRET" \
  -d '["SessionType = '\''Access'\''"]' \
  "$SCREENCONNECT_BASE_URL/App_Extensions/$SCREENCONNECT_EXTENSION_ID/Service.ashx/GetSessionsByFilter"
```

5. Point this MCP server at the same base URL and secret. Start with `SCREENCONNECT_MODE=read`.

## Filter syntax

`GetSessionsByFilter` accepts SQL-like expressions, for example:

- `GuestConnectedCount > 0`
- `SessionType = 'Access'`
- `Name LIKE '*finance*'`
- `CustomProperty1 LIKE '*Critical*'`

Use the MCP `filter` argument for advanced expressions, or structured fields on `search_sessions` / `list_sessions`.

## Not available via this extension

Session group administration UI listing, panel audit log, ending sessions, and file transfer require other ScreenConnect APIs and are out of scope for v0.1.0.
