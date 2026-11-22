/** The JS replacements for the sync_*_local_date Postgres triggers. */
import { describe, expect, test } from 'bun:test';
import { shiftLocalDate, timeEntryLocalDate } from '../../../src/db/localDate';

describe('shiftLocalDate', () => {
  test('Europe/London either side of the spring-forward boundary (2026-03-29 01:00Z)', () => {
    expect(shiftLocalDate('2026-03-28T23:30:00.000Z', 'Europe/London')).toBe(
      '2026-03-28'
    ); // GMT
    expect(shiftLocalDate('2026-03-29T23:30:00.000Z', 'Europe/London')).toBe(
      '2026-03-30'
    ); // BST: 00:30 next day
  });

  test('Europe/London across fall-back (2026-10-25 01:00Z)', () => {
    expect(shiftLocalDate('2026-10-24T23:30:00.000Z', 'Europe/London')).toBe(
      '2026-10-25'
    ); // BST
    expect(shiftLocalDate('2026-10-25T23:30:00.000Z', 'Europe/London')).toBe(
      '2026-10-25'
    ); // GMT
  });

  test('non-UTC zones west and east', () => {
    expect(
      shiftLocalDate('2026-03-03T05:00:00.000Z', 'America/Los_Angeles')
    ).toBe('2026-03-02');
    expect(
      shiftLocalDate(new Date('2026-03-02T16:00:00.000Z'), 'Asia/Tokyo')
    ).toBe('2026-03-03');
  });
});

describe('timeEntryLocalDate', () => {
  test('coalesces clock_in_at, then clock_out_at, then now', () => {
    const tz = 'America/New_York';
    expect(
      timeEntryLocalDate(
        {
          clock_in_at: '2026-03-03T03:00:00.000Z',
          clock_out_at: '2026-03-03T15:00:00.000Z',
        },
        tz
      )
    ).toBe('2026-03-02');
    expect(
      timeEntryLocalDate(
        { clock_in_at: null, clock_out_at: '2026-03-03T15:00:00.000Z' },
        tz
      )
    ).toBe('2026-03-03');
    expect(
      timeEntryLocalDate({}, tz, new Date('2026-07-01T02:00:00.000Z'))
    ).toBe('2026-06-30');
  });
});
