/**
 * S4b — `clashes_with_other_household` on the `MeShiftSchema` wire contract.
 * Optional with a `false` default so a response assembled before this field
 * existed still parses (see the schema's own header).
 */
import { describe, expect, it } from 'bun:test';
import { MeShiftSchema } from '../src/schemas/me.schema';

const BASE_SHIFT = {
  id: '11111111-1111-4111-8111-111111111111',
  household_id: '22222222-2222-4222-8222-222222222222',
  carer_id: '33333333-3333-4333-8333-333333333333',
  starts_at: '2026-08-10T09:00:00.000Z',
  ends_at: '2026-08-10T14:00:00.000Z',
  timezone: 'Europe/London',
  local_date: '2026-08-10',
  kind: 'recurring' as const,
  status: 'confirmed' as const,
  source_pattern_id: null,
  origin: 'system_generated' as const,
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  ical_uid: 'uid-1',
  sequence: 0,
  created_by: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  membership_role: 'nanny' as const,
};

describe('MeShiftSchema.clashes_with_other_household', () => {
  it('parses a row that carries the flag as true', () => {
    const row = { ...BASE_SHIFT, clashes_with_other_household: true };
    expect(MeShiftSchema.parse(row).clashes_with_other_household).toBe(true);
  });

  it('defaults to false when a legacy response omits the field', () => {
    expect(MeShiftSchema.parse(BASE_SHIFT).clashes_with_other_household).toBe(
      false
    );
  });
});
