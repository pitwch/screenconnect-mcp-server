import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ServerConfig } from './config.js';
import { loadConfigFromEnv } from './config.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { listEnabledTiers } from './policy/modes.js';
import { registerDestructiveTools } from './tools/destructive.js';
import { LOCAL_READ_ONLY, registerGatedTool } from './tools/helpers.js';
import { registerReadTools } from './tools/read.js';
import { registerWriteTools } from './tools/write.js';

export function createServer(config: ServerConfig = loadConfigFromEnv()): McpServer {
  const server = new McpServer(
    {
      name: 'screenconnect-mcp-server',
      version: '0.1.4',
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerGatedTool(server, config, 'get_server_info', {
    title: 'Server info',
    description:
      'Local metadata: mode, enabled tiers, whether a group allowlist is configured. Does not call ScreenConnect.',
    tier: 'read',
    annotations: LOCAL_READ_ONLY,
    inputSchema: z.object({}),
    handler: async () => ({
      name: 'screenconnect-mcp-server',
      version: '0.1.4',
      mode: config.mode,
      enableCommands: config.enableCommands,
      enabledTiers: listEnabledTiers(config.mode, config.enableCommands),
      allowedGroupsConfigured: config.allowedGroups.length > 0,
      allowedGroupCount: config.allowedGroups.length,
      transport: config.transport,
      baseUrlHost: safeHost(config.baseUrl),
      extensionId: config.extensionId,
    }),
  });

  registerReadTools(server, config);
  registerWriteTools(server, config);
  registerDestructiveTools(server, config);

  return server;
}

function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '[invalid]';
  }
}
