/**
 * Written BEFORE the implementation exists (TDD red-first). Pure function,
 * no mocks needed. The week's FIRST DAY is per-household
 * (`households.week_starts_on`, migration 075 — 0=Sunday..6=Saturday, §5
 * D-8: chosen at setup, immutable once a timesheet exists), computed in the
 * household's timezone — get either wrong and every weekly total is
 * misfiled, so this exercises every `weekStartsOn` value plus cases where
 * the UTC calendar date and the household's local calendar date actually
 * disagree (the whole reason this can't just truncate a UTC Date).
 *
 * @module tests/unit/domains/timesheet/utils/weekStart
 */
import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_WEEK_STARTS_ON,
  weekEndExclusive,
  weekEndInclusive,
  weekStartOf,
  weekStartOfLocalDate,
} from '../../../../../src/domains/timesheet/utils/weekStart';

/** 0=Sunday..6=Saturday, matching `households.week_starts_on`. */
const SUNDAY = 0;
const MONDAY = 1;
const SATURDAY = 6;

describe('weekStartOf (Monday-start household)', () => {
  it('returns the same date for an instant that is already a Monday, in a timezone matching UTC', () => {
    // 2026-08-03T10:00:00Z is a Monday.
    expect(
      weekStartOf(new Date('2026-08-03T10:00:00.000Z'), 'UTC', MONDAY)
    ).toBe('2026-08-03');
  });

  it('returns the preceding Monday for an instant that is a Sunday, in a timezone matching UTC', () => {
    // 2026-08-09T10:00:00Z is a Sunday; the household's week started 2026-08-03.
    expect(
      weekStartOf(new Date('2026-08-09T10:00:00.000Z'), 'UTC', MONDAY)
    ).toBe('2026-08-03');
  });

  it('uses the LOCAL calendar date, not UTC: a UTC-Sunday instant that is already Monday in a timezone ahead of UTC', () => {
    // 2026-08-02T23:30:00Z is Sunday in UTC, but 2026-08-03T11:30 NZST
    // (Pacific/Auckland, UTC+12 in August) — already Monday locally, so the
    // week start IS that date, not the Monday before.
    expect(
      weekStartOf(
        new Date('2026-08-02T23:30:00.000Z'),
        'Pacific/Auckland',
        MONDAY
      )
    ).toBe('2026-08-03');
  });

  it('uses the LOCAL calendar date, not UTC: a UTC-Monday instant that is still Sunday in a timezone behind UTC', () => {
    // 2026-08-03T01:30:00Z is Monday in UTC, but 2026-08-02T18:30 PDT
    // (America/Los_Angeles, UTC-7 in August) — still Sunday locally, so the
    // week start is the PRECEDING Monday, not the UTC date's Monday.
    expect(
      weekStartOf(
        new Date('2026-08-03T01:30:00.000Z'),
        'America/Los_Angeles',
        MONDAY
      )
    ).toBe('2026-07-27');
  });
});

describe('weekStartOf (Sunday-start household — the US default, §5 D-8)', () => {
  it('returns the same date for an instant that is already a Sunday', () => {
    expect(
      weekStartOf(new Date('2026-08-09T10:00:00.000Z'), 'UTC', SUNDAY)
    ).toBe('2026-08-09');
  });

  it('files a MONDAY into the Sunday that started its week — the case a Monday-start household files a week later', () => {
    expect(
      weekStartOf(new Date('2026-08-03T10:00:00.000Z'), 'UTC', SUNDAY)
    ).toBe('2026-08-02');
  });

  it('files a Saturday into the preceding Sunday', () => {
    expect(
      weekStartOf(new Date('2026-08-08T10:00:00.000Z'), 'UTC', SUNDAY)
    ).toBe('2026-08-02');
  });

  it('still resolves the calendar date in the HOUSEHOLD zone: a UTC-Saturday instant already Sunday in Auckland', () => {
    // 2026-08-08T23:30:00Z is Saturday in UTC, Sunday 2026-08-09 11:30 NZST.
    expect(
      weekStartOf(
        new Date('2026-08-08T23:30:00.000Z'),
        'Pacific/Auckland',
        SUNDAY
      )
    ).toBe('2026-08-09');
  });

  it('still resolves the calendar date in the HOUSEHOLD zone: a UTC-Sunday instant still Saturday in Los Angeles', () => {
    // 2026-08-09T01:30:00Z is Sunday in UTC, Saturday 2026-08-08 18:30 PDT.
    expect(
      weekStartOf(
        new Date('2026-08-09T01:30:00.000Z'),
        'America/Los_Angeles',
        SUNDAY
      )
    ).toBe('2026-08-02');
  });

  // GOLDEN-FIXES #25: the same instant has two legal ISO-8601 serialisations —
  // PostgREST hands back `+00:00`, JS `toISOString()` writes `.000Z`. Anything
  // that reaches this helper may have come from either, so both must resolve
  // to the same week. One style proves nothing.
  it('resolves identically whether the instant arrived as `+00:00` (PostgREST) or `.000Z` (JS)', () => {
    expect(
      weekStartOf(new Date('2026-08-09T01:30:00+00:00'), 'UTC', SUNDAY)
    ).toBe(weekStartOf(new Date('2026-08-09T01:30:00.000Z'), 'UTC', SUNDAY));
    expect(
      weekStartOf(
        new Date('2026-08-08T23:30:00+00:00'),
        'Pacific/Auckland',
        SUNDAY
      )
    ).toBe(
      weekStartOf(
        new Date('2026-08-08T23:30:00.000Z'),
        'Pacific/Auckland',
        SUNDAY
      )
    );
  });
});

describe('weekEndExclusive', () => {
  it('returns the day exactly 7 days after weekStart', () => {
    expect(weekEndExclusive('2026-08-03')).toBe('2026-08-10');
  });

  it('crosses a month boundary correctly', () => {
    expect(weekEndExclusive('2026-08-31')).toBe('2026-09-07');
  });

  it('crosses a year boundary correctly', () => {
    expect(weekEndExclusive('2025-12-29')).toBe('2026-01-05');
  });

  // Deliberately NOT given a `weekStartsOn`: "seven days after the start" is
  // the same question whatever day the week starts on, so threading one
  // through would be a parameter that changes nothing — and a signature that
  // implies the answer depends on it. Pinned so a later slice doesn't "fix"
  // that by adding one.
  it('is week-start agnostic: +7 days from EVERY weekday, no configuration', () => {
    const weekStarts = [
      ['2026-08-02', '2026-08-09'], // Sunday
      ['2026-08-03', '2026-08-10'], // Monday
      ['2026-08-04', '2026-08-11'], // Tuesday
      ['2026-08-05', '2026-08-12'], // Wednesday
      ['2026-08-06', '2026-08-13'], // Thursday
      ['2026-08-07', '2026-08-14'], // Friday
      ['2026-08-08', '2026-08-15'], // Saturday
    ] as const;
    for (const [start, end] of weekStarts) {
      expect(weekEndExclusive(start)).toBe(end);
    }
  });
});

describe('weekEndInclusive', () => {
  it('returns the day exactly 6 days after weekStart — one day before weekEndExclusive', () => {
    expect(weekEndInclusive('2026-08-03')).toBe('2026-08-09');
    expect(weekEndExclusive('2026-08-03')).toBe('2026-08-10');
  });

  it('crosses a month boundary correctly', () => {
    expect(weekEndInclusive('2026-08-31')).toBe('2026-09-06');
  });

  it('is week-start agnostic, same as weekEndExclusive', () => {
    const weekStarts = [
      ['2026-08-02', '2026-08-08'],
      ['2026-08-03', '2026-08-09'],
      ['2026-08-08', '2026-08-14'],
    ] as const;
    for (const [start, end] of weekStarts) {
      expect(weekEndInclusive(start)).toBe(end);
    }
  });
});

// Phase 3/4 review, SERIOUS 6: an expense's `local_date` is ALREADY a
// household-local calendar date, so mapping it to its week needs pure date
// arithmetic and no timezone at all — passing it through `weekStartOf` would
// mean inventing an instant and a zone, the classic way a date slips a day.
describe('weekStartOfLocalDate', () => {
  it('returns the household`s own start weekday unchanged', () => {
    expect(weekStartOfLocalDate('2026-08-03', MONDAY)).toBe('2026-08-03');
    expect(weekStartOfLocalDate('2026-08-02', SUNDAY)).toBe('2026-08-02');
    expect(weekStartOfLocalDate('2026-08-08', SATURDAY)).toBe('2026-08-08');
  });

  it('maps a mid-week date back to its own week start, never forward', () => {
    expect(weekStartOfLocalDate('2026-08-06', MONDAY)).toBe('2026-08-03');
    expect(weekStartOfLocalDate('2026-08-06', SUNDAY)).toBe('2026-08-02');
    expect(weekStartOfLocalDate('2026-08-06', SATURDAY)).toBe('2026-08-01');
  });

  it('maps SUNDAY back to the Monday that started its week for a Monday household, never forward', () => {
    expect(weekStartOfLocalDate('2026-08-09', MONDAY)).toBe('2026-08-03');
  });

  // The `(dow - weekStartsOn + 7) % 7` arithmetic, exhaustively: ONE calendar
  // date (Thu 2026-08-06) against all seven legal `week_starts_on` values.
  it('resolves Thursday 2026-08-06 correctly for every weekStartsOn 0..6', () => {
    const expected: Record<number, string> = {
      0: '2026-08-02', // Sunday
      1: '2026-08-03', // Monday
      2: '2026-08-04', // Tuesday
      3: '2026-08-05', // Wednesday
      4: '2026-08-06', // Thursday — the date itself
      5: '2026-07-31', // Friday
      6: '2026-08-01', // Saturday
    };
    for (const [weekStartsOn, weekStart] of Object.entries(expected)) {
      expect(weekStartOfLocalDate('2026-08-06', Number(weekStartsOn))).toBe(
        weekStart
      );
    }
  });

  it('crosses a month boundary', () => {
    expect(weekStartOfLocalDate('2026-09-01', MONDAY)).toBe('2026-08-31');
    expect(weekStartOfLocalDate('2026-09-01', SUNDAY)).toBe('2026-08-30');
  });

  it('crosses a year boundary', () => {
    expect(weekStartOfLocalDate('2026-01-01', MONDAY)).toBe('2025-12-29');
    expect(weekStartOfLocalDate('2026-01-01', SUNDAY)).toBe('2025-12-28');
  });

  it('agrees with weekStartOf for the same calendar date in UTC, for every weekStartsOn', () => {
    for (const date of ['2026-08-03', '2026-08-06', '2026-08-09', '2026-02-28'])
      for (const weekStartsOn of [0, 1, 2, 3, 4, 5, 6]) {
        expect(weekStartOfLocalDate(date, weekStartsOn)).toBe(
          weekStartOf(new Date(`${date}T12:00:00.000Z`), 'UTC', weekStartsOn)
        );
      }
  });
});

describe('DEFAULT_WEEK_STARTS_ON', () => {
  // Migration 075 defaults the column to 1 (Monday). This constant exists so
  // the ONE legitimate fallback — a code path with no household row in hand —
  // says so out loud instead of hardcoding a literal that silently disagrees
  // with the column if either ever moves. New US households are onboarded to
  // Sunday EXPLICITLY (§5 D-8); this is not that default.
  it('matches migration 075`s column default (Monday)', () => {
    expect(DEFAULT_WEEK_STARTS_ON).toBe(1);
  });
});

// §5 D-9: the app is pre-launch and every account is wiped before store
// release, so there are no grandfathered Monday-bucketed weeks to migrate.
// What replaces the migration-safety work is this invariant: a stored
// `timesheets.week_start` must be a FIXED POINT of its own household's
// week-start function. If it isn't, the row was bucketed under a different
// `week_starts_on` than the household now declares — exactly the state D-9
// says cannot exist, and exactly what a grandfathered row would look like.
describe('fresh-start invariant (§5 D-9): every week_start is a fixed point of its household`s week_starts_on', () => {
  /** The invariant itself, as any auditor of the rows would apply it. */
  const isConsistent = (weekStart: string, weekStartsOn: number): boolean =>
    weekStartOfLocalDate(weekStart, weekStartsOn) === weekStart;

  it('holds for a week bucketed under the household`s own week_starts_on', () => {
    // Every legal weekStartsOn, over a full calendar week of dates: bucketing
    // ANY date under a household's setting always yields a consistent row.
    for (const weekStartsOn of [0, 1, 2, 3, 4, 5, 6]) {
      for (const localDate of [
        '2026-08-02',
        '2026-08-03',
        '2026-08-04',
        '2026-08-05',
        '2026-08-06',
        '2026-08-07',
        '2026-08-08',
      ]) {
        expect(
          isConsistent(
            weekStartOfLocalDate(localDate, weekStartsOn),
            weekStartsOn
          )
        ).toBe(true);
      }
    }
  });

  it('REJECTS a Monday-bucketed week_start in a Sunday-start household — the shape a grandfathered row would have', () => {
    // 2026-08-03 is a Monday. A Sunday-start household can never legitimately
    // have written it; if one exists, it predates the wipe.
    expect(isConsistent('2026-08-03', SUNDAY)).toBe(false);
  });

  it('REJECTS a Sunday-bucketed week_start in a Monday-start household (the mirror image)', () => {
    expect(isConsistent('2026-08-02', MONDAY)).toBe(false);
  });

  it('accepts a week_start only under exactly ONE weekStartsOn — no row is ambiguous', () => {
    const weekStart = '2026-08-02'; // Sunday
    const consistentWith = [0, 1, 2, 3, 4, 5, 6].filter(weekStartsOn =>
      isConsistent(weekStart, weekStartsOn)
    );
    expect(consistentWith).toEqual([SUNDAY]);
  });
});
