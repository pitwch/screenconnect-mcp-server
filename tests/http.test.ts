import { describe, expect, it } from 'vitest';
import type { ServerConfig } from '../src/config.js';
import { startHttp } from '../src/transport/http.js';

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
    transport: 'http',
    httpHost: '127.0.0.1',
    httpPort: 18765,
    httpBearerToken: 'test-bearer-token',
    httpAllowedOrigins: [],
    ...over,
  };
}

describe('http transport', () => {
  it('requires bearer, serves health, and rejects tool posts', async () => {
    const port = 18765 + Math.floor(Math.random() * 200);
    const running = await startHttp(baseConfig({ httpPort: port }));
    try {
      const unauth = await fetch(`http://127.0.0.1:${port}/mcp`);
      expect(unauth.status).toBe(401);

      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const auth = await fetch(`http://127.0.0.1:${port}/mcp`, {
        headers: { Authorization: 'Bearer test-bearer-token' },
      });
      expect(auth.status).toBe(200);

      const tools = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-bearer-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      expect(tools.status).toBe(501);
    } finally {
      await running.close();
    }
  });
});
