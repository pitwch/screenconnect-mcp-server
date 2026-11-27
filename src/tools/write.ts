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
  summarizeSession,
} from './session-utils.js';

const dryRunSchema = z
  .boolean()
  .optional()
  .default(false)
  .describe('If true, validate allowlist and target session and return a preview without mutating ScreenConnect');

export function registerWriteTools(server: McpServer, config: ServerConfig): void {
  registerGatedTool(server, config, 'add_session_note', {
    title: 'Add session note',
    description: 'Append a note to a ScreenConnect session (AddNoteToSession). Supports dryRun=true.',
    tier: 'write',
    annotations: WRITE_CREATE,
    method: 'AddNoteToSession',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      note: z.string().min(1).max(8000).describe('Note body'),
      dryRun: dryRunSchema,
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    commandPreviewFromArgs: (a) => a.note,
    handler: async ({ sessionId, note, dryRun }, cfg) => {
      const session = await fetchSessionById(cfg, sessionId);
      if (dryRun) {
        const summary = summarizeSession(session);
        return {
          ok: true,
          dryRun: true,
          action: 'add_session_note',
          preview: {
            sessionId,
            sessionName: summary.name,
            machineName: summary.machineName,
            note,
          },
        };
      }
      const client = getSharedClient(cfg);
      await client.call('AddNoteToSession', [sessionId, note]);
      return { ok: true, sessionId, action: 'add_session_note' };
    },
  });

  registerGatedTool(server, config, 'send_message_to_session', {
    title: 'Send message to session',
    description:
      'Send a guest-visible message (SendMessageToSession). Requires extension ≥ 1.0.6. Supports dryRun=true.',
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
      dryRun: dryRunSchema,
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    commandPreviewFromArgs: (a) => a.message,
    handler: async ({ sessionId, message, byHost, dryRun }, cfg) => {
      const session = await fetchSessionById(cfg, sessionId);
      const hostName = byHost ?? 'MCP';
      if (dryRun) {
        const summary = summarizeSession(session);
        return {
          ok: true,
          dryRun: true,
          action: 'send_message_to_session',
          preview: {
            sessionId,
            sessionName: summary.name,
            machineName: summary.machineName,
            byHost: hostName,
            message,
          },
        };
      }
      const client = getSharedClient(cfg);
      await client.call('SendMessageToSession', [sessionId, hostName, message]);
      return { ok: true, sessionId, action: 'send_message_to_session' };
    },
  });

  registerGatedTool(server, config, 'update_session_name', {
    title: 'Update session name',
    description: 'Rename a session (UpdateSessionName). Supports dryRun=true.',
    tier: 'write',
    annotations: WRITE_UPDATE,
    method: 'UpdateSessionName',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      name: z.string().min(1).max(256).describe('New session name'),
      dryRun: dryRunSchema,
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    handler: async ({ sessionId, name, dryRun }, cfg) => {
      const session = await fetchSessionById(cfg, sessionId);
      if (dryRun) {
        const summary = summarizeSession(session);
        return {
          ok: true,
          dryRun: true,
          action: 'update_session_name',
          preview: {
            sessionId,
            currentName: summary.name,
            newName: name,
            machineName: summary.machineName,
          },
        };
      }
      const client = getSharedClient(cfg);
      await client.call('UpdateSessionName', [sessionId, name]);
      return { ok: true, sessionId, name, action: 'update_session_name' };
    },
  });

  registerGatedTool(server, config, 'update_custom_properties', {
    title: 'Update custom properties',
    description:
      'Merge custom property slots 1–8 onto a session (read-modify-write via UpdateSessionCustomProperties). Empty string clears a slot. Supports dryRun=true.',
    tier: 'write',
    annotations: WRITE_UPDATE,
    method: 'UpdateSessionCustomProperties',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      properties: z
        .record(z.string(), z.string())
        .describe('Map of slots "1".."8" to new values'),
      dryRun: dryRunSchema,
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    handler: async ({ sessionId, properties, dryRun }, cfg) => {
      const details = await fetchSessionDetails(cfg, sessionId);
      const normalized = normalizeSession(details);
      const merged = mergeCustomProperties(normalized.customPropertySource, properties);
      if (dryRun) {
        return {
          ok: true,
          dryRun: true,
          action: 'update_custom_properties',
          preview: {
            sessionId,
            sessionName: normalized.name,
            machineName: normalized.machineName,
            currentCustomProperties: normalized.customProperties,
            mergedCustomProperties: merged,
          },
        };
      }
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
