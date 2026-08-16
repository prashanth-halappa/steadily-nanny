/**
 * @module domains/timesheet/__tests__/weekClosed.test
 *
 * The nanny has no submit act by design, so her week needs a closing beat
 * once the last scheduled shift has finished and she has hours on the clock.
 * `WeekTotal`'s appreciation block owns the approved state — this predicate
 * must stay out of that lane.
 */
import { describe, expect, it } from 'bun:test';
import {
  type WeekClosedReceiptInput,
  type WeekClosedShift,
  weekClosedReceipt,
} from '../utils/weekClosed';

const CARER_ID = 'carer-amara';
const OTHER_CARER_ID = 'carer-bea';
const WEEK_DATES = [
  '2026-08-03',
  '2026-08-04',
  '2026-08-05',
  '2026-08-06',
  '2026-08-07',
  '2026-08-08',
  '2026-08-09',
];
/** Sunday after her last shift has finished — still this week in UTC. */
const WEEK_CLOSED_NOW_MS = Date.parse('2026-08-09T18:00:00.000Z');

function shift(overrides: Partial<WeekClosedShift> = {}): WeekClosedShift {
  return {
    carer_id: CARER_ID,
    kind: 'recurring',
    status: 'confirmed',
    ends_at: '2026-08-09T16:00:00.000Z',
    ...overrides,
  };
}

function input(
  overrides: Partial<WeekClosedReceiptInput> = {}
): WeekClosedReceiptInput {
  return {
    shifts: [shift()],
    carerId: CARER_ID,
    nowMs: WEEK_CLOSED_NOW_MS,
    totalMinutes: 480,
    status: 'submitted',
    weekDates: WEEK_DATES,
    timeZone: 'UTC',
    ...overrides,
  };
}

describe('weekClosedReceipt', () => {
  it('is true once her last confirmed shift of the week has ended and she has hours', () => {
    expect(weekClosedReceipt(input())).toBe(true);
  });

  it('is false while a shift is still ahead of now', () => {
    expect(
      weekClosedReceipt(
        input({ nowMs: Date.parse('2026-08-09T12:00:00.000Z') })
      )
    ).toBe(false);
  });

  it('is false when she logged no minutes', () => {
    expect(weekClosedReceipt(input({ totalMinutes: 0 }))).toBe(false);
  });

  it('is false when the week is already approved', () => {
    expect(weekClosedReceipt(input({ status: 'approved' }))).toBe(false);
  });

  it('is false for a week that is not the current week', () => {
    expect(
      weekClosedReceipt(
        input({ nowMs: Date.parse('2026-08-16T18:00:00.000Z') })
      )
    ).toBe(false);
  });

  it('ignores shifts belonging to another carer', () => {
    expect(
      weekClosedReceipt(
        input({
          shifts: [
            shift(),
            shift({
              carer_id: OTHER_CARER_ID,
              ends_at: '2026-08-09T22:00:00.000Z',
            }),
          ],
        })
      )
    ).toBe(true);
  });

  it('ignores parent_cover shifts', () => {
    expect(
      weekClosedReceipt(
        input({
          shifts: [
            shift(),
            shift({
              kind: 'parent_cover',
              carer_id: null,
              ends_at: '2026-08-09T22:00:00.000Z',
            }),
          ],
        })
      )
    ).toBe(true);
  });

  it('ignores cancelled and declined shifts', () => {
    expect(
      weekClosedReceipt(
        input({
          shifts: [
            shift(),
            shift({
              status: 'cancelled',
              ends_at: '2026-08-09T22:00:00.000Z',
            }),
            shift({
              status: 'declined',
              ends_at: '2026-08-09T22:00:00.000Z',
            }),
          ],
        })
      )
    ).toBe(true);
  });

  it('is false when the week has no shifts at all', () => {
    expect(weekClosedReceipt(input({ shifts: [] }))).toBe(false);
  });
});
