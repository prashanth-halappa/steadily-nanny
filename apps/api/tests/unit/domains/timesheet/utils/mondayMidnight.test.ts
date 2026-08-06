/**
 * The week boundary as a real INSTANT. `weekStartOf` answers "which week",
 * which is a calendar question; splitting a Sun->Mon session needs the exact
 * moment the week turns over in the household's own zone, and that moment
 * moves with the offset. Get it wrong by an hour and an hour of pay lands in
 * the wrong week's timesheet.
 */
import { describe, expect, it } from 'bun:test';
import { mondayMidnightInstant } from '../../../../../src/domains/timesheet/utils/mondayMidnight';

describe('mondayMidnightInstant', () => {
  it('is plain midnight UTC for a UTC household', () => {
    expect(
      mondayMidnightInstant(
        new Date('2026-01-11T23:00:00.000Z'),
        'UTC'
      ).toISOString()
    ).toBe('2026-01-12T00:00:00.000Z');
  });

  it('London in GMT: the boundary is midnight UTC', () => {
    expect(
      mondayMidnightInstant(
        new Date('2026-01-11T23:00:00.000Z'),
        'Europe/London'
      ).toISOString()
    ).toBe('2026-01-12T00:00:00.000Z');
  });

  it('London in BST: the boundary is 23:00Z on the Sunday', () => {
    // Sun 2026-08-09 22:00Z is 23:00 local, still Sunday. Local Monday
    // midnight is an hour later, i.e. 23:00Z — an hour EARLIER than the naive
    // UTC-midnight answer, which would file the first hour of Monday into
    // Sunday's week.
    expect(
      mondayMidnightInstant(
        new Date('2026-08-09T22:00:00.000Z'),
        'Europe/London'
      ).toISOString()
    ).toBe('2026-08-09T23:00:00.000Z');
  });

  it('handles a zone WEST of UTC (New York, EDT)', () => {
    expect(
      mondayMidnightInstant(
        new Date('2026-08-10T02:00:00.000Z'), // Sun 22:00 local
        'America/New_York'
      ).toISOString()
    ).toBe('2026-08-10T04:00:00.000Z');
  });

  it('handles a sub-hour offset (Kolkata, +05:30)', () => {
    expect(
      mondayMidnightInstant(
        new Date('2026-08-09T17:00:00.000Z'), // Sun 22:30 local
        'Asia/Kolkata'
      ).toISOString()
    ).toBe('2026-08-09T18:30:00.000Z');
  });

  it('handles a quarter-hour offset (Chatham, +12:45/+13:45)', () => {
    // Sun 2026-08-09 10:00Z is Sun 22:45 local (NZ winter, +12:45).
    expect(
      mondayMidnightInstant(
        new Date('2026-08-09T10:00:00.000Z'),
        'Pacific/Chatham'
      ).toISOString()
    ).toBe('2026-08-09T11:15:00.000Z');
  });

  it('takes the END of the week the instant is in, not the next seven days', () => {
    // A Monday-morning instant still belongs to the week that STARTED that
    // Monday, so the boundary is the FOLLOWING Monday.
    expect(
      mondayMidnightInstant(
        new Date('2026-01-05T10:00:00.000Z'),
        'Europe/London'
      ).toISOString()
    ).toBe('2026-01-12T00:00:00.000Z');
  });

  it('lands on a local midnight across the spring-forward week (BST starts 2026-03-29)', () => {
    // The clocks go forward on the Sunday INSIDE the week, not at its Monday
    // boundary — so the boundary is BST-side midnight, 23:00Z on the Sunday.
    expect(
      mondayMidnightInstant(
        new Date('2026-03-29T12:00:00.000Z'),
        'Europe/London'
      ).toISOString()
    ).toBe('2026-03-29T23:00:00.000Z');
  });

  it('lands on a local midnight across the autumn fall-back week (GMT returns 2026-10-25)', () => {
    expect(
      mondayMidnightInstant(
        new Date('2026-10-25T12:00:00.000Z'),
        'Europe/London'
      ).toISOString()
    ).toBe('2026-10-26T00:00:00.000Z');
  });
});
