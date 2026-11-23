import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { ServerConfig } from '../config.js';
import { createServer } from '../server.js';

/**
 * Minimal Streamable HTTP transport for local/mcpproxy use.
 * - Binds to configured host (default 127.0.0.1)
 * - Requires Authorization: Bearer <MCP_HTTP_BEARER_TOKEN>
 * - Optional Origin allowlist via MCP_HTTP_ALLOWED_ORIGINS
 *
 * Prefer stdio for production MSP setups. Tool calls over HTTP return 501 in v0.1.2.
 */
export async function startHttp(config: ServerConfig): Promise<{ close: () => Promise<void> }> {
  const token = config.httpBearerToken;
  if (!token) {
    throw new Error('MCP_HTTP_BEARER_TOKEN is required for HTTP transport');
  }

  // Construct server so misconfiguration fails at startup (same as stdio).
  createServer(config);

  const server = createHttpServer(async (req, res) => {
    try {
      await handleRequest(req, res, config, token);
    } catch (err) {
      console.error(
        JSON.stringify({
          type: 'http_error',
          ts: new Date().toISOString(),
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(config.httpPort, config.httpHost, () => resolve());
    server.on('error', reject);
  });

  const address = server.address();
  const port =
    typeof address === 'object' && address ? address.port : config.httpPort;

  console.error(
    `screenconnect-mcp-server 0.1.2 on http://${config.httpHost}:${port}/mcp (mode=${config.mode})`,
  );

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  token: string,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  if (!authorizeBearer(req, token)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  if (!originAllowed(req, config)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'origin_denied' }));
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        name: 'screenconnect-mcp-server',
        version: '0.1.2',
        transport: 'http',
        mode: config.mode,
        requestId: randomUUID(),
        note: 'Prefer stdio for tool calls. POST JSON-RPC accepts ping/initialize only in v0.1.2.',
      }),
    );
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const body = await readBody(req, 1_048_576);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_json' }));
    return;
  }

  const rpc = parsed as { id?: unknown; method?: string };
  if (rpc.method === 'ping' || rpc.method === 'initialize') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: rpc.id ?? null,
        result:
          rpc.method === 'ping'
            ? {}
            : {
                protocolVersion: '2024-11-05',
                capabilities: {},
                serverInfo: { name: 'screenconnect-mcp-server', version: '0.1.2' },
                instructions:
                  'HTTP transport is limited. Use stdio MCP for tool execution with this server.',
              },
      }),
    );
    return;
  }

  res.writeHead(501, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: rpc.id ?? null,
      error: {
        code: -32000,
        message:
          'Tool calls over HTTP are disabled in v0.1.2; use stdio transport (recommended for mcpproxy).',
      },
    }),
  );
}

function authorizeBearer(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return false;
  const [scheme, value] = header.split(/\s+/, 2);
  if (!scheme || !value) return false;
  if (scheme.toLowerCase() !== 'bearer') return false;
  return timingSafeEqualString(value, token);
}

function originAllowed(req: IncomingMessage, config: ServerConfig): boolean {
  const allowed = config.httpAllowedOrigins;
  if (allowed.length === 0) {
    const host = config.httpHost;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  }
  const origin = req.headers.origin;
  if (!origin) return true;
  return allowed.includes(origin);
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
