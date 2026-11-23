import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ServerConfig } from '../config.js';
import { PolicyError, ScreenConnectApiError } from '../client/errors.js';
import { writeAudit } from '../policy/audit.js';
import { assertModeAllows, type ToolTier } from '../policy/modes.js';

export function textResult(data: unknown, isError = false) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: 'text' as const, text }],
    isError,
  };
}

export const READ_ONLY = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

/** Local metadata — no upstream call. */
export const LOCAL_READ_ONLY = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
  idempotentHint: true,
} as const;

export const WRITE_CREATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const WRITE_UPDATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const WRITE_IRREVERSIBLE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const sessionIdSchema = z
  .string()
  .uuid()
  .describe('ScreenConnect session GUID');

export function mapToolError(err: unknown): ReturnType<typeof textResult> {
  if (err instanceof PolicyError) {
    return textResult({ error: err.message, code: err.code }, true);
  }
  if (err instanceof ScreenConnectApiError) {
    return textResult({ error: err.message, code: err.code, status: err.status }, true);
  }
  return textResult(err instanceof Error ? err.message : String(err), true);
}

export type GatedToolConfig<T extends z.ZodRawShape> = {
  title: string;
  description: string;
  tier: ToolTier;
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema: z.ZodObject<T>;
  method?: string;
  sessionIdFromArgs?: (args: z.infer<z.ZodObject<T>>) => string | undefined;
  commandPreviewFromArgs?: (args: z.infer<z.ZodObject<T>>) => string | undefined;
  handler: (args: z.infer<z.ZodObject<T>>, config: ServerConfig) => Promise<unknown>;
};

export function registerGatedTool<T extends z.ZodRawShape>(
  server: McpServer,
  config: ServerConfig,
  name: string,
  tool: GatedToolConfig<T>,
): void {
  // Hide tools outside the active mode entirely.
  try {
    assertModeAllows(config.mode, tool.tier, name, config.enableCommands);
  } catch {
    return;
  }

  server.registerTool(
    name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    },
    async (args) => {
      try {
        // Defense in depth if registration ever changes.
        assertModeAllows(config.mode, tool.tier, name, config.enableCommands);
        const result = await tool.handler(args, config);
        writeAudit({
          ts: new Date().toISOString(),
          tool: name,
          tier: tool.tier,
          method: tool.method,
          sessionId: tool.sessionIdFromArgs?.(args),
          commandPreview: tool.commandPreviewFromArgs?.(args),
          ok: true,
        });
        return textResult(result);
      } catch (err) {
        writeAudit({
          ts: new Date().toISOString(),
          tool: name,
          tier: tool.tier,
          method: tool.method,
          sessionId: tool.sessionIdFromArgs?.(args),
          commandPreview: tool.commandPreviewFromArgs?.(args),
          ok: false,
          errorCode:
            err instanceof PolicyError
              ? err.code
              : err instanceof ScreenConnectApiError
                ? err.code ?? `http_${err.status}`
                : 'error',
        });
        return mapToolError(err);
      }
    },
  );
}

export function paginate<T>(items: T[], limit = 50, offset = 0): {
  items: T[];
  totalCount: number;
  limit: number;
  offset: number;
} {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const safeOffset = Math.max(offset, 0);
  return {
    items: items.slice(safeOffset, safeOffset + safeLimit),
    totalCount: items.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}
