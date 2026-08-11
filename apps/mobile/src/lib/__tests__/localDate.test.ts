/**
 * @module lib/__tests__/localDate
 * `currentWeekRange` — the shifts calendar's week range, anchored on the
 * HOUSEHOLD's `week_starts_on` and resolved in the HOUSEHOLD's IANA zone
 * (never the device's either way), same bug class as GOLDEN-FIXES #21: this
 * used to resolve Monday off `now.getDay()` (the device's zone), so two
 * people in different zones could see DIFFERENT shifts for "this week" at
 * the same instant. Most cases below pass `1` (Monday) because that is the
 * column default they were written against; the Sunday-start case pins that
 * the anchor is genuinely a parameter. See `currentWeekRange`'s own header
 * comment for the mechanism it reuses (`domains/timesheet/utils/week.ts` +
 * `lib/wallClock.ts`).
 */
import { describe, expect, it } from 'bun:test';
import * as localDate from '../localDate';
import { currentWeekRange, utcIsoToWallClockHHMM } from '../wallClock';

describe('localDate exports', () => {
  it('does not export twoWeekRange (deleted — device-zone Monday trap)', () => {
    expect('twoWeekRange' in localDate).toBe(false);
  });
});

describe('currentWeekRange', () => {
  it('resolves [Monday 00:00, next Monday 00:00) as UTC instants in UTC', () => {
    // 2026-08-03 is a Monday.
    const now = new Date('2026-08-03T09:00:00.000Z');
    const { from, to } = currentWeekRange('UTC', 1, now);
    expect(from).toBe('2026-08-03T00:00:00.000Z');
    expect(to).toBe('2026-08-10T00:00:00.000Z');
  });

  it('rolls a mid-week instant back to that week’s Monday', () => {
    // 2026-08-05 (Wednesday) belongs to the week starting 2026-08-03.
    const now = new Date('2026-08-05T15:00:00.000Z');
    const { from } = currentWeekRange('UTC', 1, now);
    expect(from).toBe('2026-08-03T00:00:00.000Z');
  });

  it('resolves a DIFFERENT week for the SAME instant in a household AHEAD of UTC', () => {
    // 2026-08-02T23:30:00Z is Sunday 23:30 in UTC — still the week starting
    // 2026-07-27. In Pacific/Auckland (UTC+12 in NZ winter, no DST in
    // August) the same instant is already Monday morning local — a NEW
    // week, starting 2026-08-03.
    const instant = new Date('2026-08-02T23:30:00.000Z');
    const utc = currentWeekRange('UTC', 1, instant);
    const auckland = currentWeekRange('Pacific/Auckland', 1, instant);

    expect(utc.from).toBe('2026-07-27T00:00:00.000Z');
    expect(auckland.from).not.toBe(utc.from);
    // Round-trip `auckland.from` through the independently-tested
    // instant->wall-clock converter: it must read back as exactly
    // midnight in Auckland's own zone.
    expect(utcIsoToWallClockHHMM(auckland.from, 'Pacific/Auckland')).toBe(
      '00:00'
    );
  });

  it('resolves a DIFFERENT week for the SAME instant in a household BEHIND UTC', () => {
    // 2026-08-03T05:00:00Z is already Monday in UTC. America/Los_Angeles
    // (UTC-7, PDT in August) is still Sunday night — the PRIOR week hasn't
    // rolled over there yet.
    const instant = new Date('2026-08-03T05:00:00.000Z');
    const utc = currentWeekRange('UTC', 1, instant);
    const losAngeles = currentWeekRange('America/Los_Angeles', 1, instant);

    expect(utc.from).toBe('2026-08-03T00:00:00.000Z');
    expect(losAngeles.from).not.toBe(utc.from);
    expect(utcIsoToWallClockHHMM(losAngeles.from, 'America/Los_Angeles')).toBe(
      '00:00'
    );
  });

  it('anchors on the household week_starts_on, not a hardcoded Monday', () => {
    // Monday 2026-08-03 09:00 UTC. A Monday-start household is on day one
    // of its week; a Sunday-start household is already on day two, so its
    // range opened the day before and closes a day earlier.
    const now = new Date('2026-08-03T09:00:00.000Z');
    const monday = currentWeekRange('UTC', 1, now);
    const sunday = currentWeekRange('UTC', 0, now);

    expect(monday.from).toBe('2026-08-03T00:00:00.000Z');
    expect(sunday.from).toBe('2026-08-02T00:00:00.000Z');
    expect(sunday.to).toBe('2026-08-09T00:00:00.000Z');
  });

  it('is DST-safe across a household timezone transition (Europe/London, BST start)', () => {
    // British Summer Time starts 2026-03-29 at 01:00 UTC (clocks 01:00 ->
    // 02:00), inside the week that starts Monday 2026-03-23. The week
    // AFTER that one starts Monday 2026-03-30 — already BST — so its
    // local-midnight UTC instant must reflect the UTC+1 offset, not UTC+0.
    const duringDstWeek = new Date('2026-03-30T12:00:00.000Z');
    const { from } = currentWeekRange('Europe/London', 1, duringDstWeek);

    expect(utcIsoToWallClockHHMM(from, 'Europe/London')).toBe('00:00');
    // BST is UTC+1, so local midnight 2026-03-30 is 2026-03-29T23:00:00Z,
    // NOT 2026-03-30T00:00:00Z (which is what a DST-naive implementation —
    // fixed 7*24h offset from the winter Monday — would have produced).
    expect(from).toBe('2026-03-29T23:00:00.000Z');
  });
});
