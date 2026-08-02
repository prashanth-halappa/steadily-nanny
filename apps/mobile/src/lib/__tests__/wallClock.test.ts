/**
 * @module lib/__tests__/wallClock.test
 * D23 — DST-safe wall-clock ↔ UTC for shift edits.
 */
import { describe, expect, it } from 'bun:test';
import {
  shiftInstantsFromWallClock,
  utcIsoToWallClockHHMM,
  wallClockToUtcIso,
} from '../wallClock';

describe('wallClockToUtcIso', () => {
  it('converts Europe/London winter wall clock to UTC', () => {
    // GMT: local 09:00 = 09:00Z
    expect(wallClockToUtcIso('2026-01-07', '09:00', 'Europe/London')).toBe(
      '2026-01-07T09:00:00.000Z'
    );
  });

  it('converts Europe/London summer wall clock across BST', () => {
    // BST: local 09:00 = 08:00Z
    expect(wallClockToUtcIso('2026-08-03', '09:00', 'Europe/London')).toBe(
      '2026-08-03T08:00:00.000Z'
    );
  });

  it('handles overnight end times on the same local_date when ends after midnight in UTC', () => {
    const start = wallClockToUtcIso('2026-08-03', '22:00', 'America/New_York');
    const end = wallClockToUtcIso('2026-08-04', '02:00', 'America/New_York');
    expect(new Date(end).getTime()).toBeGreaterThan(new Date(start).getTime());
  });

  it('accepts HH:MM:SS the same as HH:MM', () => {
    expect(wallClockToUtcIso('2026-08-03', '09:00:00', 'Europe/London')).toBe(
      wallClockToUtcIso('2026-08-03', '09:00', 'Europe/London')
    );
  });
});

describe('utcIsoToWallClockHHMM', () => {
  it('round-trips a London summer instant', () => {
    const iso = wallClockToUtcIso('2026-08-03', '09:30', 'Europe/London');
    expect(utcIsoToWallClockHHMM(iso, 'Europe/London')).toBe('09:30');
  });
});

describe('shiftInstantsFromWallClock', () => {
  it('keeps a same-day shift on its own local_date', () => {
    const { starts_at, ends_at } = shiftInstantsFromWallClock(
      '2026-08-03',
      '09:00',
      '17:00',
      'Europe/London'
    );
    expect(starts_at).toBe('2026-08-03T08:00:00.000Z');
    expect(ends_at).toBe('2026-08-03T16:00:00.000Z');
  });

  it('rolls an overnight end to the NEXT calendar day (19:00 -> 00:30)', () => {
    // The counter-offer bug: both instants built off the same local_date
    // produced an end ~18.5h BEFORE the start, so a nanny could not counter
    // an overnight shift at all.
    const { starts_at, ends_at } = shiftInstantsFromWallClock(
      '2026-08-03',
      '19:00',
      '00:30',
      'Europe/London'
    );
    expect(ends_at).toBe('2026-08-03T23:30:00.000Z');
    expect(new Date(ends_at).getTime()).toBeGreaterThan(
      new Date(starts_at).getTime()
    );
  });

  it('treats an end EQUAL to the start as a next-day end, never a zero-length shift', () => {
    const { starts_at, ends_at } = shiftInstantsFromWallClock(
      '2026-08-03',
      '22:00',
      '22:00',
      'Europe/London'
    );
    expect(new Date(ends_at).getTime() - new Date(starts_at).getTime()).toBe(
      24 * 60 * 60 * 1000
    );
  });

  it('crosses a month boundary correctly', () => {
    const { ends_at } = shiftInstantsFromWallClock(
      '2026-01-31',
      '20:00',
      '06:00',
      'Europe/London'
    );
    expect(ends_at).toBe('2026-02-01T06:00:00.000Z');
  });

  it('is DST-safe on both sides of a New York overnight', () => {
    const { starts_at, ends_at } = shiftInstantsFromWallClock(
      '2026-08-03',
      '22:00',
      '02:00',
      'America/New_York'
    );
    expect(new Date(ends_at).getTime() - new Date(starts_at).getTime()).toBe(
      4 * 60 * 60 * 1000
    );
  });
});
