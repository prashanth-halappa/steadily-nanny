import { describe, expect, it } from 'bun:test';
import {
  isSnapshotStale,
  resolveCoverRow,
  shouldShowAsOf,
  showChildrenLine,
  snapshotAgeMs,
  visibleCoverRows,
  visibleNextShiftRows,
} from '../render';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const MIN = 60 * 1000;

function isoMinutesAgo(minutes: number): string {
  return new Date(NOW - minutes * MIN).toISOString();
}

describe('snapshotAgeMs', () => {
  it('is zero for a snapshot generated right now', () => {
    expect(snapshotAgeMs(new Date(NOW).toISOString(), NOW)).toBe(0);
  });

  it('never goes negative for a snapshot from the future (clock skew)', () => {
    expect(snapshotAgeMs(isoMinutesAgo(-5), NOW)).toBe(0);
  });
});

describe('isSnapshotStale', () => {
  it('is fresh at 44 minutes', () => {
    expect(isSnapshotStale(isoMinutesAgo(44), NOW)).toBe(false);
  });

  it('is stale past 45 minutes', () => {
    expect(isSnapshotStale(isoMinutesAgo(46), NOW)).toBe(true);
  });
});

describe('shouldShowAsOf', () => {
  it('is hidden at 1 hour', () => {
    expect(shouldShowAsOf(isoMinutesAgo(60), NOW)).toBe(false);
  });

  it('shows past 2 hours', () => {
    expect(shouldShowAsOf(isoMinutesAgo(121), NOW)).toBe(true);
  });
});

describe('resolveCoverRow', () => {
  const row = {
    key: 'sarah',
    kind: 'live' as const,
    title: 'Sarah is with Mia & Jonah',
    detail: 'On the clock since 08:12',
    staleTitle: 'Sarah · due 08:00–17:00',
    staleDetail: null,
    isLiveDot: true,
  };

  it('shows the fresh claim with its dot when not stale', () => {
    expect(resolveCoverRow(row, false)).toEqual({
      title: 'Sarah is with Mia & Jonah',
      detail: 'On the clock since 08:12',
      showDot: true,
    });
  });

  it('degrades to schedule truth with no dot when stale', () => {
    expect(resolveCoverRow(row, true)).toEqual({
      title: 'Sarah · due 08:00–17:00',
      detail: null,
      showDot: false,
    });
  });
});

describe('showChildrenLine', () => {
  it('never shows on accessory (lock screen) families', () => {
    expect(showChildrenLine('accessoryRectangular', false)).toBe(false);
    expect(showChildrenLine('accessoryInline', false)).toBe(false);
  });

  it('always shows on systemMedium, pending or not', () => {
    expect(showChildrenLine('systemMedium', true)).toBe(true);
    expect(showChildrenLine('systemMedium', false)).toBe(true);
  });

  it('drops on systemSmall only when a pending banner is competing for space', () => {
    expect(showChildrenLine('systemSmall', false)).toBe(true);
    expect(showChildrenLine('systemSmall', true)).toBe(false);
  });
});

describe('visibleNextShiftRows', () => {
  const rows = [
    {
      dayLabel: 'Today',
      timeRange: '08:00–17:00',
      householdName: 'Patel',
      childrenLine: null,
    },
    {
      dayLabel: 'Tomorrow',
      timeRange: '09:00–18:00',
      householdName: 'Lee',
      childrenLine: null,
    },
  ];

  it('renders only the first row on systemSmall', () => {
    expect(visibleNextShiftRows(rows, 'systemSmall')).toEqual([rows[0]!]);
  });

  it('renders both rows on systemMedium', () => {
    expect(visibleNextShiftRows(rows, 'systemMedium')).toEqual(rows);
  });

  it('renders only the first row on accessory families', () => {
    expect(visibleNextShiftRows(rows, 'accessoryRectangular')).toEqual([
      rows[0]!,
    ]);
  });
});

describe('visibleCoverRows', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    key: `row-${i}`,
    kind: 'scheduled' as const,
    title: `Row ${i}`,
    detail: null,
    staleTitle: `Row ${i}`,
    staleDetail: null,
    isLiveDot: false,
  }));

  it('caps at the top row on systemSmall', () => {
    expect(visibleCoverRows(rows, 'systemSmall')).toEqual([rows[0]!]);
  });

  it('caps at 4 rows on systemMedium', () => {
    expect(visibleCoverRows(rows, 'systemMedium')).toEqual(rows.slice(0, 4));
  });
});
