import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSharedClient } from '../src/client/screenconnect-client.js';
import type { ServerConfig } from '../src/config.js';
import { startHttp } from '../src/transport/http.js';

const VALID_BEARER = 'a'.repeat(32);

function baseConfig(over: Partial<ServerConfig> = {}): ServerConfig {
  return {
    baseUrl: 'https://control.example.com',
    apiSecret: 'secret',
    extensionId: '2d558935-686a-4bd0-9991-07539f5fe749',
    allowedGroups: [],
    mode: 'read',
    enableCommands: false,
    timeoutMs: 5000,
    maxCommandOutputChars: 16000,
    maxResponseBytes: 10_485_760,
    transport: 'http',
    httpHost: '127.0.0.1',
    httpPort: 0,
    httpBearerToken: VALID_BEARER,
    httpAllowedOrigins: [],
    ...over,
  };
}

/** Parse either application/json or text/event-stream MCP Streamable HTTP response. */
async function parseMcpResponse(res: Response): Promise<Record<string, unknown>> {
  const ct = res.headers.get('content-type') ?? '';
  const raw = await res.text();
  if (ct.includes('application/json')) {
    return JSON.parse(raw) as Record<string, unknown>;
  }
  if (ct.includes('text/event-stream')) {
    const dataLines = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    for (let i = dataLines.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = JSON.parse(dataLines[i]!) as Record<string, unknown>;
        if ('result' in parsed || 'error' in parsed) return parsed;
      } catch {
        // ignore non-JSON SSE frames
      }
    }
  }
  throw new Error(`Unexpected MCP HTTP response (${res.status} ${ct}): ${raw}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSharedClient();
});

describe('Streamable HTTP transport', () => {
  it('rejects bearer tokens shorter than 32 characters', async () => {
    await expect(startHttp(baseConfig({ httpBearerToken: 'too-short' }))).rejects.toThrow(
      /at least 32 characters/,
    );
  });

  it('serves unauthenticated /health, enforces Bearer, Origin, Host, and body limit', async () => {
    const running = await startHttp(baseConfig());
    const base = `http://127.0.0.1:${running.port}`;
    try {
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const missing = await fetch(`${base}/unknown`);
      expect(missing.status).toBe(404);

      const noAuth = await fetch(`${base}/mcp`, { method: 'POST' });
      expect(noAuth.status).toBe(401);

      const wrongAuth = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${'b'.repeat(32)}` },
      });
      expect(wrongAuth.status).toBe(401);

      const badOrigin = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VALID_BEARER}`,
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }),
      });
      expect(badOrigin.status).toBe(403);

      // Spoofed Host header (DNS rebinding) via raw node:http request
      const badHostStatus = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port: running.port,
            path: '/mcp',
            method: 'POST',
            headers: {
              Host: 'evil.example',
              Authorization: `Bearer ${VALID_BEARER}`,
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }));
      });
      expect(badHostStatus).toBe(403);

      const oversized = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VALID_BEARER}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: 'x'.repeat(1_048_577),
      });
      expect(oversized.status).toBe(413);
    } finally {
      await running.close();
    }
  });

  it('supports explicit MCP_HTTP_ALLOWED_ORIGINS allowlist', async () => {
    const running = await startHttp(
      baseConfig({ httpAllowedOrigins: ['https://app.example.com'] }),
    );
    const base = `http://127.0.0.1:${running.port}`;
    try {
      const denied = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VALID_BEARER}`,
          Origin: 'https://other.example.com',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        }),
      });
      expect(denied.status).toBe(403);

      const allowed = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VALID_BEARER}`,
          Origin: 'https://app.example.com',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        }),
      });
      expect(allowed.status).toBe(200);
    } finally {
      await running.close();
    }
  });

  it('executes initialize, tools/list, and tools/call (get_server_info + mocked health_check) over POST /mcp', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith('https://control.example.com/')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                { SessionID: '11111111-1111-4111-8111-111111111111', Name: 'WS-01' },
              ]),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          );
        }
        return realFetch(input, init);
      }),
    );

    const running = await startHttp(baseConfig());
    const endpoint = `http://127.0.0.1:${running.port}/mcp`;
    const headers = {
      Authorization: `Bearer ${VALID_BEARER}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    try {
      const initRes = await realFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'http-test', version: '1.0.0' },
          },
        }),
      });
      expect(initRes.status).toBe(200);
      const initMsg = await parseMcpResponse(initRes);
      expect((initMsg.result as { serverInfo?: { name: string } })?.serverInfo?.name).toBe(
        'screenconnect-mcp-server',
      );

      const listRes = await realFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });
      expect(listRes.status).toBe(200);
      const listMsg = await parseMcpResponse(listRes);
      const tools = (listMsg.result as { tools: { name: string }[] }).tools.map((t) => t.name);
      expect(tools).toContain('get_server_info');
      expect(tools).toContain('health_check');
      expect(tools).not.toContain('add_session_note');

      const infoRes = await realFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'get_server_info', arguments: {} },
        }),
      });
      expect(infoRes.status).toBe(200);
      const infoMsg = await parseMcpResponse(infoRes);
      const infoText = (infoMsg.result as { content?: { text: string }[] })?.content?.[0]?.text ?? '{}';
      const infoPayload = JSON.parse(infoText) as Record<string, unknown>;
      expect(infoPayload.transport).toBe('http');
      expect(infoPayload.mode).toBe('read');

      const healthRes = await realFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'health_check', arguments: {} },
        }),
      });
      expect(healthRes.status).toBe(200);
      const healthMsg = await parseMcpResponse(healthRes);
      const healthText = (healthMsg.result as { content?: { text: string }[] })?.content?.[0]?.text ?? '{}';
      const healthPayload = JSON.parse(healthText) as Record<string, unknown>;
      expect(healthPayload.ok).toBe(true);
    } finally {
      await running.close();
    }
  });
});
