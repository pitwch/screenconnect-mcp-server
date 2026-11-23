import type { ServerConfig } from '../config.js';
import { toApiError } from './errors.js';

const USER_AGENT = 'screenconnect-mcp-server/0.1.4';

export type CallOptions = {
  /** Override configured timeout (e.g. long-running command poll). */
  timeoutMs?: number;
  /** HTTP method; extension docs allow GET for pure reads, POST otherwise. */
  httpMethod?: 'GET' | 'POST';
};

export class ScreenConnectClient {
  private readonly baseUrl: string;
  private readonly extensionId: string;
  private readonly apiSecret: string;
  private readonly origin?: string;
  private readonly timeoutMs: number;

  constructor(config: Pick<ServerConfig, 'baseUrl' | 'extensionId' | 'apiSecret' | 'origin' | 'timeoutMs'>) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.extensionId = config.extensionId;
    this.apiSecret = config.apiSecret;
    this.origin = config.origin;
    this.timeoutMs = config.timeoutMs;
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
    try {
      res = await fetch(url, {
        method: httpMethod,
        headers,
        body: JSON.stringify(args),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`Timeout after ${timeoutMs} ms on ${method}`, { cause: err });
      }
      throw err instanceof Error ? err : new Error(String(err), { cause: err });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
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

let sharedClient: ScreenConnectClient | null = null;

export function getSharedClient(config: ServerConfig): ScreenConnectClient {
  sharedClient ??= new ScreenConnectClient(config);
  return sharedClient;
}

/** Test helper: reset singleton between suites. */
export function resetSharedClient(): void {
  sharedClient = null;
}
