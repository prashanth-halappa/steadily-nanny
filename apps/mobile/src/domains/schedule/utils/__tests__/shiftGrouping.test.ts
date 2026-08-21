/**
 * @module domains/schedule/utils/__tests__/shiftGrouping.test
 * A9 — one clock format for schedule display; parsing helpers stay on 24h.
 */
import { describe, expect, it } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import {
  formatShiftTime,
  hourInZone,
  minutesInZone,
  totalCoveringMinutes,
} from '../shiftGrouping';

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    household_id: '22222222-2222-4222-8222-222222222222',
    carer_id: '33333333-3333-4333-8333-333333333333',
    created_by: '44444444-4444-4444-8444-444444444444',
    kind: 'recurring',
    status: 'confirmed',
    origin: 'system_generated',
    starts_at: '2026-08-03T09:00:00.000Z',
    ends_at: '2026-08-03T17:00:00.000Z',
    timezone: 'UTC',
    local_date: '2026-08-03',
    is_short_notice: false,
    source_pattern_id: null,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift@test',
    sequence: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('totalCoveringMinutes', () => {
  it('sums multiple covering shifts', () => {
    // 8h + 4h = 720 minutes
    expect(
      totalCoveringMinutes([
        makeShift({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          starts_at: '2026-08-03T09:00:00.000Z',
          ends_at: '2026-08-03T17:00:00.000Z',
        }),
        makeShift({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          starts_at: '2026-08-04T09:00:00.000Z',
          ends_at: '2026-08-04T13:00:00.000Z',
        }),
      ])
    ).toBe(720);
  });

  it('excludes cancelled shifts', () => {
    expect(
      totalCoveringMinutes([
        makeShift({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          status: 'cancelled',
          starts_at: '2026-08-03T09:00:00.000Z',
          ends_at: '2026-08-03T17:00:00.000Z',
        }),
        makeShift({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          status: 'confirmed',
          starts_at: '2026-08-04T09:00:00.000Z',
          ends_at: '2026-08-04T13:00:00.000Z',
        }),
      ])
    ).toBe(240);
  });

  it('excludes declined shifts', () => {
    expect(
      totalCoveringMinutes([
        makeShift({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          status: 'declined',
          starts_at: '2026-08-03T09:00:00.000Z',
          ends_at: '2026-08-03T17:00:00.000Z',
        }),
        makeShift({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          status: 'confirmed',
          starts_at: '2026-08-04T09:00:00.000Z',
          ends_at: '2026-08-04T13:00:00.000Z',
        }),
      ])
    ).toBe(240);
  });

  it('returns 0 for an empty array', () => {
    expect(totalCoveringMinutes([])).toBe(0);
  });

  it('two overlapping shifts by different carers sum to BOTH durations (not a union)', () => {
    // Same wall-clock window, two carers — 8h + 8h = 960, never 480.
    expect(
      totalCoveringMinutes([
        makeShift({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          carer_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          starts_at: '2026-08-03T09:00:00.000Z',
          ends_at: '2026-08-03T17:00:00.000Z',
        }),
        makeShift({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          carer_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          starts_at: '2026-08-03T09:00:00.000Z',
          ends_at: '2026-08-03T17:00:00.000Z',
        }),
      ])
    ).toBe(960);
  });
});

describe('formatShiftTime', () => {
  const iso = '2026-08-03T14:00:00.000Z';
  const timeZone = 'UTC';

  it('matches device-locale display (12-hour) via formatClockTime', () => {
    expect(formatShiftTime(iso, timeZone, 'en-US')).toBe(
      formatClockTime(iso, timeZone, 'en-US')
    );
    const formatted = formatShiftTime(iso, timeZone, 'en-US');
    expect(formatted.toLowerCase()).toMatch(/2:00/);
    expect(formatted.toLowerCase()).toMatch(/pm/);
  });

  it('matches device-locale display (24-hour) via formatClockTime', () => {
    expect(formatShiftTime(iso, timeZone, 'en-GB')).toBe(
      formatClockTime(iso, timeZone, 'en-GB')
    );
    expect(formatShiftTime(iso, timeZone, 'en-GB')).toBe('14:00');
  });
});

describe('minutesInZone', () => {
  it('still parses 24h wall-clock from formatInstantInZone under a 12-hour locale', () => {
    expect(minutesInZone('2026-08-03T09:00:00.000Z', 'UTC')).toBe(9 * 60);
    expect(minutesInZone('2026-08-03T14:30:00.000Z', 'UTC')).toBe(14 * 60 + 30);
    expect(minutesInZone('2026-08-03T23:45:00.000Z', 'UTC')).toBe(23 * 60 + 45);
  });
});

describe('hourInZone', () => {
  it('still parses hour 0–23 from formatInstantInZone under a 12-hour locale', () => {
    expect(hourInZone('2026-08-03T09:00:00.000Z', 'UTC')).toBe(9);
    expect(hourInZone('2026-08-03T14:30:00.000Z', 'UTC')).toBe(14);
    expect(hourInZone('2026-08-03T00:00:00.000Z', 'America/New_York')).toBe(20);
  });
});
