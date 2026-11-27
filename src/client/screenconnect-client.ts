import { DEFAULT_MAX_RESPONSE_BYTES, type ServerConfig } from '../config.js';
import { SERVER_VERSION } from '../version.js';
import { ScreenConnectApiError, toApiError } from './errors.js';

const USER_AGENT = `screenconnect-mcp-server/${SERVER_VERSION}`;

export type CallOptions = {
  /** Override configured timeout (e.g. long-running command poll). */
  timeoutMs?: number;
  /** HTTP method; extension docs allow GET for pure reads, POST otherwise. */
  httpMethod?: 'GET' | 'POST';
};

export type ScreenConnectClientConfig = Pick<
  ServerConfig,
  'baseUrl' | 'extensionId' | 'apiSecret' | 'origin' | 'timeoutMs'
> & {
  maxResponseBytes?: number;
};

export class ScreenConnectClient {
  private readonly baseUrl: string;
  private readonly extensionId: string;
  private readonly apiSecret: string;
  private readonly origin?: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(config: ScreenConnectClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.extensionId = config.extensionId;
    this.apiSecret = config.apiSecret;
    this.origin = config.origin;
    this.timeoutMs = config.timeoutMs;
    this.maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  /** Invoke an extension method with a positional JSON array body. */
  async call<T = unknown>(method: string, args: unknown[] = [], options: CallOptions = {}): Promise<T> {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(method)) {
      throw new Error(`Invalid extension method name: ${method}`);
    }

    const url = `${this.baseUrl}/App_Extensions/${this.extensionId}/Service.ashx/${method}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      CTRLAuthHeader: this.apiSecret,
      'User-Agent': USER_AGENT,
    };
    if (this.origin) {
      headers.Origin = this.origin;
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const httpMethod = options.httpMethod ?? 'POST';

    let res: Response;
    let text: string;
    try {
      res = await fetch(url, {
        method: httpMethod,
        headers,
        body: JSON.stringify(args),
        signal: controller.signal,
        redirect: 'error',
      });
      text = await readTextWithLimit(res, method, this.maxResponseBytes);
    } catch (err) {
      if (err instanceof ScreenConnectApiError) {
        throw err;
      }
      if (controller.signal.aborted) {
        throw new Error(`Timeout after ${timeoutMs} ms on ${method}`, { cause: err });
      }
      throw err instanceof Error ? err : new Error(String(err), { cause: err });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw toApiError(res.status, method, text);
    }

    if (!text.trim()) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      // Some void methods may return empty or non-JSON success markers.
      return text as unknown as T;
    }
  }
}

async function readTextWithLimit(
  res: Response,
  method: string,
  maxBytes: number,
): Promise<string> {
  const contentLengthHeader = res.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new ScreenConnectApiError(
        413,
        method,
        `Response from ${method} exceeds ${maxBytes} byte limit (Content-Length: ${contentLength}). Narrow your filter (e.g. name, group, sessionType, onlineOnly/offlineOnly) or raise SCREENCONNECT_MAX_RESPONSE_BYTES.`,
        'response_too_large',
      );
    }
  }

  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new ScreenConnectApiError(
        413,
        method,
        `Response from ${method} exceeds ${maxBytes} byte limit. Narrow your filter (e.g. name, group, sessionType, onlineOnly/offlineOnly) or raise SCREENCONNECT_MAX_RESPONSE_BYTES.`,
        'response_too_large',
      );
    }
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ScreenConnectApiError(
          413,
          method,
          `Response from ${method} exceeded ${maxBytes} byte limit. Narrow your filter (e.g. name, group, sessionType, onlineOnly/offlineOnly) or raise SCREENCONNECT_MAX_RESPONSE_BYTES.`,
          'response_too_large',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString('utf8');
}

let sharedClient: ScreenConnectClient | null = null;

export function getSharedClient(config: ServerConfig): ScreenConnectClient {
  sharedClient ??= new ScreenConnectClient(config);
  return sharedClient;
}

/** Test helper: reset singleton between suites. */
export function resetSharedClient(): void {
  sharedClient = null;
}
