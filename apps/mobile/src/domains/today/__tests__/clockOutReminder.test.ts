/**
 * Daylight UX #7 — when a running entry becomes suspect, and what finish to
 * offer when it does. Pure logic, so no timers are faked here: `nowMs` is an
 * argument.
 */
import { describe, expect, it } from 'bun:test';
import {
  isOverdue,
  MAX_UNSCHEDULED_SHIFT_MS,
  resolveDefaultClockOutAt,
  resolveOverdueAtMs,
  SCHEDULED_FINISH_GRACE_MS,
} from '../utils/clockOutReminder';

const CLOCK_IN = '2026-08-03T08:00:00.000Z';
const CLOCK_IN_MS = Date.parse(CLOCK_IN);
const SHIFT_END = '2026-08-03T16:00:00.000Z';
const SHIFT_END_MS = Date.parse(SHIFT_END);

describe('resolveOverdueAtMs', () => {
  it('uses the scheduled finish plus grace when a shift was matched', () => {
    expect(resolveOverdueAtMs(CLOCK_IN, SHIFT_END)).toBe(
      SHIFT_END_MS + SCHEDULED_FINISH_GRACE_MS
    );
  });

  it('falls back to the flat backstop for an unscheduled clock-in', () => {
    expect(resolveOverdueAtMs(CLOCK_IN, null)).toBe(
      CLOCK_IN_MS + MAX_UNSCHEDULED_SHIFT_MS
    );
  });

  it('ignores a shift that ended before the clock-in — the 2h auto-match window can attach one', () => {
    expect(resolveOverdueAtMs(CLOCK_IN, '2026-08-03T07:00:00.000Z')).toBe(
      CLOCK_IN_MS + MAX_UNSCHEDULED_SHIFT_MS
    );
  });

  it('never lets a mis-matched long shift push the threshold past the backstop', () => {
    // A 20-hour shift: finish + grace would be well beyond the backstop.
    expect(resolveOverdueAtMs(CLOCK_IN, '2026-08-04T04:00:00.000Z')).toBe(
      CLOCK_IN_MS + MAX_UNSCHEDULED_SHIFT_MS
    );
  });
});

describe('isOverdue', () => {
  it('is false inside the grace after the scheduled finish', () => {
    expect(isOverdue(CLOCK_IN, SHIFT_END, SHIFT_END_MS + 60_000)).toBe(false);
  });

  it('is true once the grace has passed', () => {
    expect(
      isOverdue(CLOCK_IN, SHIFT_END, SHIFT_END_MS + SCHEDULED_FINISH_GRACE_MS)
    ).toBe(true);
  });
});

describe('resolveDefaultClockOutAt', () => {
  it('offers "now" for an ordinary clock-out — the record is what happened, not what was planned', () => {
    // 40 minutes past the scheduled finish, still inside the grace: a carer
    // who stayed late must not have that quietly rewritten.
    const nowMs = SHIFT_END_MS + 20 * 60 * 1000;
    expect(resolveDefaultClockOutAt(CLOCK_IN, SHIFT_END, nowMs)).toBe(
      new Date(nowMs).toISOString()
    );
  });

  it('offers the scheduled finish once overdue — "now" is the one answer certainly wrong', () => {
    const nextMorningMs = Date.parse('2026-08-04T08:00:00.000Z');
    expect(resolveDefaultClockOutAt(CLOCK_IN, SHIFT_END, nextMorningMs)).toBe(
      SHIFT_END
    );
  });

  it('keeps "now" when overdue with no shift to guess from', () => {
    const nowMs = CLOCK_IN_MS + MAX_UNSCHEDULED_SHIFT_MS + 60_000;
    expect(resolveDefaultClockOutAt(CLOCK_IN, null, nowMs)).toBe(
      new Date(nowMs).toISOString()
    );
  });
});
