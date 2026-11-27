export const SERVER_INSTRUCTIONS = `ScreenConnect MCP server for the ConnectWise Labs RESTful API Manager extension.

Security (enforced in code, not only prompts):
- Default SCREENCONNECT_MODE=read. Write tools need MODE=write. Destructive tools need MODE=destructive AND SCREENCONNECT_ENABLE_COMMANDS=true.
- Destructive tools require confirm=true.
- SCREENCONNECT_ALLOWED_GROUPS restricts session-scoped calls when set.
- Prefer health_check, search_sessions, get_session, get_session_details for investigation.
- Write tools support dryRun=true to preview changes before mutating.
- Commands/toolbox are high-impact: never invent confirm=true; pass expectedName when known to guard against wrong-target execution.

API notes:
- Upstream calls are POST .../App_Extensions/{guid}/Service.ashx/{Method} with CTRLAuthHeader.
- get_session_events reads events from GetSessionDetailsBySessionID (no separate events endpoint).
- Session group listing, panel audit log, and file transfer are outside this extension.
`;
