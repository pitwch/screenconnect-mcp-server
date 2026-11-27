import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { ServerConfig } from '../config.js';
import { createServer } from '../server.js';
import { SERVER_VERSION } from '../version.js';

export async function startStdio(config: ServerConfig): Promise<void> {
  void serveStdio(() => createServer(config));
  console.error(
    `screenconnect-mcp-server ${SERVER_VERSION} on stdio (mode=${config.mode}, commands=${config.enableCommands})`,
  );
}
