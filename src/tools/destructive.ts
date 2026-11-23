import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ServerConfig } from '../config.js';
import { getSharedClient } from '../client/screenconnect-client.js';
import { PolicyError } from '../client/errors.js';
import {
  registerGatedTool,
  sessionIdSchema,
  WRITE_IRREVERSIBLE,
} from './helpers.js';
import {
  extractEvents,
  fetchSessionById,
  fetchSessionDetails,
  findCommandOutputEvents,
} from './session-utils.js';

const confirmSchema = z
  .literal(true)
  .describe('Must be true to execute this destructive action');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCommandText(command: string, shell: 'cmd' | 'powershell', timeoutSeconds?: number): string {
  let text = command;
  if (shell === 'powershell' && !text.startsWith('#!ps')) {
    text = `#!ps\n${text}`;
  }
  if (timeoutSeconds && timeoutSeconds > 0 && !/#timeout\s*=/i.test(text)) {
    text = `#timeout=${timeoutSeconds}\n${text}`;
  }
  if (text.length > 8000) {
    throw new Error('command exceeds 8000 characters');
  }
  return text;
}

export function registerDestructiveTools(server: McpServer, config: ServerConfig): void {
  registerGatedTool(server, config, 'send_command_to_session', {
    title: 'Send command to session',
    description:
      '⚠ HIGH-IMPACT: queue a cmd/PowerShell command on the guest (SendCommandToSession). Requires confirm=true and SCREENCONNECT_ENABLE_COMMANDS=true. Optionally poll for RanCommand output.',
    tier: 'destructive',
    annotations: WRITE_IRREVERSIBLE,
    method: 'SendCommandToSession',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      command: z.string().min(1).max(8000),
      shell: z.enum(['cmd', 'powershell']).optional().default('cmd'),
      timeoutSeconds: z.number().int().min(1).max(3600).optional(),
      waitForOutputSeconds: z
        .number()
        .int()
        .min(0)
        .max(60)
        .optional()
        .default(0)
        .describe('If > 0, poll session details for command output events'),
      confirm: confirmSchema,
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    commandPreviewFromArgs: (a) => a.command,
    handler: async (args, cfg) => {
      if (args.confirm !== true) {
        throw new PolicyError('confirm_required', 'confirm must be true');
      }
      await fetchSessionById(cfg, args.sessionId);
      const commandText = buildCommandText(
        args.command,
        args.shell ?? 'cmd',
        args.timeoutSeconds,
      );
      const client = getSharedClient(cfg);
      const sentAt = new Date().toISOString();
      // Never retry command submission.
      await client.call('SendCommandToSession', [args.sessionId, commandText]);

      let output: string | undefined;
      const wait = args.waitForOutputSeconds ?? 0;
      if (wait > 0) {
        const deadline = Date.now() + wait * 1000;
        while (Date.now() < deadline) {
          await sleep(1000);
          const details = await fetchSessionDetails(cfg, args.sessionId);
          const events = findCommandOutputEvents(extractEvents(details), sentAt);
          if (events.length > 0) {
            const newest = events[0]!;
            output = newest.data;
            break;
          }
        }
        if (output && output.length > cfg.maxCommandOutputChars) {
          output = `${output.slice(0, cfg.maxCommandOutputChars)}…`;
        }
      }

      return {
        ok: true,
        sessionId: args.sessionId,
        action: 'send_command_to_session',
        sentAt,
        output: output ?? null,
        outputPending: wait > 0 && !output,
      };
    },
  });

  registerGatedTool(server, config, 'send_toolbox_item', {
    title: 'Send toolbox item',
    description:
      '⚠ HIGH-IMPACT: run a named toolbox item on the guest (SendToolboxItemToSession). Requires confirm=true.',
    tier: 'destructive',
    annotations: WRITE_IRREVERSIBLE,
    method: 'SendToolboxItemToSession',
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      toolboxItemName: z.string().min(1).max(256),
      confirm: confirmSchema,
    }),
    sessionIdFromArgs: (a) => a.sessionId,
    commandPreviewFromArgs: (a) => a.toolboxItemName,
    handler: async ({ sessionId, toolboxItemName, confirm }, cfg) => {
      if (confirm !== true) {
        throw new PolicyError('confirm_required', 'confirm must be true');
      }
      await fetchSessionById(cfg, sessionId);
      const client = getSharedClient(cfg);
      await client.call('SendToolboxItemToSession', [sessionId, toolboxItemName]);
      return { ok: true, sessionId, toolboxItemName, action: 'send_toolbox_item' };
    },
  });

  registerGatedTool(server, config, 'create_session', {
    title: 'Create session',
    description:
      '⚠ HIGH-IMPACT: create a Support/Meeting/Access session (CreateSession). Requires confirm=true.',
    tier: 'destructive',
    annotations: WRITE_IRREVERSIBLE,
    method: 'CreateSession',
    inputSchema: z.object({
      sessionType: z.enum(['Support', 'Meeting', 'Access']),
      name: z.string().min(1).max(256),
      isPublic: z.boolean().optional().default(false),
      code: z.string().max(128).optional().default(''),
      customPropertyValues: z
        .array(z.string())
        .max(8)
        .optional()
        .describe('Up to 8 custom property values'),
      confirm: confirmSchema,
    }),
    commandPreviewFromArgs: (a) => a.name,
    handler: async (args, cfg) => {
      if (args.confirm !== true) {
        throw new PolicyError('confirm_required', 'confirm must be true');
      }
      // Map enum names to ScreenConnect SessionType integers commonly used by the API:
      // Support=0, Meeting=1, Access=2 (community prior art).
      const typeMap = { Support: 0, Meeting: 1, Access: 2 } as const;
      const custom = args.customPropertyValues ?? [];
      while (custom.length < 8) custom.push('');
      const client = getSharedClient(cfg);
      const created = await client.call('CreateSession', [
        typeMap[args.sessionType],
        args.name,
        args.isPublic ?? false,
        args.code ?? '',
        custom.slice(0, 8),
      ]);
      return {
        ok: true,
        action: 'create_session',
        session: created,
      };
    },
  });
}
