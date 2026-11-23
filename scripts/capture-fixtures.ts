#!/usr/bin/env node
/**
 * Capture anonymized fixtures from a live ScreenConnect instance.
 * Requires SCREENCONNECT_BASE_URL + SCREENCONNECT_API_SECRET.
 *
 * Usage: npm run capture-fixtures
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfigFromEnv } from '../src/config.js';
import { ScreenConnectClient } from '../src/client/screenconnect-client.js';

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '10.0.0.0')
      .replace(/[A-Za-z0-9._-]+\\[A-Za-z0-9._-]+/g, 'DOMAIN\\user')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m, offset) => {
        // Keep shape but anonymize; first fixture id stays recognizable pattern.
        void offset;
        return '11111111-1111-4111-8111-111111111111';
      });
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v);
    }
    return out;
  }
  return value;
}

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const client = new ScreenConnectClient(config);
  const outDir = join(process.cwd(), 'tests', 'fixtures');
  mkdirSync(outDir, { recursive: true });

  const sessions = await client.call<unknown>('GetSessionsByFilter', ["SessionType = 'Access'"]);
  const list = Array.isArray(sessions) ? sessions.slice(0, 2) : [];
  writeFileSync(join(outDir, 'sessions-by-filter.live.json'), JSON.stringify(redact(list), null, 2));

  const first = list[0] as { SessionID?: string; SessionId?: string } | undefined;
  const id = first?.SessionID ?? first?.SessionId;
  if (id) {
    const details = await client.call<unknown>('GetSessionDetailsBySessionID', [id]);
    writeFileSync(join(outDir, 'session-details.live.json'), JSON.stringify(redact(details), null, 2));
  }

  console.error(`Wrote redacted live fixtures to ${outDir} (*.live.json). Review before committing.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
