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

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

/** Redact secret-looking substrings in free text (commands, error bodies, …). */
export function redactSecretText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\b(password|passwd|pwd|secret|token|apikey|api_key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/\/([Pp]ass(?:word)?)\s+\S+/g, '/$1 [redacted]')
    .replace(/(-p|--password|--secret|--token)\s+\S+/gi, '$1 [redacted]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[redacted]');
}

/** Strip secret-looking fields from arbitrary objects before logging. */
export function redactForAudit(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    return truncate(redactSecretText(value), 500);
  }
  if (Array.isArray(value)) return value.map(redactForAudit);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redactForAudit(v);
    }
    return out;
  }
  return value;
}

export function writeAudit(event: AuditEvent): void {
  const redacted = redactForAudit(event) as AuditEvent;
  const payload = {
    ...redacted,
    commandPreview: redacted.commandPreview
      ? truncate(String(redacted.commandPreview), 120)
      : undefined,
  };
  // MCP requires stdout reserved for protocol; audit goes to stderr as JSON lines.
  console.error(JSON.stringify({ type: 'audit', ...payload }));
}
