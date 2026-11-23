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
  /** Preserved upstream object after sensitive-field redaction (for debugging). */
  _rawRedacted?: unknown;
};

export type NormalizedSessionView = {
  sessionId?: string;
  name?: string | null;
  groups: string[];
  groupFieldsPresent: boolean;
  operatingSystem: string | null;
  loggedOnUser: string | null;
  loggedOnUserDomain: string | null;
  networkAddress: string | null;
  privateNetworkAddress: string | null;
  guestConnected: boolean;
  hostConnected: boolean;
  guestConnectedCount: number;
  hostConnectedCount: number;
  customProperties: string[];
  machineName: string | null;
};

/** Keys always stripped from includeRaw / logs (crypto material, PII hardware ids, screenshots). */
const SENSITIVE_KEY_RE =
  /^(GuestPublicKey|HostPublicKey|PublicKey|WakeToken|WakeOnLanToken|GuestScreenshotContent|ScreenshotContent|Screenshot|SerialNumber|GuestMachineSerialNumber|MachineSerialNumber|HardwareNetworkAddress|MacAddress|GuestMacAddress|GuestNetworkMacAddress|NetworkMacAddress|MacAddresses|AdapterAddress|PhysicalAddress|Password|PasswordHash|SharedSecret|AuthToken|Token)$/i;

/** Large session history blobs — omit from includeRaw (use get_session_events instead). */
const OMIT_RAW_ARRAY_KEYS = new Set([
  'events',
  'sessionevents',
  'connections',
  'sessionconnections',
]);

/** ScreenConnect SessionEventType codes → readable names (live API + Rewst/CW prior art). */
export const SESSION_EVENT_TYPE_NAMES: Record<number, string> = {
  0: 'Created',
  1: 'Destroyed',
  10: 'Connected',
  11: 'Disconnected',
  12: 'Ended',
  20: 'NoteAdded',
  21: 'SentMessage',
  30: 'RanToolOrUrl',
  31: 'ToolboxItem',
  40: 'TransferredFiles',
  50: 'DelayedCapture',
  60: 'ReceptionMode',
  70: 'RanCommand',
  71: 'CommandOutput',
  // Clipboard / file transfer (Rewst SessionEventType table; 87 seen live, after SentFiles)
  80: 'SentPrintJob',
  81: 'ReceivedPrintJob',
  82: 'CopiedText',
  83: 'CopiedFiles',
  84: 'DraggedFiles',
  85: 'RanFiles',
  86: 'SentFiles',
  87: 'ReceivedFiles',
};

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function pickString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

function pickBool(...vals: unknown[]): boolean | undefined {
  for (const v of vals) {
    if (typeof v === 'boolean') return v;
  }
  return undefined;
}

/** Shallow+nested lookup for known numeric fields (list payloads nest inconsistently). */
function findNumberByKeys(
  root: unknown,
  keys: string[],
  depth = 0,
): number | undefined {
  if (!root || typeof root !== 'object' || depth > 4) return undefined;
  const rec = root as Record<string, unknown>;
  for (const key of keys) {
    if (key in rec) {
      const n = pickNumber(rec[key]);
      if (n !== undefined) return n;
    }
  }
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_')) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const found = findNumberByKeys(v, keys, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function findStringByKeys(
  root: unknown,
  keys: string[],
  depth = 0,
): string | undefined {
  if (!root || typeof root !== 'object' || depth > 4) return undefined;
  const rec = root as Record<string, unknown>;
  for (const key of keys) {
    if (key in rec) {
      const s = pickString(rec[key]);
      if (s !== undefined) return s;
    }
  }
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_')) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const found = findStringByKeys(v, keys, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * Live GetSessionDetailsBySessionID often returns
 * `{ Session: { GuestInfo: {...}, CustomPropertyValues }, Events, Connections }`.
 * List/search may return flatter or partially nested Session objects.
 */
export function unwrapSessionPayload(raw: unknown): {
  session: Record<string, unknown>;
  guestInfo: Record<string, unknown>;
  events: unknown[];
  connections: unknown[];
  root: Record<string, unknown>;
} {
  const root = asRecord(raw) ?? {};
  const session = asRecord(root.Session) ?? root;
  const guestInfo =
    asRecord(session.GuestInfo) ??
    asRecord(root.GuestInfo) ??
    asRecord(session.Guest) ??
    {};
  const events =
    (Array.isArray(root.Events) && root.Events) ||
    (Array.isArray(session.Events) && session.Events) ||
    (Array.isArray(root.SessionEvents) && root.SessionEvents) ||
    [];
  const connections =
    (Array.isArray(root.Connections) && root.Connections) ||
    (Array.isArray(session.Connections) && session.Connections) ||
    [];
  return { session, guestInfo, events, connections, root };
}

/** Deep-clone-ish walk that removes sensitive keys, omits event/connection dumps, truncates huge strings. */
export function redactSensitiveFields(value: unknown, depth = 0): unknown {
  if (value == null || depth > 12) return value;
  if (typeof value === 'string') {
    return value.length > 8_000 ? `${value.slice(0, 8_000)}…[truncated]` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactSensitiveFields(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    if (OMIT_RAW_ARRAY_KEYS.has(k.toLowerCase()) && Array.isArray(v)) {
      out[k] = {
        omitted: true,
        count: v.length,
        hint: 'Use get_session_events for event history',
      };
      continue;
    }
    out[k] = redactSensitiveFields(v, depth + 1);
  }
  return out;
}

export function sessionIdOf(session: SessionSummary | null | undefined): string | undefined {
  if (!session) return undefined;
  const id = session.SessionID ?? session.SessionId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Normalize any upstream session / details payload into a stable view.
 */
export function normalizeSession(raw: unknown): NormalizedSessionView & {
  events: unknown[];
  connections: unknown[];
  /** Flat-ish object for group allowlist checks. */
  groupSource: SessionGroupFields;
  customPropertySource: unknown;
} {
  const { session, guestInfo, events, connections } = unwrapSessionPayload(raw);

  const sessionId = pickString(
    session.SessionID,
    session.SessionId,
    session.sessionId,
    findStringByKeys(raw, ['SessionID', 'SessionId']),
  );

  const name = pickString(session.Name, session.SessionName, session.name) ?? null;

  const operatingSystem =
    pickString(
      guestInfo.OperatingSystemName,
      guestInfo.GuestOperatingSystemName,
      session.GuestOperatingSystemName,
      session.OperatingSystemName,
      findStringByKeys(raw, ['OperatingSystemName', 'GuestOperatingSystemName']),
    ) ?? null;

  const loggedOnUserName = pickString(
    guestInfo.LoggedOnUserName,
    guestInfo.UserName,
    session.GuestLoggedOnUserName,
    session.LoggedOnUserName,
  );
  const loggedOnUserDomain =
    pickString(guestInfo.LoggedOnUserDomain, guestInfo.Domain, session.LoggedOnUserDomain) ??
    null;
  const loggedOnUser =
    loggedOnUserName && loggedOnUserDomain
      ? `${loggedOnUserDomain}\\${loggedOnUserName}`
      : (loggedOnUserName ??
        pickString(session.GuestLoggedOnUserName, findStringByKeys(raw, ['LoggedOnUserName'])) ??
        null);

  const networkAddress =
    pickString(
      session.GuestNetworkAddress,
      guestInfo.GuestNetworkAddress,
      guestInfo.NetworkAddress,
      guestInfo.PublicNetworkAddress,
      findStringByKeys(raw, ['GuestNetworkAddress', 'NetworkAddress']),
    ) ?? null;

  const privateNetworkAddress =
    pickString(
      guestInfo.PrivateNetworkAddress,
      session.PrivateNetworkAddress,
      guestInfo.LocalAddress,
    ) ?? null;

  const machineName =
    pickString(
      guestInfo.MachineName,
      session.GuestMachineName,
      session.MachineName,
      guestInfo.GuestMachineName,
    ) ?? null;

  const customPropertiesRaw =
    session.CustomPropertyValues ??
    session.CustomProperties ??
    guestInfo.CustomPropertyValues ??
    [];

  const customProperties = Array.isArray(customPropertiesRaw)
    ? customPropertiesRaw.map((v) => (typeof v === 'string' ? v : v == null ? '' : String(v)))
    : [];

  const guestConnectedCount =
    findNumberByKeys(raw, [
      'GuestConnectedCount',
      'ActiveGuestConnectionCount',
      'GuestConnectionCount',
      'ConnectedGuestCount',
    ]) ??
    pickNumber(session.GuestConnectedCount, guestInfo.ConnectedCount) ??
    0;

  const hostConnectedCount =
    findNumberByKeys(raw, [
      'HostConnectedCount',
      'ActiveHostConnectionCount',
      'HostConnectionCount',
    ]) ??
    pickNumber(session.HostConnectedCount) ??
    0;

  const guestConnectedFlag = pickBool(
    session.IsGuestConnected,
    session.GuestIsConnected,
    guestInfo.IsConnected,
    guestInfo.Connected,
  );
  const hostConnectedFlag = pickBool(session.IsHostConnected, session.HostIsConnected);

  // If Connections are present, derive a floor from ProcessType.
  let guestFromConnections = 0;
  let hostFromConnections = 0;
  for (const c of connections) {
    const row = asRecord(c);
    if (!row) continue;
    const processType = String(row.ProcessType ?? row.Type ?? row.ParticipantType ?? '');
    if (/guest/i.test(processType)) guestFromConnections += 1;
    if (/host/i.test(processType)) hostFromConnections += 1;
  }

  const guestCount = Math.max(guestConnectedCount, guestFromConnections);
  const hostCount = Math.max(hostConnectedCount, hostFromConnections);

  const groupSource: SessionGroupFields = {
    SessionGroupPath: pickString(
      session.SessionGroupPath,
      session.GroupPath,
      findStringByKeys(raw, ['SessionGroupPath', 'GroupPath']),
    ),
    GroupPath: pickString(session.GroupPath),
    SessionGroupName: pickString(session.SessionGroupName, session.GroupName),
    GroupName: pickString(
      session.GroupName,
      session.SessionGroupName,
      findStringByKeys(raw, ['GroupName', 'SessionGroupName']),
    ),
    Name: name ?? undefined,
  };
  const groups = extractGroupCandidates(groupSource);

  return {
    sessionId,
    name,
    groups,
    groupFieldsPresent: groups.length > 0,
    operatingSystem,
    loggedOnUser,
    loggedOnUserDomain,
    networkAddress,
    privateNetworkAddress,
    guestConnected: guestConnectedFlag ?? guestCount > 0,
    hostConnected: hostConnectedFlag ?? hostCount > 0,
    guestConnectedCount: guestCount,
    hostConnectedCount: hostCount,
    customProperties,
    machineName,
    events,
    connections,
    groupSource,
    customPropertySource: customPropertiesRaw,
  };
}

export function asSessionArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    // Some wrappers use { Sessions: [...] } / { $values: [...] }
    if (Array.isArray(rec.Sessions)) return rec.Sessions;
    if (Array.isArray(rec.$values)) return rec.$values;
    if (Array.isArray(rec.sessions)) return rec.sessions;
    return [body];
  }
  return [];
}

export function summarizeSession(raw: unknown): NormalizedSessionView {
  const n = normalizeSession(raw);
  return {
    sessionId: n.sessionId,
    name: n.name,
    groups: n.groups,
    groupFieldsPresent: n.groupFieldsPresent,
    operatingSystem: n.operatingSystem,
    loggedOnUser: n.loggedOnUser,
    loggedOnUserDomain: n.loggedOnUserDomain,
    networkAddress: n.networkAddress,
    privateNetworkAddress: n.privateNetworkAddress,
    guestConnected: n.guestConnected,
    hostConnected: n.hostConnected,
    guestConnectedCount: n.guestConnectedCount,
    hostConnectedCount: n.hostConnectedCount,
    customProperties: n.customProperties,
    machineName: n.machineName,
  };
}

/** Build a SessionGroupFields-compatible object for allowlist checks. */
export function sessionGroupFieldsFromRaw(raw: unknown): SessionGroupFields {
  return normalizeSession(raw).groupSource;
}

export async function fetchSessionById(
  config: ServerConfig,
  sessionId: string,
): Promise<unknown> {
  const client = getSharedClient(config);
  const body = await client.call<unknown>('GetSessionBySessionID', [sessionId]);
  const sessions = asSessionArray(body);
  const session = sessions[0];
  if (!session) {
    throw new PolicyError('not_found', `Session ${sessionId} not found`);
  }
  assertSessionGroupAllowed(config.allowedGroups, sessionGroupFieldsFromRaw(session), sessionId);
  return session;
}

export async function fetchSessionDetails(
  config: ServerConfig,
  sessionId: string,
): Promise<unknown> {
  const client = getSharedClient(config);
  let details: unknown | undefined;
  try {
    const body = await client.call<unknown>('GetSessionDetailsBySessionID', [sessionId]);
    const arr = asSessionArray(body);
    details = arr[0] ?? (body && typeof body === 'object' ? body : undefined);
  } catch {
    details = undefined;
  }

  if (!details) {
    details = await fetchSessionById(config, sessionId);
  } else {
    assertSessionGroupAllowed(
      config.allowedGroups,
      sessionGroupFieldsFromRaw(details),
      sessionId,
    );
  }
  return details;
}

function slotValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}

/**
 * Normalize custom property slots 1..8 for UpdateSessionCustomProperties.
 * Accepts an array (any length), a sparse/partial list, or an object map
 * (`{ "1": "…" }` / `CustomProperty1`). Always returns exactly 8 strings.
 */
export function mergeCustomProperties(
  existing: unknown,
  patch: Record<string, string>,
): string[] {
  const next = ['', '', '', '', '', '', '', ''];

  if (Array.isArray(existing)) {
    for (let i = 0; i < Math.min(8, existing.length); i++) {
      next[i] = slotValue(existing[i]);
    }
  } else if (existing && typeof existing === 'object') {
    const o = existing as Record<string, unknown>;
    for (let i = 1; i <= 8; i++) {
      const v =
        o[String(i)] ??
        o[`CustomProperty${i}`] ??
        o[`customProperty${i}`] ??
        o[`CustomPropertyValues${i}`];
      if (v !== undefined) next[i - 1] = slotValue(v);
    }
  }

  for (const [key, value] of Object.entries(patch)) {
    if (!/^[1-8]$/.test(key)) {
      throw new Error(`custom property slot must be 1..8 (got "${key}")`);
    }
    next[Number(key) - 1] = value;
  }
  return next;
}

export function extractEvents(raw: unknown): unknown[] {
  return normalizeSession(raw).events;
}

export function eventTypeName(eventType: unknown): string {
  const n =
    typeof eventType === 'number'
      ? eventType
      : typeof eventType === 'string' && /^\d+$/.test(eventType)
        ? Number(eventType)
        : NaN;
  if (Number.isFinite(n) && SESSION_EVENT_TYPE_NAMES[n]) {
    return SESSION_EVENT_TYPE_NAMES[n]!;
  }
  if (typeof eventType === 'string' && eventType.trim()) return eventType;
  return Number.isFinite(n) ? `Unknown_${n}` : 'Unknown';
}

export function normalizeEvent(ev: unknown): Record<string, unknown> {
  if (!ev || typeof ev !== 'object') {
    return { eventType: null, eventTypeName: 'Unknown', data: ev };
  }
  const e = ev as Record<string, unknown>;
  const eventType = e.EventType ?? e.eventType ?? e.Type ?? null;
  const atRaw = e.Time ?? e.time ?? e.Timestamp ?? e.Created;
  const at =
    typeof atRaw === 'string'
      ? atRaw
      : typeof atRaw === 'number'
        ? new Date(atRaw).toISOString()
        : atRaw ?? null;
  const data = e.Data ?? e.data ?? e.Message ?? null;
  return {
    eventType,
    eventTypeName: eventTypeName(eventType),
    at,
    data,
    host: e.Host ?? e.ParticipantName ?? e.Actor ?? null,
  };
}

/** EventType 70 is commonly used for RanCommand / command output. */
export function findCommandOutputEvents(
  events: unknown[],
  sinceIso?: string,
): Array<{ at?: string; data?: string; eventType?: unknown }> {
  const sinceMs = sinceIso ? Date.parse(sinceIso) : NaN;
  const out: Array<{ at?: string; data?: string; eventType?: unknown }> = [];
  for (const ev of events) {
    const normalized = normalizeEvent(ev);
    const eventType = normalized.eventType;
    const isCommand =
      eventType === 70 ||
      eventType === '70' ||
      eventType === 71 ||
      eventType === 'RanCommand' ||
      eventType === 'CommandOutput' ||
      normalized.eventTypeName === 'RanCommand' ||
      normalized.eventTypeName === 'CommandOutput';
    if (!isCommand) continue;
    const at = typeof normalized.at === 'string' ? normalized.at : undefined;
    if (Number.isFinite(sinceMs) && at) {
      const t = Date.parse(at);
      if (Number.isFinite(t) && t < sinceMs) continue;
    }
    const data = normalized.data;
    out.push({
      at,
      data: typeof data === 'string' ? data : data != null ? String(data) : undefined,
      eventType,
    });
  }
  return out;
}
