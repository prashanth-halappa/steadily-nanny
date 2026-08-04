/**
 * @module domains/schedule/__tests__/WeekRibbonView.test
 *
 * The occupancy rule the week ribbon paints its cells with. The predicate
 * itself is a pure function in `../utils/shiftGrouping`, so it is tested for
 * real here (not by source inspection) — the component around it is only
 * checked for wiring, Pattern B style, because it renders nothing testable
 * without a host.
 *
 * The bug this file exists for: `hour >= startH && hour < endH` on bare
 * hour-of-day integers dropped every OVERNIGHT shift (19:00–00:30 has
 * `endH === 0`, and no hour is `< 0`) and every SUB-HOUR shift
 * (09:15–09:45 has `startH === endH === 9`, and `9 < 9` is false) — both
 * rendered as complete absence.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { hourCellOccupied, minutesInZone } from '../utils/shiftGrouping';

const viewPath = join(__dirname, '../components/WeekRibbonView.tsx');
let viewSource: string;

beforeAll(async () => {
  viewSource = await Bun.file(viewPath).text();
});

/** HH:MM -> minutes since midnight, so the cases below read like the UI. */
const at = (hhmm: string): number => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

const occupiedHours = (start: string, end: string): number[] =>
  Array.from({ length: 24 }, (_, hour) => hour).filter(hour =>
    hourCellOccupied(at(start), at(end), hour)
  );

describe('hourCellOccupied', () => {
  it('covers a plain daytime shift, half-open at the end', () => {
    expect(occupiedHours('09:00', '17:00')).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it('REGRESSION: an overnight shift lights its pre-midnight hours', () => {
    // 19:00–00:30 — `endH === 0` made the old test false for every hour.
    expect(occupiedHours('19:00', '00:30')).toEqual([0, 19, 20, 21, 22, 23]);
    expect(hourCellOccupied(at('19:00'), at('00:30'), 19)).toBe(true);
    expect(hourCellOccupied(at('19:00'), at('00:30'), 23)).toBe(true);
    // ...and nothing in the middle of the day.
    expect(hourCellOccupied(at('19:00'), at('00:30'), 12)).toBe(false);
    expect(hourCellOccupied(at('19:00'), at('00:30'), 18)).toBe(false);
  });

  it('REGRESSION: a sub-hour shift lights the hour it falls inside', () => {
    // 09:15–09:45 — `startH === endH` made the old test false everywhere.
    expect(occupiedHours('09:15', '09:45')).toEqual([9]);
  });

  it('lights both hours a shift straddling an hour boundary touches', () => {
    expect(occupiedHours('09:45', '10:15')).toEqual([9, 10]);
  });

  it('does not light the hour a shift ends exactly on', () => {
    expect(hourCellOccupied(at('09:00'), at('17:00'), 17)).toBe(false);
    expect(hourCellOccupied(at('09:00'), at('10:00'), 10)).toBe(false);
  });

  it('treats an end equal to the start as spanning to the next day', () => {
    // Same convention ShiftDetailScreen uses when it builds the instants.
    expect(occupiedHours('22:00', '22:00')).toHaveLength(24);
  });
});

describe('minutesInZone', () => {
  it('returns minutes since midnight in the given zone', () => {
    // 2026-08-03T08:30Z is 09:30 London (BST).
    expect(minutesInZone('2026-08-03T08:30:00.000Z', 'Europe/London')).toBe(
      9 * 60 + 30
    );
  });

  it('normalises midnight to 0, never 1440', () => {
    expect(minutesInZone('2026-08-03T23:00:00.000Z', 'Europe/London')).toBe(0);
  });

  it('keeps minute precision (never truncates to the hour)', () => {
    expect(minutesInZone('2026-01-07T09:45:00.000Z', 'Europe/London')).toBe(
      9 * 60 + 45
    );
  });
});

describe('WeekRibbonView source', () => {
  it('delegates the occupancy rule to the pure helpers instead of comparing bare hours', () => {
    expect(viewSource).toContain('hourCellOccupied(');
    expect(viewSource).toContain('minutesInZone(');
    expect(viewSource).not.toContain('hour >= startH');
    expect(viewSource).not.toContain('shiftHourInZone');
  });

  it('keeps its grid testIDs', () => {
    expect(viewSource).toContain('testID="calendar-week-ribbon-view"');
    expect(viewSource).toContain('testID={`week-ribbon-cell-${dow}-${hour}`}');
  });

  it('makes occupied cells tappable to shift detail', () => {
    expect(viewSource).toContain('Pressable');
    expect(viewSource).toContain('week-ribbon-press');
    expect(viewSource).toContain('/(private)/schedule/shifts/${shift.id}');
  });

  it('REGRESSION: the header row uses short weekday names, not the full ones that wrap mid-word ("Monda / y") at this column width', () => {
    expect(viewSource).toContain('weekdayShort.${dow}');
    expect(viewSource).not.toContain('{t(`weekday.${dow}`)}');
  });

  it('REGRESSION: sizes scroll bottom padding off the tab bar height, not a static magic number (BUG1)', () => {
    // This is one of the Schedule tab's own scrollable content views (Week
    // calendar), so it needs the same tap-through dead-zone fix as
    // Settings/Today/Hours.
    expect(viewSource).toContain('useTabBarScrollPadding');
    expect(viewSource).toContain('paddingBottom: tabBarScrollPadding');
  });

  // The away band is covered for real in `WeekRibbonView.render.test.tsx` —
  // a source grep cannot tell a rendered band from an unreachable one.
});
