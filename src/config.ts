export const DEFAULT_EXTENSION_ID = '2d558935-686a-4bd0-9991-07539f5fe749';

export type ServerMode = 'read' | 'write' | 'destructive';

export type ServerConfig = {
  baseUrl: string;
  apiSecret: string;
  extensionId: string;
  origin?: string;
  allowedGroups: string[];
  mode: ServerMode;
  enableCommands: boolean;
  timeoutMs: number;
  maxCommandOutputChars: number;
  transport: 'stdio' | 'http';
  httpHost: string;
  httpPort: number;
  httpBearerToken?: string;
  httpAllowedOrigins: string[];
};

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new Error(`Invalid boolean value: ${raw}`);
}

function parsePositiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Expected a positive number, got: ${raw}`);
  }
  return Math.min(Math.floor(n), max);
}

function parseMode(raw: string | undefined): ServerMode {
  const mode = (raw ?? 'read').trim().toLowerCase();
  if (mode === 'read' || mode === 'write' || mode === 'destructive') return mode;
  throw new Error(`SCREENCONNECT_MODE must be read|write|destructive (got "${raw}")`);
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('SCREENCONNECT_BASE_URL must be a valid absolute URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('SCREENCONNECT_BASE_URL must use https:// (http is not allowed)');
  }
  if (url.username || url.password) {
    throw new Error('SCREENCONNECT_BASE_URL must not embed credentials');
  }
  if (url.search || url.hash) {
    throw new Error('SCREENCONNECT_BASE_URL must not include query or hash');
  }
  // Strip trailing slash from pathname root only; keep context paths.
  const normalized = url.toString().replace(/\/+$/, '');
  return normalized;
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const baseUrlRaw = env.SCREENCONNECT_BASE_URL?.trim() ?? '';
  const apiSecret = env.SCREENCONNECT_API_SECRET ?? '';
  if (!baseUrlRaw || !apiSecret) {
    throw new Error(
      'Missing credentials. Set SCREENCONNECT_BASE_URL and SCREENCONNECT_API_SECRET.',
    );
  }

  const extensionId = (env.SCREENCONNECT_EXTENSION_ID ?? DEFAULT_EXTENSION_ID).trim();
  if (!GUID_RE.test(extensionId)) {
    throw new Error('SCREENCONNECT_EXTENSION_ID must be a GUID');
  }

  const mode = parseMode(env.SCREENCONNECT_MODE);
  const enableCommands = parseBool(env.SCREENCONNECT_ENABLE_COMMANDS, false);
  if (mode === 'destructive' && !enableCommands) {
    throw new Error(
      'SCREENCONNECT_MODE=destructive requires SCREENCONNECT_ENABLE_COMMANDS=true',
    );
  }

  const transportRaw = (env.MCP_TRANSPORT ?? 'stdio').trim().toLowerCase();
  if (transportRaw !== 'stdio' && transportRaw !== 'http') {
    throw new Error('MCP_TRANSPORT must be stdio or http');
  }

  const httpBearerToken = env.MCP_HTTP_BEARER_TOKEN?.trim() || undefined;
  if (transportRaw === 'http' && !httpBearerToken) {
    throw new Error('MCP_TRANSPORT=http requires MCP_HTTP_BEARER_TOKEN');
  }

  const origin = env.SCREENCONNECT_ORIGIN?.trim() || undefined;
  if (origin) {
    try {
      // Exact origin string is required by the extension; validate shape only.
      new URL(origin);
    } catch {
      throw new Error('SCREENCONNECT_ORIGIN must be a valid absolute URL/origin');
    }
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrlRaw),
    apiSecret,
    extensionId,
    origin,
    allowedGroups: parseCsv(env.SCREENCONNECT_ALLOWED_GROUPS),
    mode,
    enableCommands,
    timeoutMs: parsePositiveInt(env.SCREENCONNECT_TIMEOUT_MS, 30_000, 120_000),
    maxCommandOutputChars: parsePositiveInt(
      env.SCREENCONNECT_MAX_COMMAND_OUTPUT_CHARS,
      16_000,
      1_000_000,
    ),
    transport: transportRaw,
    httpHost: (env.MCP_HTTP_HOST ?? '127.0.0.1').trim() || '127.0.0.1',
    httpPort: parsePositiveInt(env.MCP_HTTP_PORT, 8080, 65535),
    httpBearerToken,
    httpAllowedOrigins: parseCsv(env.MCP_HTTP_ALLOWED_ORIGINS),
  };
}
