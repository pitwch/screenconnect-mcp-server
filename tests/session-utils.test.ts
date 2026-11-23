import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractEvents,
  findCommandOutputEvents,
  mergeCustomProperties,
  summarizeSession,
  type SessionSummary,
} from '../src/tools/session-utils.js';

const here = dirname(fileURLToPath(import.meta.url));
const details = JSON.parse(
  readFileSync(join(here, 'fixtures/session-details.json'), 'utf8'),
) as SessionSummary;
const sessions = JSON.parse(
  readFileSync(join(here, 'fixtures/sessions-by-filter.json'), 'utf8'),
) as SessionSummary[];

describe('session utils + fixtures', () => {
  it('summarizes fixture sessions', () => {
    const summary = summarizeSession(sessions[0]!);
    expect(summary.sessionId).toBe('11111111-1111-4111-8111-111111111111');
    expect(summary.guestConnected).toBe(true);
    expect(summary.groups).toContain('All Machines/Contoso');
  });

  it('extracts and filters command events', () => {
    const events = extractEvents(details);
    expect(events.length).toBe(3);
    const commands = findCommandOutputEvents(events, '2026-11-20T08:04:00.000Z');
    expect(commands).toHaveLength(1);
    expect(commands[0]?.data).toContain('Windows IP Configuration');
  });

  it('merges custom property slots', () => {
    const merged = mergeCustomProperties(['a', 'b'], { '2': 'updated', '8': 'last' });
    expect(merged).toEqual(['a', 'updated', '', '', '', '', '', 'last']);
  });
});
