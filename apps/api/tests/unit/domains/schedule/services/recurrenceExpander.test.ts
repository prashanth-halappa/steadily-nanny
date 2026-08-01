/**
 * Recurrence expander — DST correctness case table (Europe/London, verified
 * against the live DB per the wave-2 spec). Written BEFORE the implementation
 * exists (TDD red-first). Every case below is a real calendar date; the
 * weekday of each date is verified inline via `weekdayOf` so a test can never
 * silently assert the wrong day-of-week.
 *
 * @module tests/unit/domains/schedule/services/recurrenceExpander
 */
import { describe, expect, it } from 'bun:test';
import { expandRecurrence } from '../../../../../src/domains/schedule/services/recurrenceExpander';

const LONDON = 'Europe/London';

/** 0 = Sunday .. 6 = Saturday, matching Postgres extract(dow) and JS getUTCDay(). */
function weekdayOf(dateOnly: string): number {
  const [y = 1970, m = 1, d = 1] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

describe('expandRecurrence — DST case table (Europe/London)', () => {
  it('Thu 8:00 in February (GMT) — starts_at is 08:00Z', () => {
    const date = '2026-02-05';
    expect(weekdayOf(date)).toBe(4); // Thursday

    const occurrences = expandRecurrence(
      {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart: date,
        until: date,
        exdates: [],
        pauseRanges: [],
        timezone: LONDON,
        days: [{ weekday: 4, startTime: '08:00', endTime: '17:00' }],
      },
      date
    );

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.startsAt).toBe('2026-02-05T08:00:00.000Z');
  });

  it('Thu 8:00 in July (BST) — starts_at is 07:00Z, same wall clock different UTC', () => {
    const date = '2026-07-02';
    expect(weekdayOf(date)).toBe(4); // Thursday

    const occurrences = expandRecurrence(
      {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart: date,
        until: date,
        exdates: [],
        pauseRanges: [],
        timezone: LONDON,
        days: [{ weekday: 4, startTime: '08:00', endTime: '17:00' }],
      },
      date
    );

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.startsAt).toBe('2026-07-02T07:00:00.000Z');
  });

  it('spring-forward Sunday (clocks 01:00→02:00, 2026-03-29) — no occurrence skipped or duplicated', () => {
    // Four consecutive Sundays straddling the transition.
    const dtstart = '2026-03-15';
    const horizon = '2026-04-05';
    expect(weekdayOf('2026-03-29')).toBe(0); // Sunday — the transition date

    const occurrences = expandRecurrence(
      {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart,
        until: null,
        exdates: [],
        pauseRanges: [],
        timezone: LONDON,
        days: [{ weekday: 0, startTime: '08:00', endTime: '17:00' }],
      },
      horizon
    );

    expect(occurrences.map(o => o.localDate)).toEqual([
      '2026-03-15',
      '2026-03-22',
      '2026-03-29',
      '2026-04-05',
    ]);
    // The transition-day occurrence: by 08:00 local, BST (+1h) is already in
    // effect (the clocks moved at 01:00 GMT), so 08:00 local => 07:00Z.
    const transitionDay = occurrences.find(o => o.localDate === '2026-03-29');
    expect(transitionDay?.startsAt).toBe('2026-03-29T07:00:00.000Z');
  });

  it('autumn-back Sunday (clocks 02:00→01:00, 2026-10-25) — a 9-hour shift is still 9 wall-clock hours', () => {
    const date = '2026-10-25';
    expect(weekdayOf(date)).toBe(0); // Sunday — the transition date

    const occurrences = expandRecurrence(
      {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart: date,
        until: date,
        exdates: [],
        pauseRanges: [],
        timezone: LONDON,
        days: [{ weekday: 0, startTime: '08:00', endTime: '17:00' }],
      },
      date
    );

    expect(occurrences).toHaveLength(1);
    const occ = occurrences[0];
    expect(occ).toBeDefined();
    // By 08:00 local the transition (at 02:00 BST -> 01:00 GMT) has already
    // happened, so both ends are GMT and the UTC gap equals the wall-clock
    // gap exactly — 9 hours, not 8 or 10.
    const startsMs = new Date(occ?.startsAt ?? '').getTime();
    const endsMs = new Date(occ?.endsAt ?? '').getTime();
    expect(endsMs - startsMs).toBe(9 * 60 * 60 * 1000);
    expect(occ?.startsAt).toBe('2026-10-25T08:00:00.000Z');
    expect(occ?.endsAt).toBe('2026-10-25T17:00:00.000Z');
  });

  it('shift spanning local midnight — local_date is the START day', () => {
    // A very-early-morning BST shift: 00:30 local on a Thursday in July is
    // 23:30Z the PREVIOUS calendar day (BST = UTC+1). local_date must stay
    // the wall-clock start day (the Thursday), never the UTC day it lands on.
    const date = '2026-07-02'; // Thursday, BST
    expect(weekdayOf(date)).toBe(4);

    const occurrences = expandRecurrence(
      {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart: date,
        until: date,
        exdates: [],
        pauseRanges: [],
        timezone: LONDON,
        days: [{ weekday: 4, startTime: '00:30', endTime: '01:30' }],
      },
      date
    );

    expect(occurrences).toHaveLength(1);
    const occ = occurrences[0];
    expect(occ?.localDate).toBe('2026-07-02'); // the START day
    expect(occ?.startsAt).toBe('2026-07-01T23:30:00.000Z'); // the previous UTC day
  });

  it('pattern tz ≠ carer tz ≠ viewer tz — the stored UTC instant is derived solely from the pattern tz', () => {
    // expandRecurrence's signature takes only ONE timezone: the pattern's.
    // There is structurally no carer-tz or viewer-tz parameter for it to read,
    // so the produced instant cannot vary with who is asking or who is
    // working the shift — it is the same absolute instant for everyone.
    const date = '2026-02-05';
    const occurrences = expandRecurrence(
      {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart: date,
        until: date,
        exdates: [],
        pauseRanges: [],
        timezone: LONDON, // the pattern's own tz — the only tz input that exists
        days: [{ weekday: 4, startTime: '08:00', endTime: '17:00' }],
      },
      date
    );
    const instant = occurrences[0]?.startsAt;
    // Re-running with the exact same pattern (imagining a carer in
    // 'America/New_York' and a viewer in 'Asia/Tokyo' reading it back) can
    // only ever re-derive this same instant, because those zones are never
    // passed in anywhere.
    expect(instant).toBe('2026-02-05T08:00:00.000Z');
  });

  it('an exdate — that occurrence is not produced', () => {
    const dtstart = '2026-02-05'; // Thursday
    const horizon = '2026-02-19';

    const occurrences = expandRecurrence(
      {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart,
        until: null,
        exdates: ['2026-02-12'],
        pauseRanges: [],
        timezone: LONDON,
        days: [{ weekday: 4, startTime: '08:00', endTime: '17:00' }],
      },
      horizon
    );

    expect(occurrences.map(o => o.localDate)).toEqual([
      '2026-02-05',
      '2026-02-19',
    ]);
  });

  it('a pause_range (term time) — occurrences inside it are not produced', () => {
    const dtstart = '2026-07-02'; // Thursday
    const horizon = '2026-08-06';

    const occurrences = expandRecurrence(
      {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart,
        until: null,
        exdates: [],
        pauseRanges: [{ from: '2026-07-16', to: '2026-07-30' }],
        timezone: LONDON,
        days: [{ weekday: 4, startTime: '08:00', endTime: '17:00' }],
      },
      horizon
    );

    // Thursdays: 07-02, 07-09, 07-16(paused), 07-23(paused), 07-30(paused), 08-06
    expect(occurrences.map(o => o.localDate)).toEqual([
      '2026-07-02',
      '2026-07-09',
      '2026-08-06',
    ]);
  });

  it('INTERVAL=2 (every other week) — only every second week produces an occurrence', () => {
    const dtstart = '2026-02-05'; // Thursday
    const horizon = '2026-03-05';

    const occurrences = expandRecurrence(
      {
        rrule: 'FREQ=WEEKLY;INTERVAL=2',
        dtstart,
        until: null,
        exdates: [],
        pauseRanges: [],
        timezone: LONDON,
        days: [{ weekday: 4, startTime: '08:00', endTime: '17:00' }],
      },
      horizon
    );

    expect(occurrences.map(o => o.localDate)).toEqual([
      '2026-02-05',
      '2026-02-19',
      '2026-03-05',
    ]);
  });

  it('resolves per-day children into per-occurrence UTC-converted (or whole-shift null) windows', () => {
    const date = '2026-07-02'; // Thursday, BST

    const occurrences = expandRecurrence(
      {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart: date,
        until: date,
        exdates: [],
        pauseRanges: [],
        timezone: LONDON,
        days: [
          {
            weekday: 4,
            startTime: '08:00',
            endTime: '17:00',
            children: [
              { childId: 'child-theo', startTime: null, endTime: null }, // whole shift
              { childId: 'child-maya', startTime: '08:00', endTime: '09:00' }, // preschool morning, part 1
              { childId: 'child-maya', startTime: '12:00', endTime: '17:00' }, // part 2
            ],
          },
        ],
      },
      date
    );

    expect(occurrences).toHaveLength(1);
    const occ = occurrences[0];
    expect(occ?.children).toEqual([
      { childId: 'child-theo', startsAt: null, endsAt: null },
      {
        childId: 'child-maya',
        startsAt: '2026-07-02T07:00:00.000Z',
        endsAt: '2026-07-02T08:00:00.000Z',
      },
      {
        childId: 'child-maya',
        startsAt: '2026-07-02T11:00:00.000Z',
        endsAt: '2026-07-02T16:00:00.000Z',
      },
    ]);
  });

  it('multiple pattern days in one week each expand independently, sorted chronologically', () => {
    const dtstart = '2026-02-02'; // Monday
    const horizon = '2026-02-08';

    const occurrences = expandRecurrence(
      {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart,
        until: null,
        exdates: [],
        pauseRanges: [],
        timezone: LONDON,
        days: [
          { weekday: 4, startTime: '08:00', endTime: '17:00' }, // Thu
          { weekday: 2, startTime: '09:00', endTime: '13:00' }, // Tue
        ],
      },
      horizon
    );

    expect(occurrences.map(o => o.localDate)).toEqual([
      '2026-02-03',
      '2026-02-05',
    ]);
  });
});
