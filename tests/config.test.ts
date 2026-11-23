import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_EXTENSION_ID, loadConfigFromEnv } from '../src/config.js';

const baseEnv = {
  SCREENCONNECT_BASE_URL: 'https://control.example.com',
  SCREENCONNECT_API_SECRET: 'secret-value',
};

afterEach(() => {
  // nothing shared
});

describe('loadConfigFromEnv', () => {
  it('loads defaults in read mode', () => {
    const cfg = loadConfigFromEnv({ ...baseEnv });
    expect(cfg.mode).toBe('read');
    expect(cfg.enableCommands).toBe(false);
    expect(cfg.extensionId).toBe(DEFAULT_EXTENSION_ID);
    expect(cfg.transport).toBe('stdio');
    expect(cfg.baseUrl).toBe('https://control.example.com');
  });

  it('rejects destructive mode without enableCommands', () => {
    expect(() =>
      loadConfigFromEnv({
        ...baseEnv,
        SCREENCONNECT_MODE: 'destructive',
      }),
    ).toThrow(/SCREENCONNECT_ENABLE_COMMANDS=true/);
  });

  it('parses allowed groups', () => {
    const cfg = loadConfigFromEnv({
      ...baseEnv,
      SCREENCONNECT_ALLOWED_GROUPS: 'All Machines/Contoso, Fabrikam',
    });
    expect(cfg.allowedGroups).toEqual(['All Machines/Contoso', 'Fabrikam']);
  });

  it('requires bearer token for http transport', () => {
    expect(() =>
      loadConfigFromEnv({
        ...baseEnv,
        MCP_TRANSPORT: 'http',
      }),
    ).toThrow(/MCP_HTTP_BEARER_TOKEN/);
  });

  it('rejects embedded credentials in base URL', () => {
    expect(() =>
      loadConfigFromEnv({
        ...baseEnv,
        SCREENCONNECT_BASE_URL: 'https://user:pass@control.example.com',
      }),
    ).toThrow(/credentials/);
  });

  it('rejects http base URLs', () => {
    expect(() =>
      loadConfigFromEnv({
        ...baseEnv,
        SCREENCONNECT_BASE_URL: 'http://control.example.com',
      }),
    ).toThrow(/https/);
  });
});

