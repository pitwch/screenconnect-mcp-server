import { describe, expect, it } from 'vitest';
import type { ServerConfig } from '../src/config.js';
import { createServer } from '../src/server.js';

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
    transport: 'stdio',
    httpHost: '127.0.0.1',
    httpPort: 8080,
    httpAllowedOrigins: [],
    ...over,
  };
}

function toolNames(server: ReturnType<typeof createServer>): string[] {
  // McpServer stores tools internally; use public list API if available.
  const anyServer = server as unknown as {
    _registeredTools?: Record<string, unknown>;
    tools?: Map<string, unknown>;
  };
  if (anyServer._registeredTools) return Object.keys(anyServer._registeredTools);
  if (anyServer.tools) return [...anyServer.tools.keys()];
  // Fallback: introspect via undocumented property used by SDK server v2.
  const maybe = (server as unknown as { listTools?: () => { name: string }[] }).listTools;
  if (typeof maybe === 'function') return maybe.call(server).map((t) => t.name);
  throw new Error('Unable to introspect registered tools from McpServer');
}

describe('tool registration by mode', () => {
  it('registers only read tools in read mode', () => {
    const names = toolNames(createServer(baseConfig({ mode: 'read' })));
    expect(names).toContain('health_check');
    expect(names).toContain('search_sessions');
    expect(names).toContain('get_server_info');
    expect(names).not.toContain('add_session_note');
    expect(names).not.toContain('send_command_to_session');
  });

  it('registers write tools in write mode', () => {
    const names = toolNames(createServer(baseConfig({ mode: 'write' })));
    expect(names).toContain('add_session_note');
    expect(names).toContain('update_custom_properties');
    expect(names).not.toContain('send_command_to_session');
  });

  it('registers destructive tools only when enabled', () => {
    const names = toolNames(
      createServer(baseConfig({ mode: 'destructive', enableCommands: true })),
    );
    expect(names).toContain('send_command_to_session');
    expect(names).toContain('send_toolbox_item');
    expect(names).toContain('create_session');
  });

  it('marks create_session as destructiveHint for mcpproxy', () => {
    const server = createServer(baseConfig({ mode: 'destructive', enableCommands: true }));
    const tools = (server as unknown as { _registeredTools?: Record<string, { annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean } }> })
      ._registeredTools;
    expect(tools?.create_session?.annotations?.destructiveHint).toBe(true);
    expect(tools?.create_session?.annotations?.readOnlyHint).toBe(false);
  });
});

