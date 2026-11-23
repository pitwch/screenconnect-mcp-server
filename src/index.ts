#!/usr/bin/env node
import { loadConfigFromEnv } from './config.js';
import { startHttp } from './transport/http.js';
import { startStdio } from './transport/stdio.js';

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  if (config.transport === 'http') {
    await startHttp(config);
    // Keep process alive for the listening HTTP server.
    await new Promise(() => {
      /* never resolves */
    });
    return;
  }
  await startStdio(config);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
