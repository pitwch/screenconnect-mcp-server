import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ServerConfig } from '../config.js';
import { buildSessionFilter } from '../client/filter.js';
import { getSharedClient } from '../client/screenconnect-client.js';
import {
  buildAllowlistFilterClause,
  filterSessionsByAllowlist,
} from '../policy/groups.js';
import { paginate, READ_ONLY, registerGatedTool, sessionIdSchema } from './helpers.js';
import {
  asSessionArray,
  extractEvents,
  fetchSessionDetails,
  summarizeSession,
} from './session-utils.js';

const searchFields = {
  filter: z
    .string()
    .max(4000)
    .optional()
    .describe('Raw GetSessionsByFilter expression (exclusive with structured fields)'),
  name: z.string().optional().describe('Session name fragment'),
  group: z.string().optional().describe('Session group path/name fragment'),
  sessionType: z.enum(['Access', 'Support', 'Meeting']).optional(),
  onlineOnly: z.boolean().optional().describe('Only sessions with GuestConnectedCount > 0'),
  machineName: z.string().optional(),
  loggedOnUser: z.string().optional(),
  operatingSystem: z.string().optional(),
  customProperties: z
    .record(z.string(), z.string())
    .optional()
    .describe('Map of custom property slots "1".."8" to match values'),
  limit: z.number().int().min(1).max(500).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
};

function combineFilters(...parts: Array<string | undefined>): string {
  const cleaned = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  if (cleaned.length === 0) return 'GuestConnectedCount > -1';
  if (cleaned.length === 1) return cleaned[0]!;
  return cleaned.map((p) => `(${p})`).join(' AND ');
}

async function searchSessions(config: ServerConfig, args: z.infer<z.ZodObject<typeof searchFields>>) {
  const userFilter = buildSessionFilter(args);
  // Push allowlist into the upstream filter when configured, then re-check client-side.
  const filter = combineFilters(userFilter, buildAllowlistFilterClause(config.allowedGroups));
  const client = getSharedClient(config);
  const body = await client.call<unknown>('GetSessionsByFilter', [filter]);
  const sessions = filterSessionsByAllowlist(config.allowedGroups, asSessionArray(body));
  const page = paginate(sessions.map(summarizeSession), args.limit ?? 50, args.offset ?? 0);
  return {
    filter,
    allowlistApplied: config.allowedGroups.length > 0,
    ...page,
  };
}

export function registerReadTools(server: McpServer, config: ServerConfig): void {
  registerGatedTool(server, config, 'health_check', {
    title: 'Health check',
    description:
      'Verify ScreenConnect reachability and CTRLAuthHeader authentication with a narrow GetSessionsByFilter probe. Does not return base URL or unfiltered inventory counts.',
    tier: 'read',
    annotations: READ_ONLY,
    method: 'GetSessionsByFilter',
    inputSchema: z.object({}),
    handler: async (_args, cfg) => {
      const client = getSharedClient(cfg);
      const started = Date.now();
      const probe = combineFilters(
        "SessionType = 'Access'",
        buildAllowlistFilterClause(cfg.allowedGroups),
      );
      const body = await client.call<unknown>('GetSessionsByFilter', [probe]);
      const allowed = filterSessionsByAllowlist(cfg.allowedGroups, asSessionArray(body));
      return {
        ok: true,
        latencyMs: Date.now() - started,
        mode: cfg.mode,
        allowlistConfigured: cfg.allowedGroups.length > 0,
        // Count only after allowlist filtering — never expose raw instance size.
        sampleAccessSessionCount: allowed.length,
      };
    },
  });

  registerGatedTool(server, config, 'list_sessions', {
    title: 'List sessions',
    description:
      'List ScreenConnect sessions via GetSessionsByFilter. Prefer structured fields; use filter for advanced expressions. When SCREENCONNECT_ALLOWED_GROUPS is set, the allowlist is applied in the upstream filter and again client-side.',
    tier: 'read',
    annotations: READ_ONLY,
    method: 'GetSessionsByFilter',
    inputSchema: z.object(searchFields),
    handler: async (args, cfg) => searchSessions(cfg, args),
  });

  registerGatedTool(server, config, 'search_sessions', {
    title: 'Search sessions',
    description:
      'Search sessions by name, group, online status, OS, user, or raw filter (same backend as list_sessions). Allowlist is enforced upstream and client-side when configured.',
    tier: 'read',
    annotations: READ_ONLY,
    method: 'GetSessionsByFilter',
    inputSchema: z.object(searchFields),
    handler: async (args, cfg) => searchSessions(cfg, args),
  });

  registerGatedTool(server, config, 'get_session_details', {
    title: 'Get session details',
    description:
      'Get OS, logged-on user, IP/network address, custom properties, online status, and connection info for a session GUID.',
    tier: 'read',
    annotations: READ_ONLY,
    method: 'GetSessionDetailsBySessionID',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      includeRaw: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, include the raw upstream details payload'),
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    handler: async ({ sessionId, includeRaw }, cfg) => {
      const details = await fetchSessionDetails(cfg, sessionId);
      return {
        ...summarizeSession(details),
        eventCount: extractEvents(details).length,
        connectionCount: Array.isArray(details.Connections) ? details.Connections.length : undefined,
        ...(includeRaw ? { raw: details } : {}),
      };
    },
  });

  registerGatedTool(server, config, 'get_session_events', {
    title: 'Get session events',
    description:
      'Return recent session events from GetSessionDetailsBySessionID (the extension has no separate events endpoint).',
    tier: 'read',
    annotations: READ_ONLY,
    method: 'GetSessionDetailsBySessionID',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      limit: z.number().int().min(1).max(500).optional().default(50),
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    handler: async ({ sessionId, limit }, cfg) => {
      const details = await fetchSessionDetails(cfg, sessionId);
      const events = extractEvents(details);
      // Prefer newest-first when timestamps exist; otherwise keep upstream order.
      const dated = events.map((ev, index) => {
        const e = ev && typeof ev === 'object' ? (ev as Record<string, unknown>) : {};
        const atRaw = e.Time ?? e.time ?? e.Timestamp ?? e.Created;
        const atMs =
          typeof atRaw === 'string'
            ? Date.parse(atRaw)
            : typeof atRaw === 'number'
              ? atRaw
              : Number.NaN;
        return { ev, index, atMs };
      });
      dated.sort((a, b) => {
        const aOk = Number.isFinite(a.atMs);
        const bOk = Number.isFinite(b.atMs);
        if (aOk && bOk) return (b.atMs as number) - (a.atMs as number);
        if (aOk) return -1;
        if (bOk) return 1;
        return b.index - a.index;
      });
      const page = dated.slice(0, limit ?? 50).map((d) => d.ev);
      return {
        sessionId,
        totalCount: events.length,
        items: page,
      };
    },
  });
}
