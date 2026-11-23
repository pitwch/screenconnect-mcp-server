import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractEvents,
  eventTypeName,
  findCommandOutputEvents,
  mergeCustomProperties,
  normalizeEvent,
  normalizeSession,
  redactSensitiveFields,
  summarizeSession,
} from '../src/tools/session-utils.js';

const here = dirname(fileURLToPath(import.meta.url));
const flatDetails = JSON.parse(
  readFileSync(join(here, 'fixtures/session-details.json'), 'utf8'),
);
const nestedDetails = JSON.parse(
  readFileSync(join(here, 'fixtures/session-details.nested.json'), 'utf8'),
);
const liveList = JSON.parse(
  readFileSync(join(here, 'fixtures/sessions-by-filter.live-shape.json'), 'utf8'),
);

describe('session utils + fixtures', () => {
  it('summarizes flat fixture sessions', () => {
    const summary = summarizeSession(flatDetails);
    expect(summary.sessionId).toBe('11111111-1111-4111-8111-111111111111');
    expect(summary.guestConnected).toBe(true);
    expect(summary.groups).toContain('All Machines/Contoso');
  });

  it('flattens nested Session / GuestInfo details from live API shape', () => {
    const summary = summarizeSession(nestedDetails);
    expect(summary.sessionId).toBe('11111111-1111-4111-8111-111111111111');
    expect(summary.name).toBe('TPVC-01');
    expect(summary.operatingSystem).toBe('Windows 11 Pro');
    expect(summary.loggedOnUser).toBe('TEPPICH\\jdoe');
    expect(summary.loggedOnUserDomain).toBe('TEPPICH');
    expect(summary.networkAddress).toBe('172.161.98.243');
    expect(summary.privateNetworkAddress).toBe('192.168.10.21');
    expect(summary.customProperties[0]).toBe('Teppich Quelle AG');
    expect(summary.machineName).toBe('TPVC-01');
    expect(summary.guestConnected).toBe(true);
  });

  it('reads online state from IsGuestConnected / nested list shapes', () => {
    const online = summarizeSession(liveList[0]);
    expect(online.guestConnected).toBe(true);
    expect(online.operatingSystem).toBe('Windows 11 Pro');
    const offline = summarizeSession(liveList[1]);
    expect(offline.machineName).toBe('PXDETEC');
    expect(offline.name).toBe('Detec AG');
    expect(offline.guestConnected).toBe(false);
  });

  it('extracts and filters command events from nested details', () => {
    const events = extractEvents(nestedDetails);
    expect(events.length).toBe(4);
    const commands = findCommandOutputEvents(events, '2026-11-20T08:04:00.000Z');
    expect(commands).toHaveLength(1);
    expect(commands[0]?.data).toContain('Windows IP Configuration');
  });

  it('maps event type codes to readable names', () => {
    expect(eventTypeName(10)).toBe('Connected');
    expect(eventTypeName(11)).toBe('Disconnected');
    expect(eventTypeName(30)).toBe('RanToolOrUrl');
    expect(eventTypeName(70)).toBe('RanCommand');
    expect(normalizeEvent({ EventType: 10, Data: 'x' }).eventTypeName).toBe('Connected');
  });

  it('redacts sensitive fields for includeRaw', () => {
    const redacted = redactSensitiveFields(nestedDetails) as {
      Session: { GuestInfo: Record<string, unknown> };
    };
    expect(redacted.Session.GuestInfo.GuestPublicKey).toBe('[redacted]');
    expect(redacted.Session.GuestInfo.WakeToken).toBe('[redacted]');
    expect(redacted.Session.GuestInfo.SerialNumber).toBe('[redacted]');
    expect(redacted.Session.GuestInfo.MacAddress).toBe('[redacted]');
    expect(redacted.Session.GuestInfo.GuestScreenshotContent).toBe('[redacted]');
    expect(redacted.Session.GuestInfo.OperatingSystemName).toBe('Windows 11 Pro');
  });

  it('merges custom property slots from short arrays', () => {
    const merged = mergeCustomProperties(['a', 'b'], { '2': 'updated', '8': 'last' });
    expect(merged).toEqual(['a', 'updated', '', '', '', '', '', 'last']);
    expect(merged).toHaveLength(8);
  });

  it('merges when upstream returns a map or non-array', () => {
    expect(mergeCustomProperties(null, { '1': 'x' })).toEqual([
      'x',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
    expect(mergeCustomProperties({ CustomProperty3: 'c' }, { '3': 'C' })[2]).toBe('C');
  });

  it('exposes customPropertySource from nested Session', () => {
    const n = normalizeSession(nestedDetails);
    expect(Array.isArray(n.customPropertySource)).toBe(true);
    expect((n.customPropertySource as string[])[0]).toBe('Teppich Quelle AG');
  });
});
