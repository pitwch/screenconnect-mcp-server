import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ServerConfig } from '../config.js';
import { buildSessionFilter } from '../client/filter.js';
import { getSharedClient } from '../client/screenconnect-client.js';
import {
  buildAllowlistFilterClause,
  isGroupAllowed,
  extractGroupCandidates,
} from '../policy/groups.js';
import { paginate, READ_ONLY, registerGatedTool, sessionIdSchema } from './helpers.js';
import {
  asSessionArray,
  extractEvents,
  fetchSessionDetails,
  normalizeEvent,
  normalizeSession,
  redactSensitiveFields,
  sessionGroupFieldsFromRaw,
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
  const filter = combineFilters(userFilter, buildAllowlistFilterClause(config.allowedGroups));
  const client = getSharedClient(config);
  const body = await client.call<unknown>('GetSessionsByFilter', [filter]);
  const rawSessions = asSessionArray(body);

  const allowedRaw =
    config.allowedGroups.length === 0
      ? rawSessions
      : rawSessions.filter((s) =>
          isGroupAllowed(
            config.allowedGroups,
            extractGroupCandidates(sessionGroupFieldsFromRaw(s)),
          ),
        );

  const summarized = allowedRaw.map((s) => {
    const view = summarizeSession(s);
    // onlineOnly was already applied upstream; if the payload omits counts but
    // the filter required GuestConnectedCount > 0, mark connected.
    if (args.onlineOnly && !view.guestConnected) {
      return {
        ...view,
        guestConnected: true,
        guestConnectedCount: Math.max(view.guestConnectedCount, 1),
      };
    }
    return view;
  });

  const withGroupFields = summarized.filter((s) => s.groupFieldsPresent).length;
  const page = paginate(summarized, args.limit ?? 50, args.offset ?? 0);

  return {
    filter,
    allowlistApplied: config.allowedGroups.length > 0,
    groupFieldsPresentCount: withGroupFields,
    groupFieldsWarning:
      config.allowedGroups.length > 0 && withGroupFields === 0
        ? 'SCREENCONNECT_ALLOWED_GROUPS is set but this instance returned no SessionGroupPath/GroupName fields. Allowlist cannot scope sessions — leave ALLOWED_GROUPS empty until group fields appear in API payloads.'
        : withGroupFields === 0 && summarized.length > 0
          ? 'Session group path/name fields are absent on this instance; groups[] will stay empty.'
          : undefined,
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
      const raw = asSessionArray(body);
      const allowed =
        cfg.allowedGroups.length === 0
          ? raw
          : raw.filter((s) =>
              isGroupAllowed(
                cfg.allowedGroups,
                extractGroupCandidates(sessionGroupFieldsFromRaw(s)),
              ),
            );
      return {
        ok: true,
        latencyMs: Date.now() - started,
        mode: cfg.mode,
        allowlistConfigured: cfg.allowedGroups.length > 0,
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
      'Get OS, logged-on user, IP/network address, custom properties, online status, and connection info for a session GUID. Nested Session/GuestInfo payloads from the live API are flattened. includeRaw returns a redacted payload (keys, wake tokens, screenshots, serial/MAC stripped).',
    tier: 'read',
    annotations: READ_ONLY,
    method: 'GetSessionDetailsBySessionID',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      includeRaw: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'If true, include a redacted upstream details payload (secrets/hardware ids/screenshots removed)',
        ),
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    handler: async ({ sessionId, includeRaw }, cfg) => {
      const details = await fetchSessionDetails(cfg, sessionId);
      const normalized = normalizeSession(details);
      return {
        ...summarizeSession(details),
        eventCount: normalized.events.length,
        connectionCount: normalized.connections.length,
        ...(includeRaw ? { raw: redactSensitiveFields(details) } : {}),
      };
    },
  });

  registerGatedTool(server, config, 'get_session_events', {
    title: 'Get session events',
    description:
      'Return recent session events from GetSessionDetailsBySessionID with readable eventTypeName (Connected, Disconnected, RanCommand, …).',
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
      const dated = events.map((ev, index) => {
        const normalized = normalizeEvent(ev);
        const atRaw = normalized.at;
        const atMs =
          typeof atRaw === 'string'
            ? Date.parse(atRaw)
            : typeof atRaw === 'number'
              ? atRaw
              : Number.NaN;
        return { normalized, index, atMs };
      });
      dated.sort((a, b) => {
        const aOk = Number.isFinite(a.atMs);
        const bOk = Number.isFinite(b.atMs);
        if (aOk && bOk) return (b.atMs as number) - (a.atMs as number);
        if (aOk) return -1;
        if (bOk) return 1;
        return b.index - a.index;
      });
      const page = dated.slice(0, limit ?? 50).map((d) => d.normalized);
      return {
        sessionId,
        totalCount: events.length,
        items: page,
      };
    },
  });
}
