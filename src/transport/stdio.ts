import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { ServerConfig } from '../config.js';
import { createServer } from '../server.js';

export async function startStdio(config: ServerConfig): Promise<void> {
  void serveStdio(() => createServer(config));
  console.error(
    `screenconnect-mcp-server 0.1.4 on stdio (mode=${config.mode}, commands=${config.enableCommands})`,
  );
}
