import { PolicyError } from '../client/errors.js';

export type SessionGroupFields = {
  SessionGroupPath?: unknown;
  SessionGroupName?: unknown;
  GroupName?: unknown;
  GroupPath?: unknown;
  Name?: unknown;
  SessionName?: unknown;
};

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Collect group-like identifiers from a session / details payload. */
export function extractGroupCandidates(session: SessionGroupFields | null | undefined): string[] {
  if (!session || typeof session !== 'object') return [];
  const values = [
    asString(session.SessionGroupPath),
    asString(session.GroupPath),
    asString(session.SessionGroupName),
    asString(session.GroupName),
  ].filter((v): v is string => Boolean(v));
  return [...new Set(values)];
}

/**
 * Allow when allowlist is empty (permissive) or any candidate matches
 * (case-insensitive exact or suffix/prefix path match).
 */
export function isGroupAllowed(allowedGroups: string[], candidates: string[]): boolean {
  if (allowedGroups.length === 0) return true;
  if (candidates.length === 0) return false;

  const normalizedAllowed = allowedGroups.map((g) => g.toLowerCase());
  return candidates.some((candidate) => {
    const c = candidate.toLowerCase();
    return normalizedAllowed.some(
      (a) => c === a || c.endsWith('/' + a) || c.startsWith(a + '/') || c.includes('/' + a + '/'),
    );
  });
}

export function assertSessionGroupAllowed(
  allowedGroups: string[],
  session: SessionGroupFields | null | undefined,
  sessionId?: string,
): void {
  if (allowedGroups.length === 0) return;
  const candidates = extractGroupCandidates(session);
  if (!isGroupAllowed(allowedGroups, candidates)) {
    throw new PolicyError(
      'group_denied',
      `Session${sessionId ? ` ${sessionId}` : ''} is outside SCREENCONNECT_ALLOWED_GROUPS`,
    );
  }
}

export function filterSessionsByAllowlist<T extends SessionGroupFields>(
  allowedGroups: string[],
  sessions: T[],
): T[] {
  if (allowedGroups.length === 0) return sessions;
  return sessions.filter((s) => isGroupAllowed(allowedGroups, extractGroupCandidates(s)));
}
