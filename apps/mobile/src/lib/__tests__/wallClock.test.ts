/**
 * @module lib/__tests__/wallClock.test
 * D23 — DST-safe wall-clock ↔ UTC for shift edits.
 */
import { describe, expect, it } from 'bun:test';
import { utcIsoToWallClockHHMM, wallClockToUtcIso } from '../wallClock';

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
