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
 * Allow when allowlist is empty (permissive) or any candidate matches.
 *
 * Matching is intentionally strict (no mid-string `includes`):
 * - case-insensitive exact match on path or group name
 * - or candidate is under an allowed path prefix (`Allowed/Child`)
 *
 * Prefer full session-group paths in SCREENCONNECT_ALLOWED_GROUPS
 * (e.g. `All Machines/Contoso`), not short tokens like `Machines` or `IT`.
 */
export function isGroupAllowed(allowedGroups: string[], candidates: string[]): boolean {
  if (allowedGroups.length === 0) return true;
  if (candidates.length === 0) return false;

  const normalizedAllowed = allowedGroups.map((g) => g.toLowerCase());
  return candidates.some((candidate) => {
    const c = candidate.toLowerCase();
    return normalizedAllowed.some((a) => c === a || c.startsWith(`${a}/`));
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

/** Quote a ScreenConnect filter string literal. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Upstream OR-clause that narrows GetSessionsByFilter to allowlisted groups
 * (exact path, children under path, or exact GroupName). Still apply
 * filterSessionsByAllowlist client-side as defense in depth.
 */
export function buildAllowlistFilterClause(allowedGroups: string[]): string | undefined {
  if (allowedGroups.length === 0) return undefined;
  const parts = allowedGroups.map((g) => {
    const lit = quoteLiteral(g);
    const likeChildren = quoteLiteral(`${g}/*`);
    return `(SessionGroupPath = ${lit} OR SessionGroupPath LIKE ${likeChildren} OR GroupPath = ${lit} OR GroupPath LIKE ${likeChildren} OR GroupName = ${lit} OR SessionGroupName = ${lit})`;
  });
  return parts.length === 1 ? parts[0]! : `(${parts.join(' OR ')})`;
}
