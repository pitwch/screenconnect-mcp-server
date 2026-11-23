# Contributing

Thanks for contributing to `screenconnect-mcp-server`.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

- Use Node.js 20+.
- Keep stdout for MCP JSON-RPC only; log with `console.error`.
- Do not log API secrets, bearer tokens, or raw upstream 500 bodies.
- New tools need a mode (`read` / `write` / `destructive`), MCP annotations, validation before the API call, and tests.

## Commit style

Use conventional commits (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`).

## Pull requests

- Keep PRs focused.
- Include tests for policy gates and client error mapping when those areas change.
- Never include live customer fixtures; redact GUIDs, hostnames, IPs, and usernames.

## Live fixtures (optional)

With a lab instance:

```bash
export SCREENCONNECT_BASE_URL=...
export SCREENCONNECT_API_SECRET=...
npm run capture-fixtures
```

Review redaction before committing anything under `tests/fixtures/`.
