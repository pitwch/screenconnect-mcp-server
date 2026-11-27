import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatApiError } from '../src/client/errors.js';
import { ScreenConnectClient } from '../src/client/screenconnect-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('formatApiError', () => {
  it('parses JSON error bodies', () => {
    const msg = formatApiError(
      401,
      'GetSessionsByFilter',
      JSON.stringify({ errorType: 'UnauthorizedAccessException', message: 'Invalid anti-forgery token' }),
    );
    expect(msg).toContain('HTTP 401');
    expect(msg).toContain('UnauthorizedAccessException');
    expect(msg).toContain('Invalid anti-forgery token');
  });

  it('redacts secrets in error bodies', () => {
    const msg = formatApiError(
      500,
      'SendCommandToSession',
      JSON.stringify({ message: 'failed password=hunter2 token=abc Bearer xyz.jwt' }),
    );
    expect(msg).not.toContain('hunter2');
    expect(msg).not.toContain('xyz.jwt');
    expect(msg).toContain('[redacted]');
  });


  it('truncates HTML dumps', () => {
    const msg = formatApiError(500, 'GetSessionsByFilter', `<html>${'x'.repeat(2000)}</html>`);
    expect(msg.length).toBeLessThan(400);
    expect(msg).toContain('HTTP 500');
    expect(msg.endsWith('x'.repeat(500))).toBe(false);
  });
});

describe('ScreenConnectClient', () => {
  it('POSTs positional JSON with CTRLAuthHeader', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ SessionID: '11111111-1111-4111-8111-111111111111' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new ScreenConnectClient({
      baseUrl: 'https://control.example.com',
      extensionId: '2d558935-686a-4bd0-9991-07539f5fe749',
      apiSecret: 'test-secret',
      origin: 'https://control.example.com',
      timeoutMs: 5000,
    });

    const result = await client.call('GetSessionsByFilter', ["Name LIKE '*WS*'"]);
    expect(Array.isArray(result)).toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(
      '/App_Extensions/2d558935-686a-4bd0-9991-07539f5fe749/Service.ashx/GetSessionsByFilter',
    );
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.CTRLAuthHeader).toBe('test-secret');
    expect(headers.Origin).toBe('https://control.example.com');
    expect(init?.body).toBe(JSON.stringify(["Name LIKE '*WS*'"]));
  });

  it('maps non-OK responses to ScreenConnectApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'nope' }), { status: 403 })),
    );
    const client = new ScreenConnectClient({
      baseUrl: 'https://control.example.com',
      extensionId: '2d558935-686a-4bd0-9991-07539f5fe749',
      apiSecret: 'test-secret',
      timeoutMs: 5000,
    });
    await expect(client.call('GetSessionsByFilter', ['x'])).rejects.toThrow(/HTTP 403/);
  });

  it('aborts when Content-Length exceeds maxResponseBytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('small', {
          status: 200,
          headers: { 'Content-Length': '2048' },
        }),
      ),
    );
    const client = new ScreenConnectClient({
      baseUrl: 'https://control.example.com',
      extensionId: '2d558935-686a-4bd0-9991-07539f5fe749',
      apiSecret: 'test-secret',
      timeoutMs: 5000,
      maxResponseBytes: 1024,
    });
    await expect(client.call('GetSessionsByFilter', ['x'])).rejects.toThrow(/exceeds 1024 byte limit/);
  });

  it('aborts when streamed body exceeds maxResponseBytes without Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a'.repeat(600)));
        controller.enqueue(new TextEncoder().encode('b'.repeat(600)));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })),
    );
    const client = new ScreenConnectClient({
      baseUrl: 'https://control.example.com',
      extensionId: '2d558935-686a-4bd0-9991-07539f5fe749',
      apiSecret: 'test-secret',
      timeoutMs: 5000,
      maxResponseBytes: 1000,
    });
    await expect(client.call('GetSessionsByFilter', ['x'])).rejects.toThrow(
      /exceeded 1000 byte limit.*Narrow your filter/,
    );
  });
});
