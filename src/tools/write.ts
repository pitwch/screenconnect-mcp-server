import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ServerConfig } from '../config.js';
import { getSharedClient } from '../client/screenconnect-client.js';
import {
  registerGatedTool,
  sessionIdSchema,
  WRITE_CREATE,
  WRITE_UPDATE,
} from './helpers.js';
import {
  fetchSessionById,
  fetchSessionDetails,
  mergeCustomProperties,
  normalizeSession,
} from './session-utils.js';

export function registerWriteTools(server: McpServer, config: ServerConfig): void {
  registerGatedTool(server, config, 'add_session_note', {
    title: 'Add session note',
    description: 'Append a note to a ScreenConnect session (AddNoteToSession).',
    tier: 'write',
    annotations: WRITE_CREATE,
    method: 'AddNoteToSession',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      note: z.string().min(1).max(8000).describe('Note body'),
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    commandPreviewFromArgs: (a) => a.note,
    handler: async ({ sessionId, note }, cfg) => {
      await fetchSessionById(cfg, sessionId);
      const client = getSharedClient(cfg);
      await client.call('AddNoteToSession', [sessionId, note]);
      return { ok: true, sessionId, action: 'add_session_note' };
    },
  });

  registerGatedTool(server, config, 'send_message_to_session', {
    title: 'Send message to session',
    description: 'Send a guest-visible message (SendMessageToSession). Requires extension ≥ 1.0.6.',
    tier: 'write',
    annotations: WRITE_CREATE,
    method: 'SendMessageToSession',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      message: z.string().min(1).max(4000),
      byHost: z
        .string()
        .min(1)
        .max(128)
        .optional()
        .default('MCP')
        .describe('Host display name shown with the message'),
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    commandPreviewFromArgs: (a) => a.message,
    handler: async ({ sessionId, message, byHost }, cfg) => {
      await fetchSessionById(cfg, sessionId);
      const client = getSharedClient(cfg);
      await client.call('SendMessageToSession', [sessionId, byHost ?? 'MCP', message]);
      return { ok: true, sessionId, action: 'send_message_to_session' };
    },
  });

  registerGatedTool(server, config, 'update_session_name', {
    title: 'Update session name',
    description: 'Rename a session (UpdateSessionName).',
    tier: 'write',
    annotations: WRITE_UPDATE,
    method: 'UpdateSessionName',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      name: z.string().min(1).max(256).describe('New session name'),
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    handler: async ({ sessionId, name }, cfg) => {
      await fetchSessionById(cfg, sessionId);
      const client = getSharedClient(cfg);
      await client.call('UpdateSessionName', [sessionId, name]);
      return { ok: true, sessionId, name, action: 'update_session_name' };
    },
  });

  registerGatedTool(server, config, 'update_custom_properties', {
    title: 'Update custom properties',
    description:
      'Merge custom property slots 1–8 onto a session (read-modify-write via UpdateSessionCustomProperties). Empty string clears a slot.',
    tier: 'write',
    annotations: WRITE_UPDATE,
    method: 'UpdateSessionCustomProperties',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      properties: z
        .record(z.string(), z.string())
        .describe('Map of slots "1".."8" to new values'),
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    handler: async ({ sessionId, properties }, cfg) => {
      const details = await fetchSessionDetails(cfg, sessionId);
      const existing = normalizeSession(details).customPropertySource;
      const merged = mergeCustomProperties(existing, properties);
      const client = getSharedClient(cfg);
      await client.call('UpdateSessionCustomProperties', [sessionId, merged]);
      return {
        ok: true,
        sessionId,
        customProperties: merged,
        action: 'update_custom_properties',
      };
    },
  });
}
