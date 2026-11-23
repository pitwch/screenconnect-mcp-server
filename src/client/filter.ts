export type SessionSearchInput = {
  /** Raw GetSessionsByFilter expression (exclusive with structured fields). */
  filter?: string;
  name?: string;
  group?: string;
  sessionType?: 'Access' | 'Support' | 'Meeting';
  onlineOnly?: boolean;
  machineName?: string;
  loggedOnUser?: string;
  operatingSystem?: string;
  customProperties?: Record<string, string>;
};

const MAX_FILTER_CHARS = 4000;

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function likeLiteral(value: string): string {
  // ScreenConnect filter LIKE uses * wildcards in community examples.
  const escaped = value.replace(/'/g, "''");
  return `'${escaped.includes('*') ? escaped : `*${escaped}*`}'`;
}

/** Build a SQL-like GetSessionsByFilter expression from structured fields. */
export function buildSessionFilter(input: SessionSearchInput): string {
  if (input.filter !== undefined && input.filter !== '') {
    const structuredUsed =
      input.name !== undefined ||
      input.group !== undefined ||
      input.sessionType !== undefined ||
      input.onlineOnly !== undefined ||
      input.machineName !== undefined ||
      input.loggedOnUser !== undefined ||
      input.operatingSystem !== undefined ||
      (input.customProperties !== undefined && Object.keys(input.customProperties).length > 0);
    if (structuredUsed) {
      throw new Error('filter cannot be combined with structured search fields');
    }
    const raw = input.filter.trim();
    if (raw.length > MAX_FILTER_CHARS) {
      throw new Error(`filter exceeds ${MAX_FILTER_CHARS} characters`);
    }
    return raw;
  }

  const parts: string[] = [];

  if (input.sessionType) {
    parts.push(`SessionType = ${quoteLiteral(input.sessionType)}`);
  }
  if (input.name) {
    parts.push(`Name LIKE ${likeLiteral(input.name)}`);
  }
  if (input.group) {
    // GroupPath / SessionGroupName naming varies by build; include both OR branches.
    const g = likeLiteral(input.group);
    parts.push(`(SessionGroupPath LIKE ${g} OR GroupName LIKE ${g} OR Name LIKE ${g})`);
  }
  if (input.machineName) {
    parts.push(`GuestMachineName LIKE ${likeLiteral(input.machineName)}`);
  }
  if (input.loggedOnUser) {
    parts.push(`GuestLoggedOnUserName LIKE ${likeLiteral(input.loggedOnUser)}`);
  }
  if (input.operatingSystem) {
    parts.push(`GuestOperatingSystemName LIKE ${likeLiteral(input.operatingSystem)}`);
  }
  if (input.onlineOnly) {
    parts.push('GuestConnectedCount > 0');
  }
  if (input.customProperties) {
    for (const [key, value] of Object.entries(input.customProperties)) {
      if (!/^[1-8]$/.test(key)) {
        throw new Error(`customProperties keys must be "1".."8" (got "${key}")`);
      }
      parts.push(`CustomProperty${key} LIKE ${likeLiteral(value)}`);
    }
  }

  if (parts.length === 0) {
    // Broad but valid: all Access/Support/Meeting sessions with any guest count.
    return 'GuestConnectedCount > -1';
  }

  const filter = parts.join(' AND ');
  if (filter.length > MAX_FILTER_CHARS) {
    throw new Error(`built filter exceeds ${MAX_FILTER_CHARS} characters`);
  }
  return filter;
}
