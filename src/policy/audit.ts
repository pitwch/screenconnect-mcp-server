export type AuditEvent = {
  ts: string;
  tool: string;
  tier: 'read' | 'write' | 'destructive';
  method?: string;
  sessionId?: string;
  commandPreview?: string;
  ok: boolean;
  errorCode?: string;
};

const SECRET_KEYS = /secret|password|token|authorization|ctrlauth|bearer|apikey|api_key|passwd|pwd/i;

/** Structured audit fields that must stay readable (no UUID wiping). */
const PRESERVE_AUDIT_KEYS = new Set([
  'ts',
  'tool',
  'tier',
  'method',
  'sessionId',
  'ok',
  'errorCode',
  'type',
]);

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

/**
 * Redact secret-looking substrings in free text (commands, error bodies, …).
 * Does not wipe bare UUIDs — those are needed for sessionId traceability.
 */
export function redactSecretText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\b(password|passwd|pwd|secret|token|apikey|api_key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/\/([Pp]ass(?:word)?)\s+\S+/g, '/$1 [redacted]')
    .replace(/(-p|--password|--secret|--token)\s+\S+/gi, '$1 [redacted]');
}

/** Strip secret-looking fields from arbitrary objects before logging. */
export function redactForAudit(value: unknown, keyHint?: string): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (keyHint && PRESERVE_AUDIT_KEYS.has(keyHint)) {
      return value;
    }
    return truncate(redactSecretText(value), 500);
  }
  if (Array.isArray(value)) return value.map((v) => redactForAudit(v));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.test(k)) {
        out[k] = '[redacted]';
      } else {
        out[k] = redactForAudit(v, k);
      }
    }
    return out;
  }
  return value;
}

export function writeAudit(event: AuditEvent): void {
  const redacted = redactForAudit(event) as AuditEvent;
  const payload: Record<string, unknown> = {
    type: 'audit',
    ts: event.ts,
    tool: event.tool,
    tier: event.tier,
    method: event.method,
    // Keep session GUID readable for operators / SIEM correlation.
    sessionId: event.sessionId,
    ok: event.ok,
    errorCode: event.errorCode,
  };
  if (redacted.commandPreview) {
    payload.commandPreview = truncate(String(redacted.commandPreview), 120);
  }
  // MCP requires stdout reserved for protocol; audit goes to stderr as JSON lines.
  console.error(JSON.stringify(payload));
}
