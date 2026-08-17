/**
 * @module domains/timesheet/__tests__/week.test
 * Pure week math anchored on the HOUSEHOLD's own first day of the week.
 * `getWeekStartISO` takes an explicit IANA timezone AND an explicit
 * `week_starts_on` (both always the HOUSEHOLD's, never the device's and
 * never the per-user display preference) — see the two "timezone-dependent
 * week boundaries" / "household week_starts_on" blocks below, which pin the
 * exact bug classes this guards against (GOLDEN-FIXES #21, #25).
 */
import { describe, expect, it, spyOn } from 'bun:test';
import {
  addWeeks,
  DEFAULT_WEEK_STARTS_ON,
  formatDisplayDate,
  formatWeekRangeLabel,
  getWeekDates,
  getWeekStartISO,
  weeksBetween,
} from '../utils/week';

// The one sanctioned fallback for a code path with no household in hand.
// It must equal migration 075's column default, or such a path would quietly
// disagree with what the server stored for a household nobody has edited.
describe('DEFAULT_WEEK_STARTS_ON', () => {
  it('is Monday (1), matching migration 075’s column default', () => {
    expect(DEFAULT_WEEK_STARTS_ON).toBe(1);
    expect(
      getWeekStartISO(
        new Date('2026-08-05T12:00:00.000Z'),
        'UTC',
        DEFAULT_WEEK_STARTS_ON
      )
    ).toBe('2026-08-03');
  });
});

describe('getWeekStartISO — a Monday-start household (1)', () => {
  it('returns the same date when given a Monday', () => {
    // 2026-08-03 is a Monday.
    expect(
      getWeekStartISO(new Date('2026-08-03T09:00:00.000Z'), 'UTC', 1)
    ).toBe('2026-08-03');
  });

  it('rolls a mid-week date back to that week’s Monday', () => {
    // 2026-08-01 is a Saturday -> Monday of that week is 2026-07-27.
    expect(
      getWeekStartISO(new Date('2026-08-01T09:00:00.000Z'), 'UTC', 1)
    ).toBe('2026-07-27');
  });

  it('rolls a Sunday back to the Monday that started its week (not forward)', () => {
    // 2026-08-02 is a Sunday -> still the week starting 2026-07-27.
    expect(
      getWeekStartISO(new Date('2026-08-02T09:00:00.000Z'), 'UTC', 1)
    ).toBe('2026-07-27');
  });
});

describe('getWeekStartISO — timezone-dependent week boundaries', () => {
  it('resolves a different week for the SAME instant in two different household timezones', () => {
    // 2026-08-02T23:30:00Z is Sunday 23:30 in UTC — still the week starting
    // 2026-07-27. In Pacific/Auckland (UTC+12 in NZ winter, no DST in
    // August), the same instant is already ~11:30 Monday 2026-08-03 local —
    // a NEW week, whose Monday is 2026-08-03 itself. A device-local
    // implementation would give both households the same answer; the
    // household's own timezone must not agree here, because it isn't the
    // same civil day for each of them.
    const instant = new Date('2026-08-02T23:30:00.000Z');

    const utcWeekStart = getWeekStartISO(instant, 'UTC', 1);
    const aucklandWeekStart = getWeekStartISO(instant, 'Pacific/Auckland', 1);

    expect(utcWeekStart).toBe('2026-07-27');
    expect(aucklandWeekStart).toBe('2026-08-03');
    expect(aucklandWeekStart).not.toBe(utcWeekStart);
  });

  it('agrees across timezones when the instant is safely mid-day everywhere', () => {
    // Nothing timezone-exotic about a Wednesday noon UTC — every
    // reasonable household timezone still reads it as the same week.
    const instant = new Date('2026-07-29T12:00:00.000Z'); // Wednesday
    expect(getWeekStartISO(instant, 'UTC', 1)).toBe('2026-07-27');
    expect(getWeekStartISO(instant, 'Pacific/Auckland', 1)).toBe('2026-07-27');
    expect(getWeekStartISO(instant, 'America/Los_Angeles', 1)).toBe(
      '2026-07-27'
    );
  });
});

// 3-E1: the week's first day is the HOUSEHOLD's `week_starts_on`
// (0=Sunday..6=Saturday, migration 075), not a hardcoded Monday. A US
// household is Sunday-start by onboarding default (playbook §5 D-8), and a
// Saturday-start household is legal too — both must resolve their own week.
describe('getWeekStartISO — household week_starts_on', () => {
  it('resolves a Sunday-start household (0) to the Sunday, not the Monday', () => {
    // 2026-08-01 Sat, 2026-08-02 Sun, 2026-08-03 Mon.
    expect(
      getWeekStartISO(new Date('2026-08-01T09:00:00.000Z'), 'UTC', 0)
    ).toBe('2026-07-26');
    expect(
      getWeekStartISO(new Date('2026-08-02T09:00:00.000Z'), 'UTC', 0)
    ).toBe('2026-08-02');
    // The Monday that a Monday-start household would call a NEW week is
    // mid-week for a Sunday-start one — this is the whole bug 3-E1 fixes.
    expect(
      getWeekStartISO(new Date('2026-08-03T09:00:00.000Z'), 'UTC', 0)
    ).toBe('2026-08-02');
  });

  it('resolves a Saturday-start household (6) to the Saturday', () => {
    expect(
      getWeekStartISO(new Date('2026-08-01T09:00:00.000Z'), 'UTC', 6)
    ).toBe('2026-08-01');
    expect(
      getWeekStartISO(new Date('2026-08-03T09:00:00.000Z'), 'UTC', 6)
    ).toBe('2026-08-01');
    // Friday is the LAST day of a Saturday-start week.
    expect(
      getWeekStartISO(new Date('2026-07-31T09:00:00.000Z'), 'UTC', 6)
    ).toBe('2026-07-25');
  });

  it('every week_starts_on 0..6 returns a date whose own day-of-week IS that value', () => {
    const instant = new Date('2026-08-05T12:00:00.000Z'); // a Wednesday
    for (let weekStartsOn = 0; weekStartsOn < 7; weekStartsOn++) {
      const resolved = getWeekStartISO(instant, 'UTC', weekStartsOn);
      expect(new Date(`${resolved}T00:00:00.000Z`).getUTCDay()).toBe(
        weekStartsOn
      );
    }
  });
});

describe('getWeekStartISO — household week start AND household timezone together', () => {
  it('Saturday in UTC but already Sunday in Pacific/Auckland starts a new Sunday week there only', () => {
    // 2026-08-01T23:30Z is Sat 23:30 UTC; Auckland (UTC+12, no DST in
    // August) already reads Sun 2026-08-02 11:30. For a Sunday-start
    // household that is a NEW week in Auckland and the previous one in UTC.
    const instant = new Date('2026-08-01T23:30:00.000Z');
    expect(getWeekStartISO(instant, 'UTC', 0)).toBe('2026-07-26');
    expect(getWeekStartISO(instant, 'Pacific/Auckland', 0)).toBe('2026-08-02');
  });

  it('Sunday in UTC but still Saturday in America/Los_Angeles stays in the old Sunday week there', () => {
    // 2026-08-02T05:00Z is Sun 05:00 UTC; LA (PDT, UTC-7) still reads Sat
    // 2026-08-01 22:00 — the week that started Sunday 2026-07-26.
    const instant = new Date('2026-08-02T05:00:00.000Z');
    expect(getWeekStartISO(instant, 'UTC', 0)).toBe('2026-08-02');
    expect(getWeekStartISO(instant, 'America/Los_Angeles', 0)).toBe(
      '2026-07-26'
    );
  });

  // GOLDEN-FIXES #25: the same instant has two legal serialisations —
  // PostgREST's `+00:00` and JS's `.000Z`. A week resolved off one must
  // equal the week resolved off the other, at a boundary where a parsing
  // slip would show.
  it('resolves identically from a `+00:00` and a `.000Z` serialisation of the same instant', () => {
    const postgrest = new Date('2026-08-01T23:30:00+00:00');
    const javascript = new Date('2026-08-01T23:30:00.000Z');
    expect(postgrest.getTime()).toBe(javascript.getTime());
    for (const zone of ['UTC', 'Pacific/Auckland', 'America/Los_Angeles']) {
      for (const weekStartsOn of [0, 1, 6]) {
        expect(getWeekStartISO(postgrest, zone, weekStartsOn)).toBe(
          getWeekStartISO(javascript, zone, weekStartsOn)
        );
      }
    }
  });
});

// `addWeeks`/`getWeekDates`/`formatWeekRangeLabel` take an ALREADY-RESOLVED
// week start, so they carry no week-start assumption and deliberately gained
// no parameter in 3-E1. This pins that: hand them a Sunday or a Saturday
// anchor and they behave exactly as they do for a Monday.
describe('offset arithmetic is week-start agnostic', () => {
  it('getWeekDates walks 7 days forward from whatever anchor it is given', () => {
    expect(getWeekDates('2026-08-02')).toEqual([
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
    ]);
    expect(getWeekDates('2026-08-01')[0]).toBe('2026-08-01');
    expect(getWeekDates('2026-08-01')[6]).toBe('2026-08-07');
  });

  it('addWeeks / weeksBetween round-trip from a Sunday and a Saturday anchor', () => {
    expect(addWeeks('2026-08-02', 1)).toBe('2026-08-09');
    expect(addWeeks('2026-08-01', -1)).toBe('2026-07-25');
    for (const anchor of ['2026-08-01', '2026-08-02', '2026-08-03']) {
      for (const delta of [-4, -1, 0, 1, 4]) {
        expect(weeksBetween(anchor, addWeeks(anchor, delta))).toBe(delta);
      }
    }
  });

  it('formatWeekRangeLabel labels a Sunday-start week Sunday..Saturday', () => {
    expect(formatWeekRangeLabel(getWeekDates('2026-08-02'))).toBe(
      '2 Aug – 8 Aug'
    );
  });
});

describe('getWeekDates', () => {
  it('returns 7 consecutive ISO dates starting at the week start', () => {
    expect(getWeekDates('2026-07-27')).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });
});

describe('formatDisplayDate', () => {
  it('formats YYYY-MM-DD as "D MMM"', () => {
    expect(formatDisplayDate('2026-07-30')).toBe('30 Jul');
  });

  it('strips leading zero from single-digit days', () => {
    expect(formatDisplayDate('2026-08-03')).toBe('3 Aug');
  });
});

describe('formatWeekRangeLabel', () => {
  it('formats a week that spans two months as "D MMM – D MMM"', () => {
    expect(formatWeekRangeLabel(getWeekDates('2026-07-27'))).toBe(
      '27 Jul – 2 Aug'
    );
  });

  it('formats a week within one month', () => {
    expect(formatWeekRangeLabel(getWeekDates('2026-08-03'))).toBe(
      '3 Aug – 9 Aug'
    );
  });
});

// D15: week-navigation date math. `addWeeks` shifts a Monday-anchored ISO
// date by whole weeks, so `HoursScreen` can track "which week" as a small
// integer offset from the current week (0 = current, -1 = previous, ...)
// rather than juggling absolute dates against a moving "now".
describe('addWeeks', () => {
  it('adds one week forward', () => {
    expect(addWeeks('2026-08-03', 1)).toBe('2026-08-10');
  });

  it('subtracts one week (goes to the previous Monday)', () => {
    expect(addWeeks('2026-08-03', -1)).toBe('2026-07-27');
  });

  it('a zero delta returns the same date unchanged', () => {
    expect(addWeeks('2026-08-03', 0)).toBe('2026-08-03');
  });

  it('crosses a month boundary', () => {
    expect(addWeeks('2026-07-27', 1)).toBe('2026-08-03');
  });

  it('crosses a year boundary', () => {
    expect(addWeeks('2025-12-29', 1)).toBe('2026-01-05');
  });

  it('supports multi-week deltas, not just +/-1', () => {
    expect(addWeeks('2026-08-03', 4)).toBe('2026-08-31');
    expect(addWeeks('2026-08-03', -4)).toBe('2026-07-06');
  });

  // D15 nav must stay correct when a step crosses a household's DST
  // transition. British Summer Time starts 2026-03-29 (clocks 01:00->02:00),
  // inside the week that starts Monday 2026-03-23. `addWeeks` is pure
  // calendar-date arithmetic on the Y/M/D digits of an ALREADY-RESOLVED
  // Monday (see the module header) — it never re-derives a zoned instant
  // after the shift, so it can't drift the way "add a fixed 7*24h duration,
  // then re-read the zoned calendar date" would across a DST boundary. This
  // pins that: the week after the one containing the clock change still
  // starts on a real Monday, not a Sunday 23:00 / Monday 01:00 off-by-one.
  it('lands on the correct Monday for a week that crosses a household DST transition', () => {
    expect(addWeeks('2026-03-23', 1)).toBe('2026-03-30');
    expect(addWeeks('2026-03-30', -1)).toBe('2026-03-23');
  });
});

// Inverse of `addWeeks` — deep-link absolute Monday → Hours weekOffset.
describe('weeksBetween', () => {
  it('returns 0 for the same Monday', () => {
    expect(weeksBetween('2026-08-03', '2026-08-03')).toBe(0);
  });

  it('returns a negative offset when the target is earlier', () => {
    expect(weeksBetween('2026-08-03', '2026-07-13')).toBe(-3);
  });

  it('returns a positive offset when the target is later', () => {
    expect(weeksBetween('2026-07-13', '2026-08-03')).toBe(3);
  });

  it('is the inverse of addWeeks for whole-week deltas', () => {
    const from = '2026-08-03';
    for (const delta of [-4, -1, 0, 1, 4]) {
      expect(weeksBetween(from, addWeeks(from, delta))).toBe(delta);
    }
  });
});

// `Math.round` silently swallows a non-week-aligned delta — a caller that
// hands in a mid-week date gets a plausible-looking offset and no clue that
// its anchor was wrong. Dev-only warn: it must not throw and must not change
// the number, or every deep link that already works would start behaving
// differently in dev.
describe('weeksBetween — non-week-aligned anchors (__DEV__ guard)', () => {
  it('warns, without throwing or changing the value, when the delta is not whole weeks', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(weeksBetween('2026-08-03', '2026-08-06')).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('2026-08-06');
    } finally {
      warn.mockRestore();
    }
  });

  it('stays silent for a whole-week delta', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(weeksBetween('2026-08-03', '2026-07-13')).toBe(-3);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('getWeekStartISO — resolves correctly across the household DST transition itself', () => {
  it('resolves the new week the moment local time crosses into Monday, BST or not', () => {
    // 2026-03-29T23:30:00Z is 2026-03-30T00:30 in Europe/London — Monday
    // just after BST began (clocks went forward at 01:00 UTC that day) —
    // this is already the NEW week, not the one ending 2026-03-29.
    const instant = new Date('2026-03-29T23:30:00.000Z');
    expect(getWeekStartISO(instant, 'Europe/London', 1)).toBe('2026-03-30');
  });
});
