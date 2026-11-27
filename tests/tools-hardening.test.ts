import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSharedClient } from '../src/client/screenconnect-client.js';
import type { ServerConfig } from '../src/config.js';
import { createServer } from '../src/server.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function baseConfig(over: Partial<ServerConfig> = {}): ServerConfig {
  return {
    baseUrl: 'https://control.example.com',
    apiSecret: 'secret',
    extensionId: '2d558935-686a-4bd0-9991-07539f5fe749',
    allowedGroups: [],
    mode: 'read',
    enableCommands: false,
    timeoutMs: 5000,
    maxCommandOutputChars: 16000,
    maxResponseBytes: 10_485_760,
    transport: 'stdio',
    httpHost: '127.0.0.1',
    httpPort: 8080,
    httpAllowedOrigins: [],
    ...over,
  };
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

async function invokeTool(
  server: ReturnType<typeof createServer>,
  name: string,
  args: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown>; isError: boolean }> {
  const registered = (
    server as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<ToolResult> }>;
    }
  )._registeredTools[name];
  if (!registered) {
    throw new Error(`Tool ${name} is not registered`);
  }
  const res = await registered.handler(args);
  const text = res.content[0]?.text ?? '{}';
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = { text };
  }
  return { payload, isError: Boolean(res.isError) };
}

function mockSessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    SessionID: SESSION_ID,
    Name: 'WS-FIN-01',
    GuestMachineName: 'DESKTOP-FIN01',
    SessionGroupPath: 'All Machines/Contoso',
    GuestConnectedCount: 1,
    CustomPropertyValues: ['Contoso', 'Finance', '', '', '', '', '', ''],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSharedClient();
});

describe('read tool additions', () => {
  it('get_session calls GetSessionBySessionID and returns normalized session', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(mockSessionPayload()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const server = createServer(baseConfig({ allowedGroups: ['All Machines/Contoso'] }));
    const { payload, isError } = await invokeTool(server, 'get_session', {
      sessionId: SESSION_ID,
    });
    expect(isError).toBe(false);
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.name).toBe('WS-FIN-01');
    expect(payload.machineName).toBe('DESKTOP-FIN01');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/GetSessionBySessionID');
  });

  it('list_sessions passes offlineOnly as GuestConnectedCount = 0', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([mockSessionPayload({ GuestConnectedCount: 0 })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const server = createServer(baseConfig());
    const { payload, isError } = await invokeTool(server, 'list_sessions', {
      offlineOnly: true,
    });
    expect(isError).toBe(false);
    expect(payload.filter).toBe('GuestConnectedCount = 0');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as string[];
    expect(body[0]).toBe('GuestConnectedCount = 0');
  });
});

describe('write tool dryRun safety', () => {
  it('dryRun validates session and returns preview without mutating upstream', async () => {
    const calledMethods: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const method = url.split('/').pop() ?? '';
        calledMethods.push(method);
        if (method === 'GetSessionBySessionID') {
          return new Response(JSON.stringify(mockSessionPayload()), { status: 200 });
        }
        if (method === 'GetSessionDetailsBySessionID') {
          return new Response(JSON.stringify({ Session: mockSessionPayload() }), { status: 200 });
        }
        throw new Error(`Unexpected mutating call during dryRun: ${method}`);
      }),
    );

    const server = createServer(baseConfig({ mode: 'write' }));

    const noteRes = await invokeTool(server, 'add_session_note', {
      sessionId: SESSION_ID,
      note: 'Ticket #42',
      dryRun: true,
    });
    expect(noteRes.isError).toBe(false);
    expect(noteRes.payload.dryRun).toBe(true);
    expect((noteRes.payload.preview as Record<string, unknown>).note).toBe('Ticket #42');

    const msgRes = await invokeTool(server, 'send_message_to_session', {
      sessionId: SESSION_ID,
      message: 'Rebooting in 5m',
      byHost: 'MSP Desk',
      dryRun: true,
    });
    expect(msgRes.isError).toBe(false);
    expect(msgRes.payload.dryRun).toBe(true);
    expect((msgRes.payload.preview as Record<string, unknown>).byHost).toBe('MSP Desk');

    const renameRes = await invokeTool(server, 'update_session_name', {
      sessionId: SESSION_ID,
      name: 'WS-FIN-01-NEW',
      dryRun: true,
    });
    expect(renameRes.isError).toBe(false);
    expect(renameRes.payload.dryRun).toBe(true);
    expect((renameRes.payload.preview as Record<string, unknown>).currentName).toBe('WS-FIN-01');
    expect((renameRes.payload.preview as Record<string, unknown>).newName).toBe('WS-FIN-01-NEW');

    const propsRes = await invokeTool(server, 'update_custom_properties', {
      sessionId: SESSION_ID,
      properties: { '3': 'Prod' },
      dryRun: true,
    });
    expect(propsRes.isError).toBe(false);
    expect(propsRes.payload.dryRun).toBe(true);
    expect((propsRes.payload.preview as { mergedCustomProperties: string[] }).mergedCustomProperties).toEqual([
      'Contoso',
      'Finance',
      'Prod',
      '',
      '',
      '',
      '',
      '',
    ]);

    expect(calledMethods).toEqual([
      'GetSessionBySessionID',
      'GetSessionBySessionID',
      'GetSessionBySessionID',
      'GetSessionDetailsBySessionID',
    ]);
  });
});

describe('destructive tool expectedName target guard', () => {
  it('blocks send_command_to_session and send_toolbox_item on expectedName mismatch before queuing', async () => {
    const calledMethods: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const method = String(input).split('/').pop() ?? '';
        calledMethods.push(method);
        if (method === 'GetSessionBySessionID') {
          return new Response(JSON.stringify(mockSessionPayload()), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const server = createServer(baseConfig({ mode: 'destructive', enableCommands: true }));

    const cmdMismatch = await invokeTool(server, 'send_command_to_session', {
      sessionId: SESSION_ID,
      command: 'whoami',
      expectedName: 'WRONG-HOST',
      confirm: true,
    });
    expect(cmdMismatch.isError).toBe(true);
    expect(cmdMismatch.payload.code).toBe('target_mismatch');

    const toolboxMismatch = await invokeTool(server, 'send_toolbox_item', {
      sessionId: SESSION_ID,
      toolboxItemName: 'Diag.ps1',
      expectedName: 'OTHER-PC',
      confirm: true,
    });
    expect(toolboxMismatch.isError).toBe(true);
    expect(toolboxMismatch.payload.code).toBe('target_mismatch');

    // No mutating upstream calls should have been made
    expect(calledMethods).toEqual(['GetSessionBySessionID', 'GetSessionBySessionID']);

    // Case-insensitive match against machineName should succeed
    const cmdMatch = await invokeTool(server, 'send_command_to_session', {
      sessionId: SESSION_ID,
      command: 'whoami',
      expectedName: 'desktop-fin01',
      confirm: true,
    });
    expect(cmdMatch.isError).toBe(false);
    expect(cmdMatch.payload.ok).toBe(true);

    // Case-insensitive match against session name should succeed
    const toolboxMatch = await invokeTool(server, 'send_toolbox_item', {
      sessionId: SESSION_ID,
      toolboxItemName: 'Diag.ps1',
      expectedName: 'ws-fin-01',
      confirm: true,
    });
    expect(toolboxMatch.isError).toBe(false);
    expect(toolboxMatch.payload.ok).toBe(true);

    expect(calledMethods).toEqual([
      'GetSessionBySessionID',
      'GetSessionBySessionID',
      'GetSessionBySessionID',
      'SendCommandToSession',
      'GetSessionBySessionID',
      'SendToolboxItemToSession',
    ]);
  });
});
