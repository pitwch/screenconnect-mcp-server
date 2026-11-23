import { describe, expect, it } from 'vitest';
import { buildSessionFilter } from '../src/client/filter.js';

describe('buildSessionFilter', () => {
  it('builds structured filter', () => {
    const filter = buildSessionFilter({
      name: 'WS-FIN',
      onlineOnly: true,
      sessionType: 'Access',
    });
    expect(filter).toContain("SessionType = 'Access'");
    expect(filter).toContain("Name LIKE '*WS-FIN*'");
    expect(filter).toContain('GuestConnectedCount > 0');
  });

  it('escapes single quotes in literals', () => {
    const filter = buildSessionFilter({ name: "O'Brien" });
    expect(filter).toContain("'*O''Brien*'");
  });

  it('rejects mixing raw filter with structured fields', () => {
    expect(() => buildSessionFilter({ filter: "Name = 'x'", onlineOnly: true })).toThrow(
      /cannot be combined/,
    );
  });

  it('accepts raw filter alone', () => {
    expect(buildSessionFilter({ filter: "CustomProperty1 LIKE '*Critical*'" })).toBe(
      "CustomProperty1 LIKE '*Critical*'",
    );
  });
});
