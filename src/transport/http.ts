import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
  validateOriginHeader,
} from '@modelcontextprotocol/server';
import {
  MIN_HTTP_BEARER_TOKEN_LENGTH,
  type ServerConfig,
} from '../config.js';
import { createServer } from '../server.js';
import { SERVER_VERSION } from '../version.js';

const MAX_REQUEST_BODY_BYTES = 1_048_576; // 1 MiB
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body exceeds 1 MiB limit');
    this.name = 'PayloadTooLargeError';
  }
}

export type RunningHttpServer = {
  port: number;
  close: () => Promise<void>;
};

/**
 * Single-tenant Streamable HTTP transport for MCP clients, Docker, and mcpproxy.
 * - Binds to configured host (default 127.0.0.1)
 * - Unauthenticated GET /health probe
 * - Protects /mcp with constant-time Bearer auth (>= 32 chars), Host validation, and Origin checks
 * - Delegates MCP protocol handling to `@modelcontextprotocol/server` createMcpHandler
 */
export async function startHttp(config: ServerConfig): Promise<RunningHttpServer> {
  const token = config.httpBearerToken;
  if (!token) {
    throw new Error('MCP_HTTP_BEARER_TOKEN is required for HTTP transport');
  }
  if (token.length < MIN_HTTP_BEARER_TOKEN_LENGTH) {
    throw new Error(
      `MCP_HTTP_BEARER_TOKEN must be at least ${MIN_HTTP_BEARER_TOKEN_LENGTH} characters for HTTP transport`,
    );
  }

  // Validate server construction eagerly so misconfiguration fails at startup.
  createServer(config);

  const mcpHandler = createMcpHandler(() => createServer(config), {
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    onerror: (err) => {
      console.error(
        JSON.stringify({
          type: 'mcp_http_error',
          ts: new Date().toISOString(),
          message: err.message,
        }),
      );
    },
  });

  const server = createHttpServer(async (req, res) => {
    try {
      await handleRequest(req, res, config, token, mcpHandler.fetch);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'payload_too_large' }));
        }
        return;
      }
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
    `screenconnect-mcp-server ${SERVER_VERSION} on http://${config.httpHost}:${port}/mcp (mode=${config.mode})`,
  );

  return {
    port,
    close: async () => {
      await mcpHandler.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeIdleConnections?.();
      });
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  token: string,
  mcpFetch: (request: Request) => Promise<Response>,
): Promise<void> {
  const pathname = extractPathname(req.url ?? '/');

  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  if (!authorizeBearer(req, token)) {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer',
    });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  const hostRejection = validateHost(req, config);
  if (hostRejection) {
    await writeWebResponse(res, hostRejection);
    return;
  }

  const webRequest = await toWebRequest(req);

  const originRejection = validateOrigin(webRequest, config);
  if (originRejection) {
    await writeWebResponse(res, originRejection);
    return;
  }

  const webResponse = await mcpFetch(webRequest);
  await writeWebResponse(res, webResponse);
}

function extractPathname(rawUrl: string): string {
  const queryIdx = rawUrl.indexOf('?');
  return queryIdx === -1 ? rawUrl : rawUrl.slice(0, queryIdx);
}

function authorizeBearer(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return false;
  const [scheme, value] = header.split(/\s+/, 2);
  if (!scheme || !value) return false;
  if (scheme.toLowerCase() !== 'bearer') return false;
  return timingSafeEqualString(value, token);
}

function validateHost(req: IncomingMessage, config: ServerConfig): Response | undefined {
  const hostHeader = req.headers.host;
  if (!hostHeader) {
    return Response.json(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Missing Host header' },
        id: null,
      },
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (WILDCARD_HOSTS.has(config.httpHost)) {
    try {
      new URL(`http://${hostHeader}`);
      return undefined;
    } catch {
      return Response.json(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: `Invalid Host header: ${hostHeader}` },
          id: null,
        },
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  const allowedHostnames = new Set<string>(localhostAllowedHostnames());
  if (!LOOPBACK_HOSTS.has(config.httpHost)) {
    allowedHostnames.add(formatHostname(config.httpHost));
  }
  for (const entry of config.httpAllowedOrigins) {
    const parsedHost = extractHostnameFromAllowedEntry(entry);
    if (parsedHost) allowedHostnames.add(parsedHost);
  }

  const syntheticRequest = new Request('http://localhost/mcp', {
    headers: { host: hostHeader },
  });
  return hostHeaderValidationResponse(syntheticRequest, [...allowedHostnames]);
}

function validateOrigin(req: Request, config: ServerConfig): Response | undefined {
  const origin = req.headers.get('origin');
  if (origin === null || origin === '') return undefined;

  if (config.httpAllowedOrigins.length === 0) {
    return originValidationResponse(req, localhostAllowedOrigins());
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return Response.json(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: `Invalid Origin header: ${origin}` },
        id: null,
      },
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const exactOrigins: string[] = [];
  const bareHostnames: string[] = [];
  for (const entry of config.httpAllowedOrigins) {
    if (entry.includes('://')) {
      exactOrigins.push(entry.replace(/\/+$/, ''));
    } else {
      bareHostnames.push(entry);
    }
  }

  if (exactOrigins.includes(parsedOrigin.origin)) {
    return undefined;
  }

  if (bareHostnames.length > 0) {
    const res = validateOriginHeader(origin, bareHostnames);
    if (res.ok) return undefined;
  }

  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code: -32000, message: `Invalid Origin: ${parsedOrigin.origin}` },
      id: null,
    },
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
}

function formatHostname(host: string): string {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }
  return host;
}

function extractHostnameFromAllowedEntry(entry: string): string | undefined {
  if (entry.includes('://')) {
    try {
      return new URL(entry).hostname;
    } catch {
      return undefined;
    }
  }
  return entry;
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const method = req.method ?? 'GET';
  const host = req.headers.host ?? '127.0.0.1';
  const url = new URL(req.url ?? '/mcp', `http://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }

  const body = await readBody(req, MAX_REQUEST_BODY_BYTES);
  return new Request(url, {
    method,
    headers,
    body: body.length > 0 ? new Uint8Array(body) : undefined,
  });
}

async function writeWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  const setCookies =
    typeof webRes.headers.getSetCookie === 'function'
      ? webRes.headers.getSetCookie()
      : [];
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    res.setHeader(key, value);
  });
  if (setCookies.length > 0) {
    res.setHeader('set-cookie', setCookies);
  }

  if (!webRes.body) {
    res.end();
    return;
  }

  const reader = webRes.body.getReader();
  const onClose = () => {
    void reader.cancel().catch(() => {});
  };
  res.once('close', onClose);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded) {
      res.end();
    }
  }
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        reject(new PayloadTooLargeError());
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });
}
