import type { ServerMode } from '../config.js';
import { PolicyError } from '../client/errors.js';

export type ToolTier = 'read' | 'write' | 'destructive';

const MODE_RANK: Record<ServerMode, number> = {
  read: 1,
  write: 2,
  destructive: 3,
};

export function modeAllows(mode: ServerMode, tier: ToolTier): boolean {
  return MODE_RANK[mode] >= MODE_RANK[tier];
}

export function assertModeAllows(
  mode: ServerMode,
  tier: ToolTier,
  toolName: string,
  enableCommands: boolean,
): void {
  if (tier === 'destructive' && !enableCommands) {
    throw new PolicyError(
      'commands_disabled',
      `Tool "${toolName}" is destructive and requires SCREENCONNECT_ENABLE_COMMANDS=true`,
    );
  }
  if (!modeAllows(mode, tier)) {
    throw new PolicyError(
      'mode_denied',
      `Tool "${toolName}" requires SCREENCONNECT_MODE=${tier} (current mode: ${mode})`,
    );
  }
}

export function listEnabledTiers(mode: ServerMode, enableCommands: boolean): ToolTier[] {
  const tiers: ToolTier[] = ['read'];
  if (modeAllows(mode, 'write')) tiers.push('write');
  if (modeAllows(mode, 'destructive') && enableCommands) tiers.push('destructive');
  return tiers;
}
