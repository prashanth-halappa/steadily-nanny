/**
 * @module domains/timeOff/utils/__tests__/ptoNet.test
 * Phase 3+4 adversarial review, finding 2: net a `usage` row against any
 * reversing `adjustment` rows sharing the same `time_off_id` before
 * deciding "is this paid" — the ledger is append-only, so the `usage` row
 * never disappears even after a full cancellation-triggered reversal.
 */
import { describe, expect, it } from 'bun:test';
import { netPaidMinutesForTimeOff } from '../ptoNet';

const TIME_OFF_ID = 'timeoff-1';
const OTHER_TIME_OFF_ID = 'timeoff-2';

describe('netPaidMinutesForTimeOff', () => {
  it('never marked paid: no usage row at all -> not paid (0)', () => {
    expect(netPaidMinutesForTimeOff([], TIME_OFF_ID)).toBe(0);
  });

  it('marked paid, never reversed: reports the full amount', () => {
    const entries = [
      { kind: 'usage', time_off_id: TIME_OFF_ID, minutes: -480 },
    ];
    expect(netPaidMinutesForTimeOff(entries, TIME_OFF_ID)).toBe(480);
  });

  it('FULLY reversed (adjustment exactly mirrors usage): not paid (0)', () => {
    const entries = [
      { kind: 'usage', time_off_id: TIME_OFF_ID, minutes: -480 },
      { kind: 'adjustment', time_off_id: TIME_OFF_ID, minutes: 480 },
    ];
    expect(netPaidMinutesForTimeOff(entries, TIME_OFF_ID)).toBe(0);
  });

  it('PARTIALLY reversed: still paid, at the remainder', () => {
    const entries = [
      { kind: 'usage', time_off_id: TIME_OFF_ID, minutes: -480 },
      { kind: 'adjustment', time_off_id: TIME_OFF_ID, minutes: 240 },
    ];
    expect(netPaidMinutesForTimeOff(entries, TIME_OFF_ID)).toBe(240);
  });

  it('ignores accrual rows and rows for a different time off', () => {
    const entries = [
      { kind: 'accrual', time_off_id: null, minutes: 8400 },
      { kind: 'usage', time_off_id: OTHER_TIME_OFF_ID, minutes: -120 },
    ];
    expect(netPaidMinutesForTimeOff(entries, TIME_OFF_ID)).toBe(0);
  });
});
