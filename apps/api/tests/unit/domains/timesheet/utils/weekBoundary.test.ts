/**
 * The week boundary as a real INSTANT. `weekStartOf` answers "which week",
 * which is a calendar question; splitting a session that runs across the
 * household's own week turnover needs the exact moment that turnover happens
 * in the household's zone, and that moment moves with the offset. Get it
 * wrong by an hour and an hour of pay lands in the wrong week's timesheet.
 *
 * WHICH day the week turns over on is `households.week_starts_on` (§5 D-8),
 * so the same instant and the same zone give different boundaries for a
 * Monday-start and a Sunday-start household — a day apart, which is a whole
 * shift's worth of pay in the wrong week.
 */
import { describe, expect, it } from 'bun:test';
import { weekBoundaryInstant } from '../../../../../src/domains/timesheet/utils/weekBoundary';

/** 0=Sunday..6=Saturday, matching `households.week_starts_on`. */
const SUNDAY = 0;
const MONDAY = 1;

describe('weekBoundaryInstant (Monday-start household)', () => {
  it('is plain midnight UTC for a UTC household', () => {
    expect(
      weekBoundaryInstant(
        new Date('2026-01-11T23:00:00.000Z'),
        'UTC',
        MONDAY
      ).toISOString()
    ).toBe('2026-01-12T00:00:00.000Z');
  });

  it('London in GMT: the boundary is midnight UTC', () => {
    expect(
      weekBoundaryInstant(
        new Date('2026-01-11T23:00:00.000Z'),
        'Europe/London',
        MONDAY
      ).toISOString()
    ).toBe('2026-01-12T00:00:00.000Z');
  });

  it('London in BST: the boundary is 23:00Z on the Sunday', () => {
    // Sun 2026-08-09 22:00Z is 23:00 local, still Sunday. Local Monday
    // midnight is an hour later, i.e. 23:00Z — an hour EARLIER than the naive
    // UTC-midnight answer, which would file the first hour of Monday into
    // Sunday's week.
    expect(
      weekBoundaryInstant(
        new Date('2026-08-09T22:00:00.000Z'),
        'Europe/London',
        MONDAY
      ).toISOString()
    ).toBe('2026-08-09T23:00:00.000Z');
  });

  it('handles a zone WEST of UTC (New York, EDT)', () => {
    expect(
      weekBoundaryInstant(
        new Date('2026-08-10T02:00:00.000Z'), // Sun 22:00 local
        'America/New_York',
        MONDAY
      ).toISOString()
    ).toBe('2026-08-10T04:00:00.000Z');
  });

  it('handles a sub-hour offset (Kolkata, +05:30)', () => {
    expect(
      weekBoundaryInstant(
        new Date('2026-08-09T17:00:00.000Z'), // Sun 22:30 local
        'Asia/Kolkata',
        MONDAY
      ).toISOString()
    ).toBe('2026-08-09T18:30:00.000Z');
  });

  it('handles a quarter-hour offset (Chatham, +12:45/+13:45)', () => {
    // Sun 2026-08-09 10:00Z is Sun 22:45 local (NZ winter, +12:45).
    expect(
      weekBoundaryInstant(
        new Date('2026-08-09T10:00:00.000Z'),
        'Pacific/Chatham',
        MONDAY
      ).toISOString()
    ).toBe('2026-08-09T11:15:00.000Z');
  });

  it('takes the END of the week the instant is in, not the next seven days', () => {
    // A Monday-morning instant still belongs to the week that STARTED that
    // Monday, so the boundary is the FOLLOWING Monday.
    expect(
      weekBoundaryInstant(
        new Date('2026-01-05T10:00:00.000Z'),
        'Europe/London',
        MONDAY
      ).toISOString()
    ).toBe('2026-01-12T00:00:00.000Z');
  });

  it('lands on a local midnight across the spring-forward week (BST starts 2026-03-29)', () => {
    // The clocks go forward on the Sunday INSIDE the week, not at its Monday
    // boundary — so the boundary is BST-side midnight, 23:00Z on the Sunday.
    expect(
      weekBoundaryInstant(
        new Date('2026-03-29T12:00:00.000Z'),
        'Europe/London',
        MONDAY
      ).toISOString()
    ).toBe('2026-03-29T23:00:00.000Z');
  });

  it('lands on a local midnight across the autumn fall-back week (GMT returns 2026-10-25)', () => {
    expect(
      weekBoundaryInstant(
        new Date('2026-10-25T12:00:00.000Z'),
        'Europe/London',
        MONDAY
      ).toISOString()
    ).toBe('2026-10-26T00:00:00.000Z');
  });
});

describe('weekBoundaryInstant (Sunday-start household — the US default, §5 D-8)', () => {
  it('turns the week over a DAY EARLIER than the same household would on Monday', () => {
    // Sat 2026-08-08 12:00Z. Monday-start: next boundary is Mon 2026-08-10.
    // Sunday-start: next boundary is Sun 2026-08-09 — a full day of pay that
    // would otherwise be filed into the previous week.
    const instant = new Date('2026-08-08T12:00:00.000Z');
    expect(weekBoundaryInstant(instant, 'UTC', SUNDAY).toISOString()).toBe(
      '2026-08-09T00:00:00.000Z'
    );
    expect(weekBoundaryInstant(instant, 'UTC', MONDAY).toISOString()).toBe(
      '2026-08-10T00:00:00.000Z'
    );
  });

  it('takes the END of the week the instant is in: a Sunday-morning instant boundaries on the FOLLOWING Sunday', () => {
    expect(
      weekBoundaryInstant(
        new Date('2026-08-09T10:00:00.000Z'),
        'UTC',
        SUNDAY
      ).toISOString()
    ).toBe('2026-08-16T00:00:00.000Z');
  });

  it('New York (EDT): the Saturday-night boundary is 04:00Z on the Sunday', () => {
    expect(
      weekBoundaryInstant(
        new Date('2026-08-09T02:00:00.000Z'), // Sat 22:00 local
        'America/New_York',
        SUNDAY
      ).toISOString()
    ).toBe('2026-08-09T04:00:00.000Z');
  });

  it('Los Angeles (PDT) across a US fall-back week: still a real local midnight', () => {
    // US clocks go back on Sun 2026-11-01, i.e. ON the Sunday-start
    // household's own boundary day but hours after midnight — the boundary is
    // PDT-side midnight, 07:00Z.
    expect(
      weekBoundaryInstant(
        new Date('2026-10-28T12:00:00.000Z'),
        'America/Los_Angeles',
        SUNDAY
      ).toISOString()
    ).toBe('2026-11-01T07:00:00.000Z');
  });

  it('handles a sub-hour offset (Kolkata, +05:30)', () => {
    expect(
      weekBoundaryInstant(
        new Date('2026-08-08T17:00:00.000Z'), // Sat 22:30 local
        'Asia/Kolkata',
        SUNDAY
      ).toISOString()
    ).toBe('2026-08-08T18:30:00.000Z');
  });

  // GOLDEN-FIXES #25: a session's `clock_in_at` reaches the splitter either
  // straight off PostgREST (`+00:00`) or freshly built in JS (`.000Z`). Both
  // are the same instant and must produce the same boundary — the splitter
  // compares `getTime()`, never strings, and this pins that it stays that way.
  it('resolves identically whether the instant arrived as `+00:00` (PostgREST) or `.000Z` (JS)', () => {
    for (const weekStartsOn of [SUNDAY, MONDAY]) {
      expect(
        weekBoundaryInstant(
          new Date('2026-08-08T22:00:00+00:00'),
          'America/New_York',
          weekStartsOn
        ).getTime()
      ).toBe(
        weekBoundaryInstant(
          new Date('2026-08-08T22:00:00.000Z'),
          'America/New_York',
          weekStartsOn
        ).getTime()
      );
    }
  });

  it('is strictly after the instant it is given, for every weekStartsOn — the property that makes the split loop terminate', () => {
    // `splitAtWeekBoundaries` loops on this: if the boundary were ever <= the
    // span's start, a cancelled window spanning several weeks would spin.
    const instant = new Date('2026-08-06T13:45:30.000Z');
    for (const weekStartsOn of [0, 1, 2, 3, 4, 5, 6]) {
      expect(
        weekBoundaryInstant(
          instant,
          'America/Los_Angeles',
          weekStartsOn
        ).getTime()
      ).toBeGreaterThan(instant.getTime());
    }
  });
});
