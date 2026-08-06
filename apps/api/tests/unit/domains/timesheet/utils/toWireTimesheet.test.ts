/**
 * @module tests/unit/domains/timesheet/utils/toWireTimesheet.test
 *
 * The mapper is SUBTRACTIVE: it destructures the four migration-042 snapshot
 * columns away and spreads the rest. That makes "does a new column reach the
 * client?" a question with no code to read — the answer is "yes, unless
 * someone changes the shape of this function", and nothing said so out loud.
 *
 * C1 (058) is the first column to depend on that: `household_member_id`
 * appears nowhere in `apps/api/src`, so this rest-spread and three
 * `select('*')` reads are the entire path from the trigger that stamps it to
 * the parent screen that tells two departed carers apart with it. Pinned here
 * because the failure mode is silent — a mapper rewritten to pick fields
 * explicitly would merge them again with no other test going red.
 */
import { describe, expect, it } from 'bun:test';
import { toWireTimesheet } from '../../../../../src/domains/timesheet/utils/toWireTimesheet';

const row = {
  id: 'ts-1',
  household_id: 'h1',
  carer_id: null,
  carer_display_name: 'Emma',
  household_member_id: 'member-1',
  week_start: '2026-08-03',
  total_minutes: 240,
  status: 'submitted' as const,
  approved_by: null,
  approved_at: null,
  query_note: null,
  reopen_reason: null,
  created_at: '2026-08-04T09:00:00.000Z',
  updated_at: '2026-08-04T09:00:00.000Z',
  gross_minor: 14_800,
  currency: 'GBP',
  earnings: { status: 'ok' },
  earnings_computed_at: '2026-08-10T09:00:00.000Z',
};

describe('toWireTimesheet', () => {
  it('C1: carries household_member_id to the wire', () => {
    expect(toWireTimesheet(row).household_member_id).toBe('member-1');
  });

  it('still drops all four snapshot columns', () => {
    const wire: Record<string, unknown> = toWireTimesheet(row);
    for (const column of [
      'gross_minor',
      'currency',
      'earnings',
      'earnings_computed_at',
    ]) {
      expect(column in wire).toBe(false);
    }
  });
});
