import { describe, expect, it, vi } from 'vitest';
import { PolicyError } from '../src/client/errors.js';
import {
  assertSessionGroupAllowed,
  buildAllowlistFilterClause,
  isGroupAllowed,
} from '../src/policy/groups.js';
import { assertModeAllows, listEnabledTiers, modeAllows } from '../src/policy/modes.js';
import { redactForAudit, writeAudit } from '../src/policy/audit.js';

describe('modes', () => {
  it('ranks modes correctly', () => {
    expect(modeAllows('read', 'read')).toBe(true);
    expect(modeAllows('read', 'write')).toBe(false);
    expect(modeAllows('write', 'write')).toBe(true);
    expect(modeAllows('write', 'destructive')).toBe(false);
    expect(modeAllows('destructive', 'destructive')).toBe(true);
  });

  it('requires enableCommands for destructive', () => {
    expect(() => assertModeAllows('destructive', 'destructive', 'send_command_to_session', false)).toThrow(
      PolicyError,
    );
    expect(() => assertModeAllows('destructive', 'destructive', 'send_command_to_session', true)).not.toThrow();
  });

  it('lists enabled tiers', () => {
    expect(listEnabledTiers('read', false)).toEqual(['read']);
    expect(listEnabledTiers('write', false)).toEqual(['read', 'write']);
    expect(listEnabledTiers('destructive', true)).toEqual(['read', 'write', 'destructive']);
    expect(listEnabledTiers('destructive', false)).toEqual(['read', 'write']);
  });
});

describe('groups', () => {
  it('allows all when allowlist empty', () => {
    expect(isGroupAllowed([], ['All Machines/Contoso'])).toBe(true);
  });

  it('matches exact paths and path prefixes only', () => {
    expect(isGroupAllowed(['All Machines/Contoso'], ['All Machines/Contoso'])).toBe(true);
    expect(isGroupAllowed(['All Machines'], ['All Machines/Contoso'])).toBe(true);
    expect(isGroupAllowed(['Contoso'], ['All Machines/Contoso'])).toBe(false);
    expect(isGroupAllowed(['Machines'], ['All Machines/Contoso'])).toBe(false);
    expect(isGroupAllowed(['IT'], ['All Machines/IT Dept'])).toBe(false);
    expect(isGroupAllowed(['All Machines/Contoso'], ['All Machines/Fabrikam'])).toBe(false);
  });

  it('asserts denial', () => {
    expect(() =>
      assertSessionGroupAllowed(['All Machines/Contoso'], {
        SessionGroupPath: 'All Machines/Fabrikam',
      }),
    ).toThrow(/ALLOWED_GROUPS/);
  });

  it('builds upstream allowlist filter clauses', () => {
    const clause = buildAllowlistFilterClause(['All Machines/Contoso']);
    expect(clause).toContain("SessionGroupPath = 'All Machines/Contoso'");
    expect(clause).toContain("SessionGroupPath LIKE 'All Machines/Contoso/*'");
  });
});

describe('audit redaction', () => {
  it('redacts secret-looking keys', () => {
    const redacted = redactForAudit({
      apiSecret: 'super-secret',
      nested: { token: 'abc', ok: true },
    }) as Record<string, unknown>;
    expect(redacted.apiSecret).toBe('[redacted]');
    expect((redacted.nested as Record<string, unknown>).token).toBe('[redacted]');
    expect((redacted.nested as Record<string, unknown>).ok).toBe(true);
  });

  it('redacts passwords inside commandPreview via writeAudit', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeAudit({
      ts: '2026-11-23T00:00:00.000Z',
      tool: 'send_command_to_session',
      tier: 'destructive',
      commandPreview: 'net user bob Password=SuperSecret123 /add',
      ok: true,
    });
    const line = String(err.mock.calls[0]?.[0] ?? '');
    expect(line).not.toContain('SuperSecret123');
    expect(line).toContain('[redacted]');
    err.mockRestore();
  });
});
