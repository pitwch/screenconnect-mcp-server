# Security Policy

## Supported versions

Security fixes are applied to the latest release on `main` (currently `0.1.x`).

## Reporting a vulnerability

Please report security issues privately to **info@pitw.ch**. Do not open a public GitHub issue for credential leaks, auth bypasses, or remote command exposure.

Include:

- Affected version / commit
- Reproduction steps (without real customer data or API secrets)
- Impact assessment

## Hardening expectations

This MCP server talks to ConnectWise ScreenConnect via the **RESTful API Manager** extension. Misconfiguration can allow remote commands on endpoints.

Operators MUST:

1. Keep `SCREENCONNECT_MODE=read` unless write access is required.
2. Set `SCREENCONNECT_ENABLE_COMMANDS=true` only with explicit approval for destructive tools.
3. Configure `SCREENCONNECT_ALLOWED_GROUPS` with **full** session-group paths in production.
4. Prefer **stdio** for mcpproxy — do not use the HTTP transport for tool calls in v0.1.x.
5. Rotate the extension `RESTfulAuthenticationSecret` if it may have leaked.
6. Never commit `.env` files, `*.live.json` captures, or paste secrets into issues/PRs.

### Recommended GitHub repository settings

Enable on https://github.com/pitwch/screenconnect-mcp-server/settings/security_analysis :

- Secret scanning + push protection
- Dependabot alerts / security updates (Dependabot config is in `.github/dependabot.yml`)
- Branch protection on `main` (require PR + CI `build` status)

Also set the repository description to **MCP Server for ConnectWise ScreenConnect** (not “MPC”).

See [docs/security-model.md](docs/security-model.md) for the in-code mode gates and audit logging.
