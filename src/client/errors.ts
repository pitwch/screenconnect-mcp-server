export class ScreenConnectApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly code?: string;

  constructor(status: number, method: string, message: string, code?: string) {
    super(message);
    this.name = 'ScreenConnectApiError';
    this.status = status;
    this.method = method;
    this.code = code;
  }
}

export class PolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&#xD;|&#13;/gi, '')
    .replace(/&#xA;|&#10;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Map upstream HTTP failures to a single readable line.
 * Never returns raw 500 HTML/XML dumps or secrets.
 */
export function formatApiError(status: number, method: string, body: string): string {
  let reason = '';
  let code: string | undefined;

  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const message = j.message ?? j.Message ?? j.error ?? j.ExceptionMessage;
    if (typeof message === 'string') reason = message;
    const errorType = j.errorType ?? j.ErrorType;
    if (typeof errorType === 'string') code = errorType;
  } catch {
    // not JSON
  }

  if (!reason) {
    const xmlText = body.match(/<(?:\w+:)?Text[^>]*>([\s\S]*?)<\/(?:\w+:)?Text>/);
    if (xmlText) reason = decodeXml(xmlText[1]!);
  }

  if (!reason) {
    reason = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  reason = reason.replace(/\s+/g, ' ').trim();

  if (!reason) {
    reason =
      status === 401 || status === 403
        ? 'authentication rejected (check CTRLAuthHeader / API secret)'
        : status === 404
          ? 'extension or method not found (check SCREENCONNECT_EXTENSION_ID)'
          : 'upstream request failed without a detailed message';
  }

  // Strip anything that looks like the shared secret if it somehow appeared.
  reason = reason.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[redacted]');

  const prefix = `ScreenConnect API error (HTTP ${status}) on ${method}`;
  return code ? `${prefix} [${code}]: ${reason}` : `${prefix}: ${reason}`;
}

export function toApiError(status: number, method: string, body: string): ScreenConnectApiError {
  const message = formatApiError(status, method, body);
  let code: string | undefined;
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    if (typeof j.errorType === 'string') code = j.errorType;
  } catch {
    // ignore
  }
  return new ScreenConnectApiError(status, method, message, code);
}
