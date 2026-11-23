import type { ServerConfig } from '../config.js';
import { getSharedClient } from '../client/screenconnect-client.js';
import {
  assertSessionGroupAllowed,
  extractGroupCandidates,
  type SessionGroupFields,
} from '../policy/groups.js';
import { PolicyError } from '../client/errors.js';

export type SessionSummary = SessionGroupFields & {
  SessionID?: string;
  SessionId?: string;
  Name?: string;
  GuestOperatingSystemName?: string;
  GuestLoggedOnUserName?: string;
  GuestNetworkAddress?: string;
  GuestConnectedCount?: number;
  HostConnectedCount?: number;
  CustomPropertyValues?: string[];
  CustomProperties?: string[];
  Events?: unknown[];
  Connections?: unknown[];
};

export function sessionIdOf(session: SessionSummary | null | undefined): string | undefined {
  if (!session) return undefined;
  const id = session.SessionID ?? session.SessionId;
  return typeof id === 'string' ? id : undefined;
}

export function asSessionArray(body: unknown): SessionSummary[] {
  if (Array.isArray(body)) return body as SessionSummary[];
  if (body && typeof body === 'object') return [body as SessionSummary];
  return [];
}

export function summarizeSession(session: SessionSummary) {
  const custom =
    session.CustomPropertyValues ??
    session.CustomProperties ??
    [];
  return {
    sessionId: sessionIdOf(session),
    name: session.Name,
    groups: extractGroupCandidates(session),
    operatingSystem: session.GuestOperatingSystemName ?? null,
    loggedOnUser: session.GuestLoggedOnUserName ?? null,
    networkAddress: session.GuestNetworkAddress ?? null,
    guestConnected: Number(session.GuestConnectedCount ?? 0) > 0,
    hostConnected: Number(session.HostConnectedCount ?? 0) > 0,
    guestConnectedCount: session.GuestConnectedCount ?? 0,
    hostConnectedCount: session.HostConnectedCount ?? 0,
    customProperties: Array.isArray(custom) ? custom : [],
  };
}

export async function fetchSessionById(
  config: ServerConfig,
  sessionId: string,
): Promise<SessionSummary> {
  const client = getSharedClient(config);
  const body = await client.call<unknown>('GetSessionBySessionID', [sessionId]);
  const sessions = asSessionArray(body);
  const session = sessions[0];
  if (!session) {
    throw new PolicyError('not_found', `Session ${sessionId} not found`);
  }
  assertSessionGroupAllowed(config.allowedGroups, session, sessionId);
  return session;
}

export async function fetchSessionDetails(
  config: ServerConfig,
  sessionId: string,
): Promise<SessionSummary> {
  const client = getSharedClient(config);
  // Prefer details; fall back to list-by-id if details shape is empty.
  let details: SessionSummary | undefined;
  try {
    const body = await client.call<unknown>('GetSessionDetailsBySessionID', [sessionId]);
    const arr = asSessionArray(body);
    details = arr[0] ?? (body && typeof body === 'object' ? (body as SessionSummary) : undefined);
  } catch {
    details = undefined;
  }

  if (!details) {
    details = await fetchSessionById(config, sessionId);
  } else {
    assertSessionGroupAllowed(config.allowedGroups, details, sessionId);
  }
  return details;
}

/** Normalize custom property slots 1..8 for UpdateSessionCustomProperties. */
export function mergeCustomProperties(
  existing: unknown,
  patch: Record<string, string>,
): string[] {
  const base = Array.isArray(existing)
    ? existing.map((v) => (typeof v === 'string' ? v : ''))
    : [];
  while (base.length < 8) base.push('');
  const next = base.slice(0, 8);
  for (const [key, value] of Object.entries(patch)) {
    if (!/^[1-8]$/.test(key)) {
      throw new Error(`custom property slot must be 1..8 (got "${key}")`);
    }
    next[Number(key) - 1] = value;
  }
  return next;
}

export function extractEvents(details: SessionSummary): unknown[] {
  if (Array.isArray(details.Events)) return details.Events;
  const nested = details as Record<string, unknown>;
  if (Array.isArray(nested.SessionEvents)) return nested.SessionEvents as unknown[];
  if (Array.isArray(nested.events)) return nested.events as unknown[];
  return [];
}

/** EventType 70 is commonly used for RanCommand / command output. */
export function findCommandOutputEvents(
  events: unknown[],
  sinceIso?: string,
): Array<{ at?: string; data?: string; eventType?: unknown }> {
  const sinceMs = sinceIso ? Date.parse(sinceIso) : NaN;
  const out: Array<{ at?: string; data?: string; eventType?: unknown }> = [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as Record<string, unknown>;
    const eventType = e.EventType ?? e.eventType ?? e.Type;
    const isCommand =
      eventType === 70 ||
      eventType === '70' ||
      eventType === 'RanCommand' ||
      eventType === 'CommandOutput';
    if (!isCommand) continue;
    const atRaw = e.Time ?? e.time ?? e.Timestamp ?? e.Created;
    const at =
      typeof atRaw === 'string'
        ? atRaw
        : typeof atRaw === 'number'
          ? new Date(atRaw).toISOString()
          : undefined;
    if (Number.isFinite(sinceMs) && at) {
      const t = Date.parse(at);
      if (Number.isFinite(t) && t < sinceMs) continue;
    }
    const data = e.Data ?? e.data ?? e.Message;
    out.push({
      at,
      data: typeof data === 'string' ? data : data != null ? String(data) : undefined,
      eventType,
    });
  }
  return out;
}
