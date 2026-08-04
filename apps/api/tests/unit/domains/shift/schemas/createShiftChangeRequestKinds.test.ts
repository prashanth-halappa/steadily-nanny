/**
 * split/handover are rejected at the create schema boundary (Wave 1A).
 */
import { describe, expect, it } from 'bun:test';
import { CreateShiftChangeRequestSchema } from '@steadily-nanny/shared-types/schemas/shift.schema';

describe('CreateShiftChangeRequestSchema — rejected kinds', () => {
  it('rejects split', () => {
    expect(
      CreateShiftChangeRequestSchema.safeParse({ kind: 'split' }).success
    ).toBe(false);
  });

  it('rejects handover', () => {
    expect(
      CreateShiftChangeRequestSchema.safeParse({ kind: 'handover' }).success
    ).toBe(false);
  });

  it('still accepts cancel / time_change / counter_offer', () => {
    expect(
      CreateShiftChangeRequestSchema.safeParse({ kind: 'cancel' }).success
    ).toBe(true);
    expect(
      CreateShiftChangeRequestSchema.safeParse({
        kind: 'time_change',
        proposed_starts_at: '2026-08-03T08:00:00.000Z',
        proposed_ends_at: '2026-08-03T17:00:00.000Z',
      }).success
    ).toBe(true);
    expect(
      CreateShiftChangeRequestSchema.safeParse({
        kind: 'counter_offer',
        proposed_starts_at: '2026-08-03T08:00:00.000Z',
        proposed_ends_at: '2026-08-03T17:00:00.000Z',
      }).success
    ).toBe(true);
  });
});
